export function buildTocEntries(topics, { isMaster = false, orgById = {}, hasOpenFloor = false } = {}) {
  const list = Array.isArray(topics) ? topics : [];
  if (list.length === 0) return [];

  const entries = [];
  let prevOrg;
  let n = 0;

  for (const topic of list) {
    if (isMaster) {
      const orgId = topic.organizationId ?? "unassigned";
      if (orgId !== prevOrg) {
        const org = orgById[orgId];
        entries.push({
          type: "org",
          label: org?.name || "Unassigned",
          anchorId: `org-${orgId}`,
          accentColor: org?.accentColor,
        });
        prevOrg = orgId;
      }
    }
    n += 1;
    entries.push({
      type: "topic",
      label: (typeof topic.name === "string" && topic.name.trim()) || "Untitled",
      anchorId: topic.id != null ? `topic-${topic.id}` : `topic-${n}`,
      number: n,
    });
  }

  if (hasOpenFloor) {
    entries.push({ type: "openfloor", label: "Open Floor", anchorId: "open-floor" });
  }
  return entries;
}
