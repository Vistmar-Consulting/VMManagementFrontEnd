// src/lib/agendaIds.js
// Stable agenda key for a meeting series. No React, no Firestore.
//
// Google does NOT keep a recurring series' master id stable. Editing a series
// with "this and following" SPLITS it: the original master keeps the earlier
// occurrences and Google mints a new master
//
//     {originalEventId}_R{splitStartUTC}      e.g. abc123_R20260826T193000
//
// and every occurrence from the split forward reports that new id as its
// `recurringEventId`. The split id is always derived from the ORIGINAL event
// id, never nested — BMD split three times (_R20260521, _R20260702,
// _R20260827) and all three hang off the same base.
//
// Agendas used to be keyed by the raw `recurringEventId`, so each reschedule
// minted a brand-new EMPTY agenda doc and stranded the team's topics on the
// previous one. That is the 2026-08-26 strand incident (7 series affected).
// Keying on the BASE id gives one agenda per logical series, stable across
// every future reschedule.
//
// NOTE: this is the AGENDA key only. `series_id` itself stays untouched — the
// reschedule/cancel paths must keep talking to the live Google master, so
// calendar_series docs and Graph/Google id fields deliberately keep the raw id.

// A recurrence-split suffix: literal _R + YYYYMMDD + T + HHMMSS, anchored to
// the end. Instance ids look like _20260826T193000Z (no R, trailing Z) and are
// intentionally NOT matched.
const SPLIT_SUFFIX = /_R\d{8}T\d{6}$/;

/**
 * Reduce a Google recurrence-master id to the original (pre-split) master id.
 * Returns null for nullish/empty input. Non-split ids pass through unchanged.
 */
export function baseSeriesId(seriesId) {
  if (!seriesId) return null;
  let id = String(seriesId);
  // Loop rather than single-replace so a nested split (not observed in the
  // wild, but cheap to defend against) collapses fully instead of partially.
  while (SPLIT_SUFFIX.test(id)) id = id.replace(SPLIT_SUFFIX, "");
  return id;
}

/**
 * The Firestore `agendas/{id}` doc id for a /api/meetings/list entry.
 *
 * Recurring  → base series id (stable across recurrence splits).
 * Ad-hoc     → event_id verbatim. Single events have no recurrence master, so
 *              there is nothing to normalize and stripping could corrupt an id
 *              that merely resembles the suffix.
 */
export function agendaIdForMeeting(meeting) {
  if (!meeting) return null;
  if (meeting.series_id) return baseSeriesId(meeting.series_id);
  if (meeting.event_id) return String(meeting.event_id);
  return null;
}
