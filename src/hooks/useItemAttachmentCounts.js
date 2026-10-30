// src/hooks/useItemAttachmentCounts.js
//
// Notes (comments) and Files counts per item, for the Notes / Files badges
// on board rows (Task Board and the agenda's mini boards). One collection-group
// subscription each instead of one per item: every comment and file doc
// carries a denormalized `itemId`.
import { useMemo } from "react";
import { useCollectionGroup } from "./useCollectionGroup.js";

function countByItemId(docs) {
  const m = {};
  for (const d of docs) {
    if (d.itemId) m[d.itemId] = (m[d.itemId] || 0) + 1;
  }
  return m;
}

export function useItemAttachmentCounts() {
  const { data: comments } = useCollectionGroup("comments");
  const { data: files } = useCollectionGroup("files");
  const commentCounts = useMemo(() => countByItemId(comments), [comments]);
  const fileCounts = useMemo(() => countByItemId(files), [files]);
  return {
    getCommentCount: (itemId) => commentCounts[itemId] || 0,
    getFileCount: (itemId) => fileCounts[itemId] || 0,
  };
}
