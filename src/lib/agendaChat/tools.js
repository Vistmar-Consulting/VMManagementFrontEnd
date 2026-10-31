// src/lib/agendaChat/tools.js
//
// Agenda Chat's read tools. Run in the browser against the live agenda, the
// Task Board items and Fireflies. propose_changes is handled by
// AgendaChatPanel (it needs the review modal).
import { STATUS } from "../../constants/itemStatuses.js";
import { firefliesQuery, formatTimestamp, GQL_MEETING_DETAIL, GQL_MEETING_LIST, GQL_TRANSCRIPT_SENTENCES } from "../fireflies.js";
import { itemRef, statusName, ymd } from "../boardChat/snapshot.js";
import { topicTree } from "../topicItems.js";
import { runReadTool } from "../boardChat/tools.js";
import { agendaView, boardItemsFor } from "./context.js";

// Board items under a topic — what its Working view card shows
// (lib/topicItems.js), archived tasks and their subtasks left out.
export function topicTasks(topic, items, organizationId) {
  const { parents, subitemsByParent } = topicTree(topic, items, organizationId);
  return parents
    .filter((p) => p.statusId !== STATUS.ARCHIVE)
    .flatMap((p) => [p, ...(subitemsByParent[p.id] || []).filter((s) => s.statusId !== STATUS.ARCHIVE)]);
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

// ctx: { agenda, topics, orgs, isMaster, items, organizationId, categories,
//        tags, lookups, source }. get_item / search_items are Board Chat's
// (lib/boardChat/tools.js) over the board items Agenda Chat sees; their
// result carries `seen`, the items' staleness baseline.
export async function runAgendaReadTool(name, input, ctx) {
  if (name === "get_agenda") {
    return { result: agendaView({ ...ctx, board: { items: ctx.items, categories: ctx.categories, tags: ctx.tags, organizationId: ctx.organizationId } }), step: "Read the agenda" };
  }
  if (name === "get_item" || name === "search_items") {
    const items = boardItemsFor(ctx.items, ctx);
    const out = await runReadTool(name, input, { items, lookups: ctx.lookups });
    const label = name === "get_item" ? `Read ${out.result.ref} ${out.result.title}` : `Searched "${input.query}"`;
    return { result: out.result, seen: out.seen, step: label };
  }
  if (name === "list_topic_tasks") {
    const topic = ctx.topics.find((tp) => tp.id === input.topicId);
    if (!topic) throw new Error(`No topic ${input.topicId} on this agenda`);
    const tasks = topicTasks(topic, ctx.items, ctx.organizationId).map((it) => ({
      id: it.id,
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
