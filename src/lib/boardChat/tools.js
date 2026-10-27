// src/lib/boardChat/tools.js
//
// Board Chat read tools, executed in the browser. Each returns
// { result, seen } — `seen` refreshes the staleness baseline for every item
// the model was just shown.
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase.js";
import { listMeetings } from "../meetingsApi.js";
import { STATUS } from "../../constants/itemStatuses.js";
import { itemRef, priorityName, statusName, toMillis, ymd } from "./snapshot.js";

const SEARCH_LIMIT = 50;

function brief(item, L) {
  return {
    id: item.id,
    ref: itemRef(item),
    title: item.title || "(untitled)",
    org: L.orgName(item.organizationId),
    parentId: item.parentId || null,
    status: statusName(item.statusId),
    assignees: (item.assigneeIds || []).map(L.userName),
    priority: priorityName(item.priorityId),
    category: item.categoryId ? L.categoryName(item.categoryId) : "",
    tags: (item.tagIds || []).map(L.tagName),
    due: ymd(item.dueDate),
    updated: ymd(item.updatedAt),
  };
}

function dayBounds(startDate, endDate) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  return {
    start: new Date(sy, sm - 1, sd, 0, 0, 0).toISOString(),
    end: new Date(ey, em - 1, ed, 23, 59, 59).toISOString(),
  };
}

export async function runReadTool(name, input, { items, lookups: L }) {
  if (name === "get_item") {
    const item = items.find((i) => i.id === input.itemId);
    if (!item) throw new Error(`No item with id ${input.itemId}`);
    const subs = items.filter((i) => i.parentId === item.id);
    const snap = await getDocs(query(collection(db, "items", item.id, "comments"), orderBy("createdAt", "desc"), limit(5)));
    const recentComments = snap.docs.map((d) => {
      const c = d.data();
      return { author: L.userName(c.authorId), body: c.body, date: ymd(c.createdAt) };
    });
    const seen = { [item.id]: toMillis(item.updatedAt) };
    subs.forEach((s) => { seen[s.id] = toMillis(s.updatedAt); });
    return {
      result: { ...brief(item, L), description: item.description || "", subtasks: subs.map((s) => brief(s, L)), recentComments },
      seen,
    };
  }

  if (name === "search_items") {
    const words = input.query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = items.filter((i) => {
      if (!input.includeArchived && i.statusId === STATUS.ARCHIVE) return false;
      const text = `${i.title || ""} ${i.description || ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    const shown = matches.slice(0, SEARCH_LIMIT);
    return {
      result: { total: matches.length, shown: shown.length, items: shown.map((i) => brief(i, L)) },
      seen: Object.fromEntries(shown.map((i) => [i.id, toMillis(i.updatedAt)])),
    };
  }

  if (name === "list_meetings") {
    const data = await listMeetings(dayBounds(input.startDate, input.endDate));
    const meetings = (data.meetings || []).map((m) => ({
      title: m.title || "(untitled)",
      start: m.date,
      end: m.end_date,
      attendees: (m.attendees || []).map((a) => a.email).filter(Boolean),
    }));
    return { result: { meetings }, seen: {} };
  }

  throw new Error(`Unknown tool ${name}`);
}
