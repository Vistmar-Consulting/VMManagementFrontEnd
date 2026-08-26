// V2.1.1 reconciliation worker — Firestore is the source of truth for app
// state (calendar_series + agendas docs); the /api/meetings/list response is
// the consistency check that surfaces new external events and detects drift.
//
// Flow on page mount:
//   1. Firestore subscriptions render the page IMMEDIATELY from local cache.
//   2. /api/meetings/list runs in parallel.
//   3. reconcile() diffs the API response against Firestore:
//        - Mints calendar_series + agendas docs for any Graph events that
//          don't have a Management binding yet (the auto-bind pattern from
//          Console's autoBindCalendarMeeting).
//        - Updates the per-instance graphEventId on agendas when the next
//          instance moves (e.g., series reschedule).
//        - Surfaces divergence on agendas whose Graph counterpart vanished.
//
// Why client-side reconciliation: V2.1.1 runs on Spark (no Cloud Functions).
// Each user's browser does its own reconciliation; Firestore setDoc with
// matching IDs is idempotent so duplicate work is harmless. V2.2 will move
// this to a server-side trigger when Blaze is on.

import { collection, doc, documentId, getDocs, query, where, writeBatch, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";
import { agendaIdForMeeting } from "./agendaIds.js";
import { resolveOrgFromAttendees, resolveOrgSlug } from "./orgMapping.js";

// Stable seriesId for a meeting. For recurring events the Google series_id
// is the canonical key; for ad-hoc / single events the event_id stands in.
// This is also the Firestore doc ID for calendar_series/{seriesId}.
function seriesIdFor(meeting) {
  if (meeting.series_id) return meeting.series_id;
  if (meeting.event_id) return meeting.event_id;
  return null;
}

// For V2.1.1 recurring agendas are series-level (one shared agenda per series,
// updated each instance — matches Console pattern + reference doc §6).
//
// The agenda id is the BASE series id, NOT the raw recurringEventId. Google
// re-mints a recurrence master ({originalId}_R{splitStartUTC}) on every "this
// and following" edit, so keying agendas on the raw id minted a fresh empty
// agenda per reschedule and stranded the previous one's topics — the
// 2026-08-26 strand incident. See src/lib/agendaIds.js.
//
// calendarSeriesId on the payload deliberately keeps the RAW live master id,
// so calendar_series stays 1:1 with Google and reschedule/cancel keep talking
// to the event that actually exists.
function agendaIdFor(meeting) {
  return agendaIdForMeeting(meeting);
}

// Shape the calendar_series doc payload from a /api/meetings/list entry.
// Only includes fields we control authoritatively from the Graph response —
// mutable display fields (notes, custom title) stay on agendas.
function calendarSeriesPayload(meeting, orgSlug) {
  return {
    organizationId: orgSlug,
    title: meeting.title || "(untitled)",
    status: "scheduled",
    recurrence: meeting.type === "recurring" ? "recurring" : null,
    graphSeriesEventId: meeting.series_id || meeting.event_id || null,
    graphEventId: meeting.m365EventId || null,
    googleSeriesEventId: meeting.series_id || null,
    iCalUID: meeting.iCalUID || null,
    organizerEmail: meeting.organizer_email || null,
    sourceCalendar: meeting.source_calendar || null,
    teamsUrl: meeting.teams_url || null,
    defaultAttendees: meeting.attendees || [],
    consoleOrgId: meeting.org_id != null ? String(meeting.org_id) : null,
  };
}

function agendaPayload(meeting, orgSlug, seriesId) {
  return {
    calendarSeriesId: seriesId,
    organizationId: orgSlug,
    title: meeting.title || "(untitled)",
    status: "active",
    meetingDatetime: meeting.date ? new Date(meeting.date) : null,
    durationMinutes:
      meeting.date && meeting.end_date
        ? Math.round((new Date(meeting.end_date).getTime() - new Date(meeting.date).getTime()) / 60000)
        : null,
    attendees: meeting.attendees || [],
    teamsUrl: meeting.teams_url || null,
    graphEventId: meeting.m365EventId || null,
    googleEventId: meeting.event_id || null,
    iCalUID: meeting.iCalUID || null,
  };
}

// Compare new payload to existing doc and return true if any updateable
// (post-create) field has drifted. Identity fields (Graph/Google IDs) are
// covered by the create path; reconciliation only touches them at first
// auto-bind.
//
// organizationId is in the drift check so existing docs auto-resolve when
// the heuristic learns a new domain → slug mapping, or when the user assigns
// via the hero chip and the next page load re-runs reconciliation.
function isDriftedSeries(payload, existing) {
  if (!existing) return false;
  return (
    existing.title !== payload.title
    || existing.organizerEmail !== payload.organizerEmail
    || existing.consoleOrgId !== payload.consoleOrgId
    || existing.organizationId !== payload.organizationId
  );
}

// calendarSeriesId is in the drift check because a recurrence split re-mints
// the Google master: the agenda doc id stays put (it's the BASE id) but its
// pointer at calendar_series must follow the live master, or the hero binds to
// a dead series and Reschedule/Cancel target an event that no longer exists.
function isDriftedAgenda(payload, existing) {
  if (!existing) return false;
  const existingDt = existing.meetingDatetime?.toMillis?.() ?? null;
  const newDt = payload.meetingDatetime?.getTime?.() ?? null;
  return (
    existing.calendarSeriesId !== payload.calendarSeriesId
    || existing.graphEventId !== payload.graphEventId
    || existing.googleEventId !== payload.googleEventId
    || existing.teamsUrl !== payload.teamsUrl
    || existingDt !== newDt
  );
}

// Main entry. Reads current Firestore state, computes the diff, writes
// missing/updated docs in a batch.
//
// Args:
//   meetings: array from /api/meetings/list
//   orgs:     array from useCollection("organizations")
//   uid:      Andy's auth uid (for createdByUid/updatedByUid stamps)
//
// Returns: { created, updated, unchanged, unassigned } counts.
export async function reconcileMeetingsToFirestore({ meetings, orgs, uid }) {
  if (!Array.isArray(meetings) || meetings.length === 0) {
    return { created: 0, updated: 0, unchanged: 0, unassigned: 0 };
  }

  // Build numeric→slug org lookup once.
  const orgLookup = (() => {
    const l = {};
    for (const org of orgs || []) {
      if (org?.consoleOrgId != null) l[String(org.consoleOrgId)] = org.id;
    }
    return l;
  })();

  // Build the seriesId set this batch will touch. Skip events that don't have
  // any stable identifier — they can't be meaningfully bound.
  const wantedSeriesIds = new Set();
  const wantedAgendaIds = new Set();
  for (const m of meetings) {
    const sid = seriesIdFor(m);
    if (sid) wantedSeriesIds.add(sid);
    const aid = agendaIdFor(m);
    if (aid) wantedAgendaIds.add(aid);
  }
  if (wantedSeriesIds.size === 0) {
    return { created: 0, updated: 0, unchanged: 0, unassigned: 0 };
  }

  // One query for the relevant slice of each collection. Firestore `in`
  // queries cap at 30 IDs per batch; chunk if needed.
  //
  // calendar_series is keyed by the RAW series id and agendas by the BASE id,
  // so the two collections MUST be probed with their own id sets. Probing
  // agendas with raw series ids would miss every base-keyed doc, and the
  // "doesn't exist" branch below would then batch.set() straight over a live
  // agenda, wiping its fields.
  const chunk30 = (arr) => {
    const out = [];
    for (let i = 0; i < arr.length; i += 30) out.push(arr.slice(i, i + 30));
    return out;
  };
  const seriesChunks = chunk30(Array.from(wantedSeriesIds));
  const agendaChunks = chunk30(Array.from(wantedAgendaIds));

  const existingSeriesById = new Map();
  const existingAgendasById = new Map();
  await Promise.all([
    ...seriesChunks.map(async (chunk) => {
      const snap = await getDocs(
        query(collection(db, "calendar_series"), where(documentId(), "in", chunk)),
      );
      snap.forEach((d) => existingSeriesById.set(d.id, d.data()));
    }),
    ...agendaChunks.map(async (chunk) => {
      const snap = await getDocs(
        query(collection(db, "agendas"), where(documentId(), "in", chunk)),
      );
      snap.forEach((d) => existingAgendasById.set(d.id, d.data()));
    }),
  ]);

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let unassigned = 0;

  // Firestore writeBatch caps at 500 ops; split if needed (V2.1.1 has ≤30
  // meetings so one batch is fine; this future-proofs).
  const batches = [writeBatch(db)];
  let opsInCurrent = 0;
  const pushBatchIfFull = () => {
    if (opsInCurrent >= 480) {
      batches.push(writeBatch(db));
      opsInCurrent = 0;
    }
  };

  for (const m of meetings) {
    const seriesId = seriesIdFor(m);
    if (!seriesId) continue;
    const agendaId = agendaIdFor(m);

    // Two-step org resolution. First the numeric Console-era orgId from
    // extendedProperties.private.orgId (works for meetings@-organized events).
    // Fallback: attendee email domain heuristic (handles client-organized
    // and team-member-organized meetings where the orgId property isn't set).
    // The existing doc's org is PRESERVED if both heuristics fail — never
    // wipe a previously-assigned org just because a refetch failed to resolve.
    let orgSlug = resolveOrgSlug(m.org_id, orgLookup);
    if (orgSlug == null) orgSlug = resolveOrgFromAttendees(m.attendees);
    if (orgSlug == null) {
      const existing = existingSeriesById.get(seriesId);
      if (existing?.organizationId) orgSlug = existing.organizationId;
    }
    if (orgSlug == null) unassigned++;

    const seriesPayload = calendarSeriesPayload(m, orgSlug);
    const existingSeries = existingSeriesById.get(seriesId);
    const seriesRef = doc(db, "calendar_series", seriesId);
    const batch = batches[batches.length - 1];

    if (!existingSeries) {
      batch.set(seriesRef, {
        ...seriesPayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: uid,
        updatedByUid: uid,
      });
      opsInCurrent++;
      created++;
    } else if (isDriftedSeries(seriesPayload, existingSeries)) {
      // Update only the drift-tracked fields; rules denylist on Graph/Google
      // IDs + recurrence + defaults means we MUST avoid writing those on
      // update or the write rejects.
      batch.update(seriesRef, {
        title: seriesPayload.title,
        organizerEmail: seriesPayload.organizerEmail,
        consoleOrgId: seriesPayload.consoleOrgId,
        organizationId: seriesPayload.organizationId,
        teamsUrl: seriesPayload.teamsUrl,
        sourceCalendar: seriesPayload.sourceCalendar,
        updatedAt: serverTimestamp(),
        updatedByUid: uid,
      });
      opsInCurrent++;
      updated++;
    } else {
      unchanged++;
    }
    pushBatchIfFull();

    // Mirror logic for agenda doc.
    const agendaPayloadObj = agendaPayload(m, orgSlug, seriesId);
    const existingAgenda = existingAgendasById.get(agendaId);
    const agendaRef = doc(db, "agendas", agendaId);
    const batch2 = batches[batches.length - 1];

    if (!existingAgenda) {
      batch2.set(agendaRef, {
        ...agendaPayloadObj,
        notes: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: uid,
        updatedByUid: uid,
      });
      opsInCurrent++;
    } else if (isDriftedAgenda(agendaPayloadObj, existingAgenda)) {
      // Re-point the agenda at the live calendar_series + instance.
      //
      // This branch used to be an intentional no-op, on the belief that
      // firestore.rules denylisted these fields. It does not — the agendas
      // rule is `allow read, create, update: if isActiveUser()` with no
      // affectedKeys() guard (the denylist is deferred to V2.2). While it
      // stayed a no-op, an agenda that survived a recurrence split kept
      // pointing at the dead master forever.
      //
      // attendees is deliberately NOT synced here: ManageGuestsDialog curates
      // that list, and overwriting it from the Google mirror would silently
      // discard the user's edits.
      batch2.update(agendaRef, {
        calendarSeriesId: agendaPayloadObj.calendarSeriesId,
        graphEventId: agendaPayloadObj.graphEventId,
        googleEventId: agendaPayloadObj.googleEventId,
        iCalUID: agendaPayloadObj.iCalUID,
        teamsUrl: agendaPayloadObj.teamsUrl,
        meetingDatetime: agendaPayloadObj.meetingDatetime,
        durationMinutes: agendaPayloadObj.durationMinutes,
        updatedAt: serverTimestamp(),
        updatedByUid: uid,
      });
      opsInCurrent++;
      updated++;
    }
    pushBatchIfFull();
  }

  // Commit all batches in parallel.
  await Promise.all(batches.map((b) => b.commit()));

  return { created, updated, unchanged, unassigned };
}
