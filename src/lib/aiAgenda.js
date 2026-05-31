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
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "../firebase.js";
import { firefliesQuery, GQL_MEETING_LIST, GQL_MEETING_DETAIL } from "./fireflies.js";
import { sanitizeHtml } from "./agendaHtml.js";

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

// Fetch the agenda's mapped Fireflies transcripts (summary + action items).
// Matches firefliesTitles against the transcript list (same approach as
// PastMeetingsCard), then detail-fetches each match. 3a: the agenda's own
// mapped titles. 3a.2 expands to the windowed org + vistamar inclusion.
// Errors propagate — a flaky Fireflies call fails loudly rather than silently
// generating from a partial input set.
export async function assembleTranscripts(firefliesTitles, { maxMeetings = 6 } = {}) {
  if (!firefliesTitles?.length) return [];
  const titleSet = new Set(firefliesTitles.map((s) => (s || "").toLowerCase().trim()));
  const data = await firefliesQuery(GQL_MEETING_LIST, { limit: 50, skip: 0 });
  const matches = (data?.transcripts || [])
    .filter((tr) => titleSet.has((tr.title || "").toLowerCase().trim()))
    .slice(0, maxMeetings);

  const out = [];
  for (const m of matches) {
    const d = await firefliesQuery(GQL_MEETING_DETAIL, { transcriptId: m.id });
    const s = d?.transcript?.summary || {};
    out.push({
      title: m.title || "",
      date: m.date ? new Date(m.date).toISOString().slice(0, 10) : "",
      overview: s.overview || s.short_overview || "",
      actionItems: s.action_items || "",
    });
  }
  return out;
}

// POST the assembled inputs to the Vercel function. Returns the proposal
// { preBriefHtml, topics:[{name,bodyHtml}], openFloorHtml }.
export async function generateAgenda({ prompt, meetingStyle, agenda, transcripts }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();

  const res = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Token": token },
    body: JSON.stringify({ prompt, meetingStyle, agenda, transcripts }),
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
