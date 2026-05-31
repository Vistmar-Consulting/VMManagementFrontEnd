// src/lib/aiAgenda.js
//
// Slice 3a — FE helpers for AI Meeting Agenda generation. Resolves the stored
// prompt, assembles the current agenda's mapped Fireflies transcripts, POSTs
// to /api/ai/generate, and applies the reviewed proposal back onto the agenda.
//
// The AIGenDialog orchestrates: snapshotAgenda("pre-ai-gen") → resolvePrompt →
// assembleTranscripts → generateAgenda → (review) → applyProposal. Apply is
// reversible via the pre-ai-gen version snapshot (Slice 2).
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "../firebase.js";
import { firefliesQuery, GQL_MEETING_LIST, GQL_MEETING_DETAIL } from "./fireflies.js";
import { sanitizeHtml } from "./agendaHtml.js";
import { resolveOrgFromAttendees } from "./orgMapping.js";
import { STATUS_OPTIONS } from "../constants/itemStatuses.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const FALLBACK_WINDOW_MS = 21 * DAY_MS; // used only when this agenda has no mapped past meeting yet
const MAX_TRANSCRIPTS = 25;
const MAX_BOARD_ITEMS = 40;

function toMs(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (v.toMillis) return v.toMillis(); // Firestore Timestamp
  const p = Date.parse(v);
  return Number.isNaN(p) ? 0 : p;
}

function isoDate(v) {
  const ms = toMs(v);
  return ms ? new Date(ms).toISOString().slice(0, 10) : "";
}

const statusLabel = (id) => STATUS_OPTIONS.find((s) => s.id === id)?.name || "?";

// Resolve the Meeting Agenda Gen prompt: an org override if present, else the
// Default. Returns "" if neither exists (caller surfaces that).
export async function resolvePrompt(orgSlug) {
  if (orgSlug) {
    const oSnap = await getDoc(doc(db, "aiPrompts", orgSlug));
    const p = oSnap.exists() ? oSnap.data()?.meetingAgendaGen?.prompt : null;
    if (p) return p;
  }
  const dSnap = await getDoc(doc(db, "aiPrompts", "default"));
  return dSnap.exists() ? dSnap.data()?.meetingAgendaGen?.prompt || "" : "";
}

// Assemble the full input set for generation (Slice 3a.2):
//   - transcripts: every meeting since this meeting's last occurrence that is
//     either THIS org's or an internal Vistamar meeting (classified by attendee
//     domain via orgMapping — no dependency on the manual firefliesTitles map
//     being complete). Scope-tagged so the model distinguishes client vs internal.
//   - projectBoard: this org's items created or updated within the same window.
//   - summary: counts for the dialog (transparency / no silent caps).
//
// Window start = the last actual occurrence of THIS meeting (latest past
// transcript matching agenda.firefliesTitles); falls back to a flat lookback
// when this agenda has no mapped past meeting yet. Detail fetches are parallel
// and partial-failure tolerant (allSettled) — one flaky transcript can't kill
// the whole run, but the gap is surfaced via summary.failedCount.
export async function assembleGenInputs(agenda, items = [], orgSlug = null) {
  const now = Date.now();
  // Org lives on the calendar_series (the agenda doc's organizationId is often
  // null); the caller passes the resolved slug. Fall back to the agenda field.
  const targetOrg = orgSlug || agenda?.organizationId || null;

  const listData = await firefliesQuery(GQL_MEETING_LIST, { limit: 50, skip: 0 });
  const list = listData?.transcripts || [];

  // Window start: most recent PAST transcript whose title maps to this agenda.
  const titleSet = new Set((agenda?.firefliesTitles || []).map((s) => (s || "").toLowerCase().trim()));
  let lastOccurrence = 0;
  for (const t of list) {
    if (!titleSet.has((t.title || "").toLowerCase().trim())) continue;
    const d = toMs(t.date);
    if (d > 0 && d < now && d > lastOccurrence) lastOccurrence = d;
  }
  const windowStart = lastOccurrence > 0 ? lastOccurrence : now - FALLBACK_WINDOW_MS;

  // In-window transcripts classified as this org or internal Vistamar.
  const included = [];
  for (const t of list) {
    const d = toMs(t.date);
    if (d < windowStart || d > now) continue;
    const cls = resolveOrgFromAttendees(t.meeting_attendees);
    if (!cls || (cls !== targetOrg && cls !== "vistamar")) continue;
    included.push({ ...t, _ms: d, scope: cls === targetOrg ? "this-org" : "vistamar-internal" });
  }
  included.sort((a, b) => b._ms - a._ms);
  const capped = included.slice(0, MAX_TRANSCRIPTS);
  const droppedTranscripts = included.length - capped.length;

  // Detail-fetch in parallel; tolerate partial failure.
  const settled = await Promise.allSettled(
    capped.map((t) => firefliesQuery(GQL_MEETING_DETAIL, { transcriptId: t.id })),
  );
  const transcripts = [];
  let failedCount = 0;
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") { failedCount += 1; return; }
    const s = r.value?.transcript?.summary || {};
    transcripts.push({
      title: capped[i].title || "",
      date: isoDate(capped[i].date),
      scope: capped[i].scope,
      overview: s.overview || s.short_overview || "",
      actionItems: s.action_items || "",
    });
  });

  // Project Board activity: this org's items created or updated in the window.
  const nameById = new Map((items || []).map((it) => [it.id, it.name]));
  const recentItems = (items || [])
    .filter((it) => it.organizationId === targetOrg)
    .filter((it) => toMs(it.createdAt) >= windowStart || toMs(it.updatedAt) >= windowStart)
    .sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt));
  const cappedItems = recentItems.slice(0, MAX_BOARD_ITEMS);
  const projectBoard = cappedItems.map((it) => ({
    name: it.name || "",
    status: it.onHold ? `${statusLabel(it.statusId)} (on hold)` : statusLabel(it.statusId),
    isNew: toMs(it.createdAt) >= windowStart,
    project: it.parentId ? nameById.get(it.parentId) || null : null,
  }));

  return {
    transcripts,
    projectBoard,
    summary: {
      windowStart,
      usedFallbackWindow: lastOccurrence === 0,
      orgCount: transcripts.filter((t) => t.scope === "this-org").length,
      internalCount: transcripts.filter((t) => t.scope === "vistamar-internal").length,
      projectCount: projectBoard.length,
      projectNewCount: projectBoard.filter((p) => p.isNew).length,
      failedCount,
      droppedTranscripts,
      droppedItems: recentItems.length - cappedItems.length,
    },
  };
}

// Persist the meeting's default style on the agenda so it's inherited by every
// future generation. Set from the AI Gen modal's Working/Executive choice.
export async function setAgendaStyle(agendaId, meetingStyle, uid = null) {
  const style = meetingStyle === "executive" ? "executive" : "working";
  await updateDoc(doc(db, "agendas", agendaId), {
    meetingStyle: style,
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  });
}

// POST the assembled inputs to the Vercel function. Returns the proposal
// { preBriefHtml, topics:[{name,bodyHtml}], openFloorHtml }.
export async function generateAgenda({ prompt, meetingStyle, agenda, transcripts, projectBoard, extraContext }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();

  const res = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Token": token },
    body: JSON.stringify({ prompt, meetingStyle, agenda, transcripts, projectBoard, extraContext }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.proposal;
}

// Apply a reviewed proposal: overwrite the agenda's Pre-Brief + Open Floor and
// replace the topic set (proposal topics have no ids → delete current, create
// fresh; categoryIds/tagIds empty in 3a, Slice 3b adds them). Done as a single
// writeBatch so apply is atomic — a mid-apply failure can't leave the agenda
// with new content but missing/partial topics. The caller snapshots
// "pre-ai-gen" first, so a successful apply is also reversible.
// (Topic counts are far below Firestore's 500-op batch limit.)
export async function applyProposal(agendaId, proposal, uid = null) {
  const cur = await getDocs(collection(db, "agendas", agendaId, "topics"));
  const batch = writeBatch(db);

  batch.update(doc(db, "agendas", agendaId), {
    preBriefHtml: sanitizeHtml(proposal.preBriefHtml || ""),
    openFloorHtml: sanitizeHtml(proposal.openFloorHtml || ""),
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  });

  cur.docs.forEach((d) => batch.delete(d.ref));

  (proposal.topics || []).forEach((t, i) => {
    const ref = doc(collection(db, "agendas", agendaId, "topics"));
    batch.set(ref, {
      name: String(t.name || ""),
      bodyHtml: sanitizeHtml(t.bodyHtml || ""),
      sortOrder: i + 1,
      categoryIds: [],
      tagIds: [],
      createdAt: serverTimestamp(),
      createdByUid: uid,
      updatedAt: serverTimestamp(),
      updatedByUid: uid,
    });
  });

  await batch.commit();
}
