// src/lib/boardSync.js
//
// Board Sync I/O — the Task Board's all-org sync (spec
// docs/superpowers/specs/2026-10-26-board-sync-design.md). SyncBoardDialog
// orchestrates: gatherBoardSyncInputs (pre-flight counts) → runOrgSync per
// selected org, in parallel → (review) → applyBoardSync (one transaction).
// Pure logic lives in boardSyncCore.js.
import {
  collection,
  doc,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { generateKeyBetween } from "fractional-indexing";
import { auth, db } from "../firebase.js";
import { firefliesQuery, GQL_MEETING_LIST, GQL_MEETING_DETAIL } from "./fireflies.js";
import { resolveOrgFromAttendees } from "./orgMapping.js";
import { resolvePrompt } from "./aiAgenda.js";
import { STATUS_MAP, AI_GEN_STATUS } from "./itemStatusMap.js";
import {
  LOOKBACK_MS,
  bucketTranscripts,
  boardContextForOrg,
  fetchTranscriptsSince,
  groupStamps,
  isDocId,
  isLedgerId,
  splitBucket,
  tagSlug,
  toMs,
} from "./boardSyncCore.js";

const MAX_ORG_AGENDAS = 15; // same cap as Sync Meeting's per-org agenda context
const MAX_TX_WRITES = 500; // Firestore's per-transaction write limit
const norm = (s) => String(s || "").toLowerCase().trim();
const isoDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

// Everything the pre-flight screen needs, plus the shared context runOrgSync
// reuses. No model calls, no detail fetches (those happen per org on Run).
export async function gatherBoardSyncInputs({ now = Date.now() } = {}) {
  const sinceMs = now - LOOKBACK_MS;

  // Organizations are sorted client-side: orderBy("sortOrder") would silently
  // drop an org doc that has no sortOrder.
  const [orgsSnap, seriesSnap, agendasSnap, catSnap, tagSnap, lastLogSnap] = await Promise.all([
    getDocs(collection(db, "organizations")),
    getDocs(collection(db, "calendar_series")),
    getDocs(collection(db, "agendas")),
    getDocs(query(collection(db, "categories"), orderBy("sortOrder", "asc"))),
    getDocs(query(collection(db, "tags"), orderBy("sortOrder", "asc"))),
    getDocs(query(collection(db, "boardSyncLog"), orderBy("at", "desc"), limit(1))),
  ]);

  // Clients by sortOrder, Vistamar last — same order as master Sync Meeting.
  const orgs = orgsSnap.docs
    .map((d) => ({ slug: d.id, name: d.data().name || d.id, type: d.data().type || "client", sortOrder: d.data().sortOrder ?? 999, accentColor: d.data().accentColor || null }))
    .sort((a, b) => (a.type === "internal" ? 1 : 0) - (b.type === "internal" ? 1 : 0) || a.sortOrder - b.sortOrder);
  const orgSlugs = orgs.map((o) => o.slug);

  // Org and master flag live on the calendar_series (the agenda doc's own
  // fields are often null) — same resolution as assembleGenInputs/AgendaDetail.
  const seriesById = new Map(seriesSnap.docs.map((d) => [d.id, d.data()]));
  const agendas = agendasSnap.docs.map((d) => {
    const a = d.data();
    const s = seriesById.get(a.calendarSeriesId) || {};
    return {
      id: d.id,
      title: a.title || "",
      org: s.organizationId || a.organizationId || null,
      master: !!(s.masterAgenda || a.masterAgenda),
      firefliesTitles: (a.firefliesTitles || []).map(norm).filter(Boolean),
      lastUnifiedGenAt: toMs(a.lastUnifiedGenAt),
    };
  });
  const masterTitles = new Set(agendas.filter((a) => a.master).flatMap((a) => a.firefliesTitles));

  // Title → org from non-master agenda mappings. A title mapped to agendas of
  // two different orgs has no single right answer, so it is left out of the
  // map (the attendee classifier decides that transcript) and reported for the
  // pre-flight screen. A master-mapped title is cross-org regardless, so it is
  // skipped here.
  const orgsByTitle = new Map();
  for (const a of agendas) {
    if (a.master || !a.org) continue;
    for (const t of a.firefliesTitles) {
      if (masterTitles.has(t)) continue;
      if (!orgsByTitle.has(t)) orgsByTitle.set(t, new Set());
      orgsByTitle.get(t).add(a.org);
    }
  }
  const titleOrgs = new Map();
  const ambiguousTitles = [];
  for (const [title, set] of orgsByTitle) {
    if (set.size === 1) titleOrgs.set(title, [...set][0]);
    else ambiguousTitles.push({ title, orgs: [...set].sort() });
  }

  // Backfill thresholds (spec 3.4): latest Sync Meeting per org, master separately.
  const thresholds = {};
  let masterThreshold = 0;
  for (const a of agendas) {
    if (a.master) masterThreshold = Math.max(masterThreshold, a.lastUnifiedGenAt);
    else if (a.org) thresholds[a.org] = Math.max(thresholds[a.org] || 0, a.lastUnifiedGenAt);
  }

  const list = await fetchTranscriptsSince(firefliesQuery, GQL_MEETING_LIST, sinceMs);
  const { buckets, unclassified } = bucketTranscripts(list, {
    orgSlugs, masterTitles, titleOrgs, resolveOrg: resolveOrgFromAttendees, sinceMs,
  });

  // Ledger docs for every in-window transcript (documentId "in" caps at 30).
  // Ids Firestore can't use as a doc id are never stamped, so never looked up.
  const ids = [...new Set(Object.values(buckets).flat().map((t) => t.id))].filter(isLedgerId);
  const ledger = new Map();
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(query(collection(db, "syncedTranscripts"), where(documentId(), "in", ids.slice(i, i + 30))));
    snap.docs.forEach((d) => ledger.set(d.id, d.data()));
  }

  const ctx = { ledger, thresholds, masterThreshold };
  const perOrg = orgs.map((o) => ({ ...o, ...splitBucket(buckets[o.slug], o.slug, ctx) }));

  const lastLog = lastLogSnap.docs[0]?.data() || null;
  return {
    sinceMs,
    orgs: perOrg,
    unclassified,
    ambiguousTitles,
    lastSyncAt: lastLog?.at?.toDate ? lastLog.at.toDate() : null,
    agendasByOrg: Object.fromEntries(orgSlugs.map((s) => [s, agendas.filter((a) => a.org === s && !a.master).map((a) => ({ id: a.id, title: a.title }))])),
    categories: catSnap.docs.map((d) => ({ slug: d.id, name: d.data().name || d.id, description: d.data().description || "", sop: d.data().sop || "" })),
    tagVocab: tagSnap.docs.map((d) => ({ name: d.data().name || d.id, layer: d.data().layer || null })),
  };
}

// Detail-fetch in parallel; a failed fetch drops that transcript and is reported.
async function fetchDetails(rows) {
  const settled = await Promise.allSettled(rows.map((t) => firefliesQuery(GQL_MEETING_DETAIL, { transcriptId: t.id })));
  const loaded = [];
  const failed = [];
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") { failed.push(rows[i].title || rows[i].id); return; }
    const s = r.value?.transcript?.summary || {};
    loaded.push({
      id: rows[i].id,
      title: rows[i].title || "",
      date: isoDate(rows[i]._ms),
      scope: rows[i].scope,
      sharedFrom: rows[i].sharedFrom || "",
      overview: s.overview || s.short_overview || "",
      actionItems: s.action_items || "",
    });
  });
  return { loaded, failed };
}

// One org: detail-fetch its transcripts, build its payload, call the model.
// Throws on failure — the dialog marks the org failed and offers Retry.
export async function runOrgSync(orgEntry, gathered, items, extraContext) {
  const [fresh, context] = await Promise.all([fetchDetails(orgEntry.fresh), fetchDetails(orgEntry.context)]);
  const { projectBoard, existingTasks } = boardContextForOrg(items, orgEntry.slug, gathered.sinceMs);

  const agendas = (gathered.agendasByOrg[orgEntry.slug] || []).slice(0, MAX_ORG_AGENDAS);
  const orgAgendas = await Promise.all(agendas.map(async (a) => {
    const tSnap = await getDocs(query(collection(db, "agendas", a.id, "topics"), orderBy("sortOrder", "asc")));
    return { title: a.title, topics: tSnap.docs.map((d) => ({ name: d.data().name || "", bodyHtml: d.data().bodyHtml || "" })) };
  }));

  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const res = await fetch("/api/ai/sync-board", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Token": token },
    body: JSON.stringify({
      org: { slug: orgEntry.slug, name: orgEntry.name, type: orgEntry.type },
      orgPrompt: await resolvePrompt(orgEntry.slug),
      transcripts: fresh.loaded,
      contextTranscripts: context.loaded,
      projectBoard,
      existingTasks,
      orgAgendas,
      extraContext: extraContext || undefined,
      categories: gathered.categories,
      tagVocab: gathered.tagVocab,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((typeof data.error === "string" ? data.error : data.error?.message) || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return {
    boardChanges: data.boardChanges,
    usage: data.usage || null,
    existingTasks,
    // Only transcripts the model actually read get stamped (spec 3.3).
    transcriptIds: fresh.loaded.map((t) => t.id),
    failedTranscripts: [...fresh.failed, ...context.failed],
  };
}

// Apply every done org's accepted changes + ledger stamps + run log in ONE
// transaction. Twin of applyUnified's board half (aiAgenda.js) — the create
// doc, counter, order key, move and note writes mirror it. Kept separate
// because that one is topic-bound and throws on any rejection; this one drops
// a change whose target vanished (or belongs to another org) and reports it
// (spec 7).
//
// runs:       { [slug]: runOrgSync result }
// selections: { [slug]: { createIdxs, moveIdxs, noteIdxs, promotions: { [idx]: { statusId, assigneeIds?, categoryId, tagIds, newTags } } } }
export async function applyBoardSync(runs, selections, uid = null) {
  const slugs = Object.keys(runs);
  const tagSnap = await getDocs(collection(db, "tags"));
  const existingTagIds = new Set(tagSnap.docs.map((d) => d.id));
  const tagSort = tagSnap.size;

  // Per-org accepted subsets, with the subitem guard applyUnified uses: a child
  // whose new:N parent isn't accepted (or is itself a child) is dropped.
  const dropped = [];
  const plan = slugs.map((slug) => {
    const bc = runs[slug].boardChanges || {};
    const sel = selections[slug] || {};
    let creates = (sel.createIdxs || []).map((i) => ({ idx: i, create: (bc.creates || [])[i] })).filter((x) => x.create);
    creates = creates.filter(({ create }) => {
      const ref = create.parentRef || "";
      if (!ref.startsWith("new:")) return true;
      const parent = creates.find((x) => x.idx === parseInt(ref.slice(4), 10));
      if (parent && !parent.create.parentRef) return true;
      dropped.push({ org: slug, title: create.title, reason: parent ? "parent is itself a subitem" : "parent task not selected" });
      return false;
    });
    // An item id doc() can't take would throw inside the tx and abort every org.
    const validId = (id, title) => {
      if (isDocId(id)) return true;
      dropped.push({ org: slug, title, reason: "invalid item id" });
      return false;
    };
    creates = creates.filter(({ create }) => {
      const ref = create.parentRef || "";
      return !ref || ref.startsWith("new:") || validId(ref, create.title);
    });
    return {
      slug,
      creates,
      moves: (sel.moveIdxs || []).map((i) => (bc.moves || [])[i]).filter(Boolean).filter((m) => validId(m.itemId, m.title)),
      notes: (sel.noteIdxs || []).map((i) => (bc.notes || [])[i]).filter(Boolean).filter((n) => validId(n.itemId, n.title)),
      promotions: sel.promotions || {},
      refs: creates.map(() => doc(collection(db, "items"))),
    };
  });

  // Ledger stamps for every applied org's transcripts; ids Firestore can't use
  // are skipped (same rule as Sync Meeting).
  const ledgerStamps = groupStamps(slugs.flatMap((slug) => (runs[slug].transcriptIds || []).map((id) => ({ id, org: slug }))));

  // Every existing item a write touches — read in the tx so a vanished item is
  // dropped instead of failing the whole commit.
  const existingParentRefs = (p) => p.creates.map(({ create }) => create.parentRef || "").filter((r) => r && !r.startsWith("new:"));
  const targetIds = [...new Set(plan.flatMap((p) => [
    ...p.moves.map((m) => m.itemId),
    ...p.notes.map((n) => n.itemId),
    ...existingParentRefs(p),
  ]))];

  // Firestore rejects a transaction over 500 writes. Upper bound, counted
  // before any write; a run over it fails loudly rather than splitting (spec 7).
  const coinable = new Set(plan.flatMap((p) => p.creates.flatMap(({ idx }) => (p.promotions[idx]?.newTags || []).map(tagSlug)))
    .filter((id) => id && !existingTagIds.has(id)));
  const writeBound = plan.reduce((n, p) => n
    + p.creates.length
    + new Set(existingParentRefs(p)).size
    + (p.creates.length ? 1 : 0)
    + p.moves.length
    + p.notes.length, 0)
    + coinable.size
    + Object.keys(ledgerStamps).length
    + 1;
  if (writeBound > MAX_TX_WRITES) {
    throw new Error(`Board Sync would write ${writeBound} docs; Firestore's limit is ${MAX_TX_WRITES} — apply fewer orgs at once`);
  }

  const counts = {};
  const preDropped = [...dropped];
  await runTransaction(db, async (tx) => {
    // ---- READS (all before any write) ----
    // Tags to coin are re-read here: the outer read can be stale, and a tag
    // created since must not be overwritten.
    const orgSlugsToRead = plan.filter((p) => p.creates.length).map((p) => p.slug);
    const coinIds = [...coinable];
    const [orgList, targetList, tagList] = await Promise.all([
      Promise.all(orgSlugsToRead.map((slug) => tx.get(doc(db, "organizations", slug)))),
      Promise.all(targetIds.map((id) => tx.get(doc(db, "items", id)))),
      Promise.all(coinIds.map((id) => tx.get(doc(db, "tags", id)))),
    ]);
    const orgSnaps = new Map(orgSlugsToRead.map((slug, i) => [slug, orgList[i]]));
    const targets = new Map(targetIds.map((id, i) => [id, targetList[i]]));
    const tagNowExists = new Set(coinIds.filter((id, i) => tagList[i].exists()));
    // A target must still exist and belong to the org whose run proposed it.
    const problem = (id, slug) => {
      const snap = targets.get(id);
      if (!snap?.exists()) return "item no longer exists";
      if (snap.data().organizationId !== slug) return "item belongs to another org";
      return null;
    };

    // ---- WRITES (state rebuilt per attempt — transactions retry) ----
    dropped.length = 0;
    dropped.push(...preDropped);
    for (const k of Object.keys(counts)) delete counts[k];
    const newTagWrites = [];
    const coin = (name) => {
      const id = tagSlug(name);
      if (!id) return null;
      if (!existingTagIds.has(id) && !tagNowExists.has(id) && !newTagWrites.find((w) => w.id === id)) newTagWrites.push({ id, name: String(name).trim() });
      return id;
    };
    // Running descriptions, so two notes on one item both land.
    const descriptions = new Map();
    let order = null;

    for (const p of plan) {
      let num = orgSnaps.get(p.slug)?.data()?.nextItemNumber ?? 1;
      const parentPositions = new Set(p.creates
        .map(({ create }) => create.parentRef || "")
        .filter((r) => r.startsWith("new:"))
        .map((r) => p.creates.findIndex((x) => x.idx === parseInt(r.slice(4), 10))));
      const existingParents = new Set();
      let created = 0;

      p.creates.forEach(({ idx, create }, pos) => {
        const ref = create.parentRef || "";
        let parentId = null;
        if (ref.startsWith("new:")) {
          parentId = p.refs[p.creates.findIndex((x) => x.idx === parseInt(ref.slice(4), 10))].id;
        } else if (ref) {
          const why = problem(ref, p.slug);
          if (why) { dropped.push({ org: p.slug, title: create.title, reason: `parent ${why}` }); return; }
          // One level of nesting only (same rule as the new:N guard above).
          if (targets.get(ref).data().parentId) { dropped.push({ org: p.slug, title: create.title, reason: "parent is itself a subitem" }); return; }
          parentId = ref;
          existingParents.add(ref);
        }
        const promo = p.promotions[idx] || {};
        const tagIds = [...new Set([...(promo.tagIds || []), ...(promo.newTags || []).map(coin).filter(Boolean)])];
        order = generateKeyBetween(order, null);
        tx.set(p.refs[pos], {
          organizationId: p.slug,
          parentId,
          hasChildren: parentPositions.has(pos),
          type: "task",
          title: String(create.title || ""),
          description: String(create.note || ""),
          statusId: promo.statusId ?? AI_GEN_STATUS,
          priorityId: null,
          categoryId: promo.categoryId ?? null,
          tagIds,
          dueDate: null,
          completedAt: null,
          assigneeIds: Array.isArray(promo.assigneeIds) ? promo.assigneeIds : [],
          itemNumber: num,
          createdBy: uid || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          order,
        });
        num += 1;
        created += 1;
      });
      existingParents.forEach((id) => tx.update(doc(db, "items", id), { hasChildren: true, updatedAt: serverTimestamp() }));
      if (orgSnaps.has(p.slug)) tx.set(doc(db, "organizations", p.slug), { nextItemNumber: num }, { merge: true });

      let moved = 0;
      p.moves.forEach((m) => {
        const sid = STATUS_MAP[m.toStatus];
        if (!sid) { dropped.push({ org: p.slug, title: m.title, reason: `unknown status ${m.toStatus}` }); return; }
        const why = problem(m.itemId, p.slug);
        if (why) { dropped.push({ org: p.slug, title: m.title, reason: why }); return; }
        tx.update(doc(db, "items", m.itemId), {
          statusId: sid,
          completedAt: sid === STATUS_MAP.Done ? serverTimestamp() : null,
          updatedAt: serverTimestamp(),
          updatedByUid: uid,
        });
        moved += 1;
      });

      let noted = 0;
      p.notes.forEach((n) => {
        if (!n.note) return;
        const why = problem(n.itemId, p.slug);
        if (why) { dropped.push({ org: p.slug, title: n.title, reason: why }); return; }
        const cur = descriptions.has(n.itemId) ? descriptions.get(n.itemId) : targets.get(n.itemId).data().description || "";
        if (cur.includes(n.note)) return;
        const next = `${cur ? `${cur}\n` : ""}— ${n.note}`;
        descriptions.set(n.itemId, next);
        tx.update(doc(db, "items", n.itemId), {
          description: next,
          updatedAt: serverTimestamp(),
          updatedByUid: uid,
        });
        noted += 1;
      });

      counts[p.slug] = { created, moved, noted, transcriptIds: runs[p.slug].transcriptIds || [], usage: runs[p.slug].usage || null };
    }

    // Coined tags (layer-3 client-proprietary) — same doc as applyUnified.
    newTagWrites.forEach((w, i) => {
      tx.set(doc(db, "tags", w.id), { name: w.name, color: "#8b5cf6", layer: 3, sortOrder: tagSort + i + 1, createdAt: serverTimestamp(), createdByUid: uid });
    });
    // set+merge deep-merges the nested orgs map, so another org's stamp is kept.
    for (const [tid, orgs] of Object.entries(ledgerStamps)) {
      tx.set(doc(db, "syncedTranscripts", tid), {
        orgs: Object.fromEntries(orgs.map((o) => [o, { at: serverTimestamp(), by: "board", byUid: uid }])),
      }, { merge: true });
    }
    tx.set(doc(collection(db, "boardSyncLog")), { at: serverTimestamp(), byUid: uid, orgs: counts, newTags: newTagWrites.length });
  });

  return { counts, dropped };
}
