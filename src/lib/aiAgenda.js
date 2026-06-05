// src/lib/aiAgenda.js
//
// Slice 3a — FE helpers for AI Meeting Agenda generation. Resolves the stored
// prompt, assembles the current agenda's mapped Fireflies transcripts, POSTs
// to /api/ai/prepare (unified Sync Meeting), and applies the reviewed proposal
// back onto the agenda + project board in one atomic transaction.
//
// SyncMeetingDialog orchestrates: snapshotAgenda("pre-ai-gen") → resolvePrompt
// → assembleGenInputs → prepareMeeting → (review) → applyUnified. Apply is
// reversible via the pre-ai-gen version snapshot (Slice 2).
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { generateKeyBetween } from "fractional-indexing";
import { auth, db } from "../firebase.js";
import { firefliesQuery, GQL_MEETING_LIST, GQL_MEETING_DETAIL } from "./fireflies.js";
import { sanitizeHtml } from "./agendaHtml.js";
import { resolveOrgFromAttendees } from "./orgMapping.js";
import { STATUS_OPTIONS } from "../constants/itemStatuses.js";
import { STATUS_MAP, AI_GEN_STATUS } from "./itemStatusMap.js";
import { validateProposal, inheritKeysForCreate } from "./syncMeeting.js";

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
export async function resolvePrompt(orgSlug, { master = false } = {}) {
  // MASTER (Touch Base): its own dedicated prompt at aiPrompts/master. Falls
  // back to the default prompt if no master prompt is authored yet.
  if (master) {
    const mSnap = await getDoc(doc(db, "aiPrompts", "master"));
    const mp = mSnap.exists() ? mSnap.data()?.meetingAgendaGen?.prompt : null;
    if (mp) return mp;
  }
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
export async function assembleGenInputs(agenda, items = [], orgSlug = null, { master = false } = {}) {
  const now = Date.now();
  // Org lives on the calendar_series (the agenda doc's organizationId is often
  // null); the caller passes the resolved slug. Fall back to the agenda field.
  const targetOrg = orgSlug || agenda?.organizationId || null;

  // MASTER mode (the Monday Touch Base): instead of one org + Vistamar, the
  // agenda spans EVERY org. Transcripts/board/agendas are gathered across all
  // orgs and tagged with their org so the prompt + views can group by org.
  // Org display/order is loaded once here (clients by sortOrder, Vistamar last).
  let orgMeta = [];
  if (master) {
    const orgsSnap = await getDocs(query(collection(db, "organizations"), orderBy("sortOrder", "asc")));
    orgMeta = orgsSnap.docs
      .map((d) => ({ slug: d.id, name: d.data().name || d.id, type: d.data().type || "client", sortOrder: d.data().sortOrder ?? 999 }))
      .sort((a, b) => (a.type === "internal" ? 1 : 0) - (b.type === "internal" ? 1 : 0) || a.sortOrder - b.sortOrder);
  }
  const orgNameOf = (slug) => orgMeta.find((o) => o.slug === slug)?.name || slug;

  const listData = await firefliesQuery(GQL_MEETING_LIST, { limit: 50, skip: 0 });
  const list = listData?.transcripts || [];

  // Vistamar-internal title set: any Fireflies title explicitly mapped to a
  // Vistamar agenda is treated as Vistamar-internal regardless of attendee
  // emails (Hugo/Scot may use non-@vistamarconsulting.com accounts in Fireflies).
  const vmAgendasSnap = await getDocs(
    query(collection(db, "agendas"), where("organizationId", "==", "vistamar"))
  );
  const vistamarTitleSet = new Set(
    vmAgendasSnap.docs.flatMap((d) =>
      (d.data().firefliesTitles || []).map((s) => (s || "").toLowerCase().trim())
    ).filter(Boolean)
  );

  // Transcript window = the MEETING CYCLE being prepared — from this meeting's
  // PREVIOUS occurrence to its UPCOMING one — with a ±1 day buffer on each end
  // so a transcript timestamped at the meeting boundary (time-of-day / timezone
  // skew, date-vs-datetime fuzziness) is never missed.
  //
  // We deliberately do NOT anchor to lastUnifiedGenAt: preparing a meeting must
  // always see the last session's transcript, even if a prior Sync already ran
  // (otherwise re-running right after a sync wrongly reports "no transcript").
  //
  // Previous-occurrence resolution, in priority order:
  //  1. This meeting's most recent PAST Fireflies occurrence (by firefliesTitles).
  //  2. The org's most recent past meeting of any kind (attendee-domain classified).
  //  3. Cadence-derived: the upcoming meeting date minus a flat lookback.
  //  4. Flat 21-day lookback — cold start.
  // For (1)/(2): if the latest occurrence essentially JUST happened (sync right
  // after a meeting), reach back to the one before so we span the whole cycle.
  const titleSet = new Set((agenda?.firefliesTitles || []).map((s) => (s || "").toLowerCase().trim()));
  const pickPrev = (occ) => {
    if (!occ.length) return 0;
    return (occ.length > 1 && now - occ[0] < 2 * DAY_MS) ? occ[1] : occ[0];
  };
  const pastMs = (t) => { const d = toMs(t.date); return d > 0 && d < now ? d : 0; };
  const meetingOcc = list.filter((t) => titleSet.has((t.title || "").toLowerCase().trim()))
    .map(pastMs).filter(Boolean).sort((a, b) => b - a);
  const orgOcc = targetOrg
    ? list.filter((t) => resolveOrgFromAttendees(t.meeting_attendees) === targetOrg)
        .map(pastMs).filter(Boolean).sort((a, b) => b - a)
    : [];
  const meetingAnchor = pickPrev(meetingOcc);
  const orgAnchor = pickPrev(orgOcc);
  const upcomingMs = toMs(agenda?.meetingDatetime);
  const prevOccurrence = meetingAnchor || orgAnchor
    || (upcomingMs ? upcomingMs - FALLBACK_WINDOW_MS : 0)
    || (now - FALLBACK_WINDOW_MS);
  const windowStart = prevOccurrence - DAY_MS;            // −1 day buffer (previous end)
  const windowEnd = Math.max(now, upcomingMs) + DAY_MS;   // +1 day buffer (upcoming end)
  const usedFallbackWindow = !meetingAnchor && !orgAnchor;

  // In-window transcripts. The user's explicit mapping (firefliesTitles) is the
  // source of truth: a transcript mapped to THIS agenda is always this meeting's
  // context, regardless of what the attendee-domain heuristic infers. The domain
  // heuristic stays, demoted to auto-finding UNMAPPED context (this org's other
  // meetings + internal Vistamar meetings) within the cycle window.
  // MASTER: not a single agenda's mapping, so it stays classifier-driven.
  const included = [];
  for (const t of list) {
    const d = toMs(t.date);
    if (d <= 0 || d < windowStart || d > windowEnd) continue;
    const titleLc = (t.title || "").toLowerCase().trim();
    const mapped = titleSet.has(titleLc);
    const isVistamarTitle = vistamarTitleSet.has(titleLc);
    const cls = resolveOrgFromAttendees(t.meeting_attendees) || (isVistamarTitle ? "vistamar" : null);
    if (master) {
      if (!cls) continue;
      included.push({ ...t, _ms: d, org: cls, scope: cls === "vistamar" ? "vistamar-internal" : "this-org" });
    } else if (mapped) {
      included.push({ ...t, _ms: d, org: targetOrg, scope: "this-org" });
    } else if (cls === targetOrg) {
      included.push({ ...t, _ms: d, org: targetOrg, scope: "this-org" });
    } else if (cls === "vistamar") {
      included.push({ ...t, _ms: d, org: "vistamar", scope: "vistamar-internal" });
    }
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
      org: capped[i].org || null,
      orgName: orgNameOf(capped[i].org),
      overview: s.overview || s.short_overview || "",
      actionItems: s.action_items || "",
    });
  });

  // Project Board activity. Per-org gen: this org's items. MASTER: every org's
  // items (tagged with their org), so the prompt can group deliverables by
  // client. Higher cap in master to fit all orgs.
  const nameById = new Map((items || []).map((it) => [it.id, it.name]));
  const recentItems = (items || [])
    .filter((it) => (master ? it.organizationId != null : it.organizationId === targetOrg))
    .filter((it) => toMs(it.createdAt) >= windowStart || toMs(it.updatedAt) >= windowStart)
    .sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt));
  const cappedItems = recentItems.slice(0, master ? 120 : MAX_BOARD_ITEMS);
  const projectBoard = cappedItems.map((it) => ({
    name: it.name || "",
    status: it.onHold ? `${statusLabel(it.statusId)} (on hold)` : statusLabel(it.statusId),
    isNew: toMs(it.createdAt) >= windowStart,
    project: it.parentId ? nameById.get(it.parentId) || null : null,
    org: it.organizationId || null,
    orgName: orgNameOf(it.organizationId),
  }));

  // Full unwindowed board — moves/notes may target items outside the gen window.
  // Org filtering matches projectBoard/recentItems: master = all orgs, per-org = targetOrg only.
  const existingTasks = (items || [])
    .filter((it) => !it.parentId)
    .filter((it) => (master ? it.organizationId != null : it.organizationId === targetOrg))
    .map((it) => ({
      id: it.id,
      title: it.title || "",
      status: statusLabel(it.statusId),
      category: it.categoryId || null,
      organizationId: it.organizationId || null,
    }))
    .filter((t) => t.title);

  // Org-wide agenda awareness: the CURRENT content of this client's OTHER
  // meeting agendas (what's planned across the org's meetings, regardless of
  // stage / whether they've been AI-generated). Complements transcripts (what
  // was said) + the board (task state) so the whole org view stays coherent.
  // Org lives on calendar_series → resolve seriesIds → their agenda docs.
  let orgAgendas = [];
  if (master || targetOrg) {
    // MASTER: every org's series (tag each agenda with its org for grouping).
    // Per-org: just this org's series.
    const seriesSnap = master
      ? await getDocs(collection(db, "calendar_series"))
      : await getDocs(query(collection(db, "calendar_series"), where("organizationId", "==", targetOrg)));
    const seriesOrg = new Map(seriesSnap.docs.map((d) => [d.id, d.data().organizationId || null]));
    const seriesIds = seriesSnap.docs.map((d) => d.id);
    const currentSeriesId = agenda?.calendarSeriesId || null;
    const agendaDocs = [];
    for (let i = 0; i < seriesIds.length; i += 10) {
      const chunk = seriesIds.slice(i, i + 10);
      if (!chunk.length) continue;
      const aSnap = await getDocs(
        query(collection(db, "agendas"), where("calendarSeriesId", "in", chunk)),
      );
      aSnap.docs.forEach((d) => agendaDocs.push({ id: d.id, ...d.data() }));
    }
    const others = agendaDocs.filter((a) => a.calendarSeriesId !== currentSeriesId).slice(0, master ? 25 : 15);
    orgAgendas = await Promise.all(
      others.map(async (a) => {
        const tSnap = await getDocs(
          query(collection(db, "agendas", a.id, "topics"), orderBy("sortOrder", "asc")),
        );
        const ao = seriesOrg.get(a.calendarSeriesId) || a.organizationId || null;
        return {
          title: a.title || "",
          org: ao,
          orgName: orgNameOf(ao),
          openFloorHtml: a.openFloorHtml || "",
          topics: tSnap.docs.map((d) => ({ name: d.data().name || "", bodyHtml: d.data().bodyHtml || "" })),
        };
      }),
    );
  }

  // Categories (with SOPs) + tag vocabulary for AI categorization (Slice 3b).
  const catSnap = await getDocs(query(collection(db, "categories"), orderBy("sortOrder", "asc")));
  const categories = catSnap.docs.map((d) => {
    const c = d.data();
    return { slug: d.id, name: c.name || d.id, description: c.description || "", sop: c.sop || "" };
  });
  const tagSnap = await getDocs(query(collection(db, "tags"), orderBy("sortOrder", "asc")));
  const tagVocab = tagSnap.docs.map((d) => ({ name: d.data().name || d.id, layer: d.data().layer || null }));

  return {
    transcripts,
    projectBoard,
    existingTasks,
    orgAgendas,
    categories,
    tagVocab,
    // Vistamar is the only internal org — drives the AI prompt's internal
    // framing + scope guardrail (board = platform dev + biz dev only).
    internal: targetOrg === "vistamar",
    // MASTER: org ordering/names (clients first, Vistamar last) so the prompt
    // can lay out one section per org. Empty for per-org gen.
    master: !!master,
    orgMeta,
    summary: {
      windowStart,
      master: !!master,
      internal: targetOrg === "vistamar",
      usedFallbackWindow,
      orgAgendaCount: orgAgendas.length,
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

// Refine an already-proposed agenda from a user instruction (no data sources —
// just edits the current proposal). Returns the refined proposal in the same
// shape as prepareMeeting, with every topic guaranteed to carry a topicId.
// Topic `ref`s pass through as-is; the CALLER is responsible for running
// normalizeTopicRefs() against the live agenda topics (so a hallucinated ref
// becomes "" = new) before applying — SyncMeetingDialog does this.
export async function refineProposal({ proposal, instruction, categories, tagVocab, master, orgMeta }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const res = await fetch("/api/ai/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Token": token },
    body: JSON.stringify({ proposal, instruction, categories: categories || [], tagVocab: tagVocab || [], master: !!master, orgMeta: orgMeta || [] }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  const refined = data.proposal;

  // Guarantee every returned topic has a topicId. The model preserves ids for
  // retained/edited topics; brand-new topics it adds come back without one.
  // Mint fresh ids continuing past the highest numeric suffix seen in the
  // current proposal's topics (e.g. if t0–t6 exist, new topics get t7, t8…).
  const existingIds = (proposal?.topics || [])
    .map((t) => t.topicId)
    .filter(Boolean);
  const maxSuffix = existingIds.reduce((max, id) => {
    const m = /^t(\d+)$/.exec(id);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, -1);
  let nextSuffix = maxSuffix + 1;

  const topicsWithIds = (refined?.topics || []).map((t) => {
    if (t.topicId) return t;
    const assigned = `t${nextSuffix}`;
    nextSuffix += 1;
    return { ...t, topicId: assigned };
  });

  return { ...refined, topics: topicsWithIds };
}

// slugify a coined tag name → a stable lowercase-hyphenated id.
export function tagSlug(name) {
  return String(name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Sync Meeting (unified): POST the assembled inputs to /api/ai/prepare and get
// back ONE proposal covering both the agenda (topics/openFloorHtml)
// and the project-board changes (boardChanges: { creates, moves, notes }).
// Topics already carry topicId; creates already carry topicId (set server-side).
export async function prepareMeeting({ prompt, meetingStyle, agenda, transcripts, projectBoard, existingTasks, orgAgendas, extraContext, categories, tagVocab, internal, master, orgMeta }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();

  const res = await fetch("/api/ai/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Token": token },
    body: JSON.stringify({ prompt, meetingStyle, agenda, transcripts, projectBoard, existingTasks, orgAgendas, extraContext, categories, tagVocab, internal: !!internal, master: !!master, orgMeta: orgMeta || [] }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  // /api/ai/prepare returns the proposal fields at the top level
  // ({ topics, openFloorHtml, boardChanges }) — no { proposal }
  // wrapper — so return the body directly.
  return res.json();
}

// Sync Meeting (unified): apply the reviewed proposal — agenda content + topic
// set + the user-accepted board changes — in ONE Firestore transaction. Either
// everything commits or nothing does; the time anchor (lastUnifiedGenAt) only
// advances on full success, inside the same atomic commit.
//
// `accepted` = the dialog's review selections, indexes into
// proposal.boardChanges.{creates,moves,notes}:
//   { createIdxs:number[], moveIdxs:number[], noteIdxs:number[],
//     promotions:{ [createIdx]: { statusId, assigneeIds } } }
//
// Firestore requires ALL reads before ANY write within a transaction, so the
// body is split into a reads phase (org counters + note target items) and a
// writes phase. Coined-tag and counter state is rebuilt fresh on each attempt
// (transactions auto-retry) so a retry never double-writes.
export async function applyUnified(agendaId, orgSlug, proposal, accepted, uid = null, { master = false } = {}) {
  if (!agendaId) throw new Error("Missing agendaId");
  if (!master && !orgSlug) throw new Error("Missing org");

  const sel = accepted || {};
  const createIdxs = sel.createIdxs || [];
  const moveIdxs = sel.moveIdxs || [];
  const noteIdxs = sel.noteIdxs || [];
  const promotions = sel.promotions || {};

  const bc = proposal.boardChanges || {};
  const allCreates = bc.creates || [];
  const allMoves = bc.moves || [];
  const allNotes = bc.notes || [];

  // The user-accepted subset (kept paired with original index for promotions).
  const acceptedCreates = createIdxs.map((i) => ({ idx: i, create: allCreates[i] })).filter((x) => x.create);
  const acceptedMoves = moveIdxs.map((i) => allMoves[i]).filter(Boolean);
  const acceptedNotes = noteIdxs.map((i) => allNotes[i]).filter(Boolean);

  // Topics keyed by topicId (creates inherit their owning topic's keys).
  const topicsById = Object.fromEntries((proposal.topics || []).map((t) => [t.topicId, t]));

  // Backstop validation over the ACCEPTED subset only. The dialog should have
  // prevented an accepted-but-invalid item (e.g. a create whose topic was
  // refined away); if one slips through, throw rather than silently drop.
  const acceptedBoardChanges = {
    creates: acceptedCreates.map((x) => x.create),
    moves: acceptedMoves,
    notes: acceptedNotes,
  };
  // existingTasks source: the proposal if it carries one (the prepare inputs are
  // echoed back), else the dialog-supplied set. Falling back to the accepted
  // moves'/notes' own item ids keeps the create-side backstop strict (topic
  // refined away → reject) without falsely dropping a valid move/note when no
  // board snapshot was threaded through.
  const existingTasks = proposal.existingTasks
    || sel.existingTasks
    || [...new Set([...acceptedMoves, ...acceptedNotes].map((x) => x.itemId).filter(Boolean))].map((id) => ({ id, title: id }));
  const v = validateProposal({ topics: proposal.topics, boardChanges: acceptedBoardChanges, existingTasks });
  if (v.hasRejections) {
    const reasons = [
      ...v.rejectedCreates.map((c) => `create "${c.title || c.topicId}": ${c.reason}`),
      ...v.droppedMoves.map((m) => `move ${m.itemId}: ${m.reason}`),
      ...v.droppedNotes.map((n) => `note ${n.itemId}: ${n.reason}`),
    ];
    throw new Error(`Accepted board changes failed validation: ${reasons.join("; ")}`);
  }

  // Reference data for slug/tag resolution — safe to read outside the tx.
  const [catSnap, tagSnap, curTopics] = await Promise.all([
    getDocs(collection(db, "categories")),
    getDocs(collection(db, "tags")),
    getDocs(collection(db, "agendas", agendaId, "topics")),
  ]);
  const catBySlug = new Set(catSnap.docs.map((d) => d.id));
  const catByName = new Map(catSnap.docs.map((d) => [(d.data().name || "").toLowerCase(), d.id]));

  // Canonical topic identity: a continued topic (carrying a ref to an existing
  // topic doc id) keeps its Firestore name (and, for master, org) — the model's
  // name is discarded. This is the structural title-lock.
  const curNameById = new Map(curTopics.docs.map((d) => [d.id, d.data().name || ""]));
  const curOrgById = new Map(curTopics.docs.map((d) => [d.id, d.data().organizationId ?? null]));
  const resolveCat = (c) => {
    const val = String(c || "").trim();
    if (catBySlug.has(val)) return val;
    return catByName.get(val.toLowerCase()) || null;
  };
  const existingTagIds = new Set(tagSnap.docs.map((d) => d.id));
  const existingTagByName = new Map(tagSnap.docs.map((d) => [(d.data().name || d.id).toLowerCase(), d.id]));
  const tagSort = tagSnap.size;

  // Resolve which org each accepted create belongs to (master = per-create org;
  // single = orgSlug). Collect the distinct set so we read every counter up front.
  const orgOfCreate = (create) => {
    if (!master) return orgSlug;
    const t = topicsById[create?.topicId];
    return create?.organizationId || t?.organizationId || orgSlug || null;
  };
  const createOrgs = acceptedCreates.map((x) => orgOfCreate(x.create));
  const distinctOrgs = [...new Set(createOrgs.filter(Boolean))];

  // Note targets: need each item's current description (read phase).
  const noteItemIds = [...new Set(acceptedNotes.map((n) => n.itemId).filter(Boolean))];

  let createdCount = 0;
  let movedCount = 0;
  let notedCount = 0;
  let newTagCount = 0;

  // Pre-allocate item doc refs so "new:N" forward-references resolve to a real
  // Firestore ID before the target create is written inside the transaction.
  const createDocRefs = acceptedCreates.map(() => doc(collection(db, "items")));

  // Which accepted positions will become parents of another accepted create?
  const parentCreateIdxs = new Set();
  acceptedCreates.forEach(({ create }, pos) => {
    const ref = create.parentRef || "";
    if (ref.startsWith("new:")) {
      const n = parseInt(ref.slice(4), 10);
      const targetPos = acceptedCreates.findIndex((x) => x.idx === n);
      if (targetPos >= 0) parentCreateIdxs.add(targetPos);
    }
  });

  await runTransaction(db, async (tx) => {
    // ---- READS PHASE (all tx.get before any write) ----
    const orgRefs = new Map(distinctOrgs.map((o) => [o, doc(db, "organizations", o)]));
    const orgSnaps = new Map();
    for (const [o, ref] of orgRefs) {
      orgSnaps.set(o, await tx.get(ref));
    }
    const noteRefs = new Map(noteItemIds.map((id) => [id, doc(db, "items", id)]));
    const noteSnaps = new Map();
    for (const [id, ref] of noteRefs) {
      noteSnaps.set(id, await tx.get(ref));
    }

    // ---- WRITES PHASE ----
    // Fresh-per-attempt coined-tag accumulator (retries must not double-append).
    const newTagWrites = [];
    const resolveTag = (t) => {
      const name = String(t || "").trim();
      if (!name) return null;
      if (existingTagIds.has(name)) return name;
      const byName = existingTagByName.get(name.toLowerCase());
      if (byName) return byName;
      const id = tagSlug(name);
      if (!id) return null;
      if (existingTagIds.has(id)) return id;
      if (!newTagWrites.find((w) => w.id === id)) newTagWrites.push({ id, name });
      return id;
    };

    // Agenda doc: open floor + the anchor (advances only here).
    tx.update(doc(db, "agendas", agendaId), {
      openFloorHtml: sanitizeHtml(proposal.openFloorHtml || ""),
      updatedAt: serverTimestamp(),
      updatedByUid: uid,
      lastUnifiedGenAt: serverTimestamp(),
    });

    // Replace the topic set.
    curTopics.docs.forEach((d) => tx.delete(d.ref));
    (proposal.topics || []).forEach((t, i) => {
      const categoryIds = [...new Set((t.categories || []).map(resolveCat).filter(Boolean))];
      const tagIds = [...new Set((t.tags || []).map(resolveTag).filter(Boolean))];
      const ref = doc(collection(db, "agendas", agendaId, "topics"));
      const retained = t.ref && curNameById.has(t.ref);
      tx.set(ref, {
        name: retained ? curNameById.get(t.ref) : String(t.name || ""),
        bodyHtml: sanitizeHtml(t.bodyHtml || ""),
        sortOrder: i + 1,
        categoryIds,
        tagIds,
        organizationId: retained && curOrgById.has(t.ref) ? curOrgById.get(t.ref) : (t.organizationId || null),
        createdAt: serverTimestamp(),
        createdByUid: uid,
        updatedAt: serverTimestamp(),
        updatedByUid: uid,
      });
    });

    // Accepted creates → new items. itemNumber from each org's counter.
    const orgNum = new Map();
    for (const [o, snap] of orgSnaps) {
      orgNum.set(o, snap.data()?.nextItemNumber ?? 1);
    }
    let order = null;
    acceptedCreates.forEach(({ idx, create }, pos) => {
      const org = orgOfCreate(create);
      const promo = promotions[idx];
      const statusId = promo?.statusId ?? AI_GEN_STATUS;
      const assigneeIds = Array.isArray(promo?.assigneeIds) ? promo.assigneeIds : [];
      const { categoryId, tagIds } = inheritKeysForCreate(create, topicsById);
      let num = orgNum.get(org) ?? 1;
      order = generateKeyBetween(order, null);

      // Resolve parentRef → parentId
      const rawRef = create.parentRef || "";
      let parentId = null;
      if (rawRef.startsWith("new:")) {
        const n = parseInt(rawRef.slice(4), 10);
        const targetPos = acceptedCreates.findIndex((x) => x.idx === n);
        if (targetPos >= 0) parentId = createDocRefs[targetPos].id;
      } else if (rawRef) {
        parentId = rawRef;
      }

      tx.set(createDocRefs[pos], {
        organizationId: org,
        parentId,
        hasChildren: parentCreateIdxs.has(pos),
        type: "task",
        title: String(create.title || ""),
        description: String(create.note || ""),
        statusId,
        priorityId: null,
        categoryId,
        tagIds,
        onHold: false,
        dueDate: null,
        completedAt: null,
        assigneeIds,
        itemNumber: num,
        createdBy: uid || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        order,
      });
      orgNum.set(org, num + 1);
    });

    // Mark existing board items as parents when new subitems were accepted under them.
    const existingParentIds = new Set(
      acceptedCreates
        .map(({ create }) => create.parentRef || "")
        .filter((ref) => ref && !ref.startsWith("new:"))
    );
    existingParentIds.forEach((id) => {
      tx.update(doc(db, "items", id), { hasChildren: true, updatedAt: serverTimestamp() });
    });

    // Accepted moves → status change.
    acceptedMoves.forEach((m) => {
      const sid = STATUS_MAP[m.toStatus];
      if (!sid || !m.itemId) return;
      tx.update(doc(db, "items", m.itemId), {
        statusId: sid,
        completedAt: sid === STATUS_MAP.Done ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
        updatedByUid: uid,
      });
    });

    // Accepted notes → append to description (skip if the raw note is already
    // present in the current description).
    acceptedNotes.forEach((n) => {
      const snap = noteSnaps.get(n.itemId);
      if (!snap?.exists() || !n.note) return;
      const cur = snap.data().description || "";
      if (cur.includes(n.note)) return;
      tx.update(doc(db, "items", n.itemId), {
        description: `${cur ? `${cur}\n` : ""}— ${n.note}`,
        updatedAt: serverTimestamp(),
        updatedByUid: uid,
      });
    });

    // Coined tags (layer-3 client-proprietary).
    newTagWrites.forEach((w, i) => {
      tx.set(doc(db, "tags", w.id), {
        name: w.name,
        color: "#8b5cf6",
        layer: 3,
        sortOrder: tagSort + i + 1,
        createdAt: serverTimestamp(),
        createdByUid: uid,
      });
    });

    // Write each org's final counter back.
    for (const [o, num] of orgNum) {
      tx.set(orgRefs.get(o), { nextItemNumber: num }, { merge: true });
    }

    createdCount = acceptedCreates.length;
    movedCount = acceptedMoves.length;
    notedCount = acceptedNotes.length;
    newTagCount = newTagWrites.length;
  });

  // Best-effort gen-history log, outside the tx so it never gates the apply.
  try {
    await addDoc(collection(db, "agendas", agendaId, "aiGenLog"), {
      at: serverTimestamp(),
      byUid: uid,
      kind: "unified",
      counts: { created: createdCount, moved: movedCount, noted: notedCount, newTags: newTagCount },
    });
  } catch (e) {
    console.warn("aiGenLog (unified) write skipped:", e?.message);
  }

  return { created: createdCount, moved: movedCount, noted: notedCount, newTags: newTagCount };
}
