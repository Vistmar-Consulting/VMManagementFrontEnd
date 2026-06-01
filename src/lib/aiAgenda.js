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
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
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
export async function assembleGenInputs(agenda, items = [], orgSlug = null, { anchorField = "lastAgendaGenAt" } = {}) {
  const now = Date.now();
  // Org lives on the calendar_series (the agenda doc's organizationId is often
  // null); the caller passes the resolved slug. Fall back to the agenda field.
  const targetOrg = orgSlug || agenda?.organizationId || null;

  const listData = await firefliesQuery(GQL_MEETING_LIST, { limit: 50, skip: 0 });
  const list = listData?.transcripts || [];

  // Window start, in priority order:
  //  1. The last AI-Gen anchor for this flow ("since I last reconciled") — the
  //     robust, intuitive default once the agenda has been generated once.
  //  2. The meeting's most recent PAST Fireflies occurrence (first-gen fallback).
  //  3. A flat lookback (unmapped agenda).
  const anchorMs = toMs(agenda?.[anchorField]);
  const titleSet = new Set((agenda?.firefliesTitles || []).map((s) => (s || "").toLowerCase().trim()));
  let lastOccurrence = 0;
  for (const t of list) {
    if (!titleSet.has((t.title || "").toLowerCase().trim())) continue;
    const d = toMs(t.date);
    if (d > 0 && d < now && d > lastOccurrence) lastOccurrence = d;
  }
  const windowStart = anchorMs > 0
    ? anchorMs
    : (lastOccurrence > 0 ? lastOccurrence : now - FALLBACK_WINDOW_MS);
  const anchoredToGen = anchorMs > 0;

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

  // Org-wide agenda awareness: the CURRENT content of this client's OTHER
  // meeting agendas (what's planned across the org's meetings, regardless of
  // stage / whether they've been AI-generated). Complements transcripts (what
  // was said) + the board (task state) so the whole org view stays coherent.
  // Org lives on calendar_series → resolve seriesIds → their agenda docs.
  let orgAgendas = [];
  if (targetOrg) {
    const seriesSnap = await getDocs(
      query(collection(db, "calendar_series"), where("organizationId", "==", targetOrg)),
    );
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
    const others = agendaDocs.filter((a) => a.calendarSeriesId !== currentSeriesId).slice(0, 15);
    orgAgendas = await Promise.all(
      others.map(async (a) => {
        const tSnap = await getDocs(
          query(collection(db, "agendas", a.id, "topics"), orderBy("sortOrder", "asc")),
        );
        return {
          title: a.title || "",
          preBriefHtml: a.preBriefHtml || "",
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
    orgAgendas,
    categories,
    tagVocab,
    summary: {
      windowStart,
      anchoredToGen,
      usedFallbackWindow: !anchoredToGen && lastOccurrence === 0,
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

// POST the assembled inputs to the Vercel function. Returns the proposal
// { preBriefHtml, topics:[{name,bodyHtml}], openFloorHtml }.
export async function generateAgenda({ prompt, meetingStyle, agenda, transcripts, projectBoard, orgAgendas, extraContext, categories, tagVocab }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();

  const res = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Token": token },
    body: JSON.stringify({ prompt, meetingStyle, agenda, transcripts, projectBoard, orgAgendas, extraContext, categories, tagVocab }),
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
// slugify a coined tag name → a stable lowercase-hyphenated id.
export function tagSlug(name) {
  return String(name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function applyProposal(agendaId, proposal, uid = null, { style = null } = {}) {
  // Resolve categories/tags (Slice 3b): valid category slugs + existing tags,
  // creating any coined (new) tags as layer-3 client-proprietary.
  const [catSnap, tagSnap, cur] = await Promise.all([
    getDocs(collection(db, "categories")),
    getDocs(collection(db, "tags")),
    getDocs(collection(db, "agendas", agendaId, "topics")),
  ]);
  // category resolution: accept slug (doc id) or lowercased name → slug.
  const catBySlug = new Set(catSnap.docs.map((d) => d.id));
  const catByName = new Map(catSnap.docs.map((d) => [(d.data().name || "").toLowerCase(), d.id]));
  const resolveCat = (c) => {
    const v = String(c || "").trim();
    if (catBySlug.has(v)) return v;
    return catByName.get(v.toLowerCase()) || null;
  };
  // tag resolution: existing by id(=name); new tags get created.
  const existingTagIds = new Set(tagSnap.docs.map((d) => d.id));
  const existingTagByName = new Map(tagSnap.docs.map((d) => [(d.data().name || d.id).toLowerCase(), d.id]));
  let tagSort = tagSnap.size;
  const newTagWrites = []; // {id, name}
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

  const batch = writeBatch(db);

  batch.update(doc(db, "agendas", agendaId), {
    preBriefHtml: sanitizeHtml(proposal.preBriefHtml || ""),
    openFloorHtml: sanitizeHtml(proposal.openFloorHtml || ""),
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
    lastAgendaGenAt: serverTimestamp(), // window anchor + "last generated" record
  });

  cur.docs.forEach((d) => batch.delete(d.ref));

  (proposal.topics || []).forEach((t, i) => {
    const categoryIds = [...new Set((t.categories || []).map(resolveCat).filter(Boolean))];
    const tagIds = [...new Set((t.tags || []).map(resolveTag).filter(Boolean))];
    const ref = doc(collection(db, "agendas", agendaId, "topics"));
    batch.set(ref, {
      name: String(t.name || ""),
      bodyHtml: sanitizeHtml(t.bodyHtml || ""),
      sortOrder: i + 1,
      categoryIds,
      tagIds,
      createdAt: serverTimestamp(),
      createdByUid: uid,
      updatedAt: serverTimestamp(),
      updatedByUid: uid,
    });
  });

  // Create any coined tags (layer-3 client-proprietary).
  newTagWrites.forEach((w, i) => {
    batch.set(doc(db, "tags", w.id), {
      name: w.name,
      color: "#8b5cf6",
      layer: 3,
      sortOrder: tagSort + i + 1,
      createdAt: serverTimestamp(),
      createdByUid: uid,
    });
  });

  await batch.commit();

  // Record the gen event (visible AI-Gen activity history). Best-effort +
  // outside the atomic batch so it never gates the core apply — and tolerates
  // the aiGenLog rule not yet being deployed (logs as a warning if so).
  try {
    await addDoc(collection(db, "agendas", agendaId, "aiGenLog"), {
      at: serverTimestamp(),
      byUid: uid,
      kind: "agenda",
      style: style || null,
    });
  } catch (e) {
    console.warn("aiGenLog (agenda) write skipped:", e?.message);
  }
}
