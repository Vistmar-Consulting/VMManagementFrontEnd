export function buildTocEntries(topics, { isMaster = false, orgById = {}, hasOpenFloor = false } = {}) {
  const list = Array.isArray(topics) ? topics : [];
  if (list.length === 0) return [];

  const entries = [];
  let prevOrg;
  let n = 0;

  for (const topic of list) {
    if (isMaster && topic.organizationId !== prevOrg) {
      const org = orgById[topic.organizationId];
      entries.push({
        type: "org",
        label: org?.name || "Unassigned",
        anchorId: `org-${topic.organizationId}`,
        accentColor: org?.accentColor,
      });
      prevOrg = topic.organizationId;
    }
    n += 1;
    entries.push({
      type: "topic",
      label: (topic.name && topic.name.trim()) || "Untitled",
      anchorId: `topic-${topic.id}`,
      number: n,
    });
  }

  if (hasOpenFloor) {
    entries.push({ type: "openfloor", label: "Open Floor", anchorId: "open-floor" });
  }
  return entries;
}
