// src/lib/itemStatusMap.js — single source of truth for the status vocabulary
// the AI may target (moves) and the id mapping used at apply.
export const STATUS_MAP = { Assigned: 1, "In Progress": 2, Review: 4, Done: 5, Pending: 6 };
export const MOVE_STATUSES = Object.keys(STATUS_MAP);
export const AI_GEN_STATUS = 8; // "AI Gen" triage
