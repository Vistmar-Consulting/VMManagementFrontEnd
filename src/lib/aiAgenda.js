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
export async function assembleGenInputs(agenda, items = [], orgSlug = null, { anchorField = "lastUnifiedGenAt", master = false } = {}) {
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

  // Window start, in priority order:
  //  1. The last AI-Gen anchor for this flow ("since I last reconciled") — the
  //     robust, intuitive default once the agenda has been generated once.
  //  2. The meeting's most recent PAST Fireflies occurrence (first-gen fallback).
  //  3. A flat lookback (unmapped agenda).
  // Window anchor, in priority order:
  //  1. lastAgendaGenAt / lastSuggestTasksAt — "since I last reconciled".
  //  2. This meeting's PREVIOUS occurrence (by firefliesTitles) — first gen of
  //     a meeting that has Fireflies history + a title mapping.
  //  3. The ORG's previous meeting of ANY kind — new / imported / unmapped
  //     meetings ("since this client last met us"), cadence-aligned.
  //  4. Flat 21-day lookback — cold start (org has no Fireflies history).
  // For (2) and (3): if the latest occurrence JUST happened (gen right after a
  // meeting), reach back to the one before it so we span the full last cycle
  // rather than a near-empty window.
  const anchorMs = toMs(agenda?.[anchorField]);
  const titleSet = new Set((agenda?.firefliesTitles || []).map((s) => (s || "").toLowerCase().trim()));
  const pickAnchor = (occ) => {
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
  const meetingAnchor = pickAnchor(meetingOcc);
  const orgAnchor = pickAnchor(orgOcc);
  const windowStart = anchorMs > 0
    ? anchorMs
    : (meetingAnchor || orgAnchor || now - FALLBACK_WINDOW_MS);
  const anchoredToGen = anchorMs > 0;

  // In-window transcripts. Per-org gen: this org + internal Vistamar.
  // MASTER: every classified org (the whole week across all clients + Vistamar).
  const included = [];
  for (const t of list) {
    const d = toMs(t.date);
    if (d < windowStart || d > now) continue;
    const cls = resolveOrgFromAttendees(t.meeting_attendees);
    if (!cls) continue;
    if (master) {
      included.push({ ...t, _ms: d, org: cls, scope: cls === "vistamar" ? "vistamar-internal" : "this-org" });
    } else {
      if (cls !== targetOrg && cls !== "vistamar") continue;
      included.push({ ...t, _ms: d, org: cls, scope: cls === targetOrg ? "this-org" : "vistamar-internal" });
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
      anchoredToGen,
      master: !!master,
      usedFallbackWindow: !anchoredToGen && !meetingAnchor && !orgAnchor,
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
export async function generateAgenda({ prompt, meetingStyle, agenda, transcripts, projectBoard, orgAgendas, extraContext, categories, tagVocab, internal, master, orgMeta }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();

  const res = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Token": token },
    body: JSON.stringify({ prompt, meetingStyle, agenda, transcripts, projectBoard, orgAgendas, extraContext, categories, tagVocab, internal: !!internal, master: !!master, orgMeta: orgMeta || [] }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.proposal;
}

// Refine an already-proposed agenda from a user instruction (no data sources —
// just edits the current proposal). Returns the refined proposal in the same
// shape as generateAgenda.
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
      // Master Touch Base: each topic is tagged with the org it belongs to so
      // the Working/Overview views group + color by org. null for normal agendas.
      organizationId: t.organizationId || null,
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
