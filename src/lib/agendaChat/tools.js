// src/lib/agendaChat/tools.js
//
// Agenda Chat's read tools. Run in the browser against the live agenda, the
// Task Board items and Fireflies. propose_agenda_changes is handled by
// AgendaChatPanel (it needs the review modal).
import { STATUS } from "../../constants/itemStatuses.js";
import { firefliesQuery, formatTimestamp, GQL_MEETING_DETAIL, GQL_MEETING_LIST, GQL_TRANSCRIPT_SENTENCES } from "../fireflies.js";
import { itemRef, statusName, ymd } from "../boardChat/snapshot.js";
import { agendaView } from "./context.js";

// Board items under a topic — the Working view's rule: a top-level item in the
// topic's organization whose category is one of the topic's categories or
// which carries one of its tags, plus that item's subtasks. Archived excluded.
export function topicTasks(topic, items, organizationId) {
  const orgId = topic.organizationId || organizationId;
  const cats = new Set(topic.categoryIds || []);
  const tags = new Set(topic.tagIds || []);
  if (!orgId || (cats.size === 0 && tags.size === 0)) return [];
  const live = items.filter((it) => it.organizationId === orgId && it.statusId !== STATUS.ARCHIVE);
  const parents = live.filter((it) => !it.parentId
    && ((it.categoryId && cats.has(it.categoryId)) || (it.tagIds || []).some((t) => tags.has(t))));
  const parentIds = new Set(parents.map((p) => p.id));
  return [...parents, ...live.filter((it) => it.parentId && parentIds.has(it.parentId))];
}

// Fireflies reads use the Past Meetings card's localStorage caches when they
// hold the recording (it never changes once processed). Summaries are small
// and the card caches them anyway, so a miss is stored; a transcript is large,
// so a miss is fetched but not stored — the chat's own record already carries
// what the model read, and expires.
async function cached(key, fetcher, { store }) {
  const raw = localStorage.getItem(key);
  if (raw) return JSON.parse(raw);
  const data = await fetcher();
  if (!store) return data;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    // A full localStorage only costs a refetch next time.
    if (err?.name !== "QuotaExceededError") throw err;
  }
  return data;
}

export const firefliesSource = {
  list: () => firefliesQuery(GQL_MEETING_LIST, { limit: 50, skip: 0 }),
  detail: (id) => cached(`fireflies-detail-${id}`, () => firefliesQuery(GQL_MEETING_DETAIL, { transcriptId: id }), { store: true }),
  sentences: (id) => cached(`fireflies-sentences-${id}`, () => firefliesQuery(GQL_TRANSCRIPT_SENTENCES, { transcriptId: id }), { store: false }),
};

export async function linkedMeetings(firefliesTitles, source) {
  const titles = new Set((firefliesTitles || []).map((s) => (s || "").toLowerCase().trim()));
  if (titles.size === 0) return [];
  const data = await source.list();
  return (data?.transcripts || [])
    .filter((m) => titles.has((m.title || "").toLowerCase().trim()))
    .sort((a, b) => (b.date || 0) - (a.date || 0));
}

const CONTEXT_LINES = 2;

// Transcript lines; with a query, only the lines within CONTEXT_LINES of a line
// containing any of its words (gaps marked "…").
export function transcriptText(sentences, query) {
  const lines = (sentences || []).map((s) => `[${formatTimestamp(s.start_time)}] ${s.speaker_name || "Unknown"}: ${s.text}`);
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines, matches: null };
  const hits = (sentences || []).flatMap((s, i) => (words.some((w) => (s.text || "").toLowerCase().includes(w)) ? [i] : []));
  const keep = new Set(hits.flatMap((i) => Array.from({ length: 2 * CONTEXT_LINES + 1 }, (_, k) => i - CONTEXT_LINES + k)));
  const out = [];
  lines.forEach((line, i) => {
    if (!keep.has(i)) return;
    if (out.length && !keep.has(i - 1)) out.push("…");
    out.push(line);
  });
  return { lines: out, matches: hits.length };
}

const meetingDate = (m) => (m?.date ? ymd(new Date(m.date)) : "");

// ctx: { agenda, topics, orgs, isMaster, items, organizationId, lookups, source }
export async function runAgendaReadTool(name, input, ctx) {
  if (name === "get_agenda") {
    return { result: agendaView(ctx), step: "Read the agenda" };
  }
  if (name === "list_topic_tasks") {
    const topic = ctx.topics.find((tp) => tp.id === input.topicId);
    if (!topic) throw new Error(`No topic ${input.topicId} on this agenda`);
    const tasks = topicTasks(topic, ctx.items, ctx.organizationId).map((it) => ({
      ref: itemRef(it, ctx.items),
      title: it.title || "(untitled)",
      status: statusName(it.statusId),
      owners: (it.assigneeIds || []).map(ctx.lookups.userName),
      due: ymd(it.dueDate) || null,
    }));
    return {
      result: { topic: topic.name, tasks, ...(tasks.length ? {} : { note: "No board items match this topic's categories and tags." }) },
      step: `Read tasks for ${topic.name || "a topic"}`,
    };
  }
  if (name === "list_past_meetings") {
    const meetings = await linkedMeetings(ctx.agenda?.firefliesTitles, ctx.source);
    return {
      result: {
        meetings: meetings.map((m) => ({ meetingId: m.id, title: m.title, date: meetingDate(m), minutes: Math.round(m.duration || 0), participants: m.participants || [] })),
        note: "Only the 50 most recent recordings are searched.",
      },
      step: `Listed ${meetings.length} past meeting${meetings.length === 1 ? "" : "s"}`,
    };
  }
  if (name === "get_meeting_summary" || name === "get_meeting_transcript") {
    const meetings = await linkedMeetings(ctx.agenda?.firefliesTitles, ctx.source);
    const meeting = meetings.find((m) => m.id === input.meetingId);
    if (!meeting) throw new Error(`Meeting ${input.meetingId} is not one of this agenda's linked meetings`);
    const label = `${meeting.title} ${meetingDate(meeting)}`;
    if (name === "get_meeting_summary") {
      const data = await ctx.source.detail(meeting.id);
      return { result: { title: meeting.title, date: meetingDate(meeting), summary: data?.transcript?.summary || null }, step: `Read notes: ${label}` };
    }
    const data = await ctx.source.sentences(meeting.id);
    const { lines, matches } = transcriptText(data?.transcript?.sentences, input.query);
    return {
      result: { title: meeting.title, date: meetingDate(meeting), ...(matches === null ? {} : { query: input.query, matchingLines: matches }), transcript: lines.join("\n") },
      step: input.query ? `Searched transcript "${input.query}": ${label}` : `Read transcript: ${label}`,
    };
  }
  throw new Error(`Unknown tool ${name}`);
}
