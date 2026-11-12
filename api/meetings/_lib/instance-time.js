// api/meetings/_lib/instance-time.js
//
// Pure time helpers for finding one occurrence of a recurring series.
//
// Occurrences are matched on their exact start instant, never on a calendar
// day. A day window ("2026-11-12T00:00Z..23:59Z") is a UTC day, so a meeting at
// 4pm PT or later (midnight UTC or later) falls outside its own Pacific day and
// is never found.

// Milliseconds that `timeZone` is ahead of UTC at instant `t`.
function tzOffsetMs(t, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
}

// "2026-11-12T11:00:00" in America/Los_Angeles → "2026-11-12T19:00:00.000Z".
export function wallClockToInstant(localIso, timeZone) {
  const asUtc = Date.parse(`${localIso}Z`);
  if (Number.isNaN(asUtc)) throw new Error(`Invalid local date-time: ${localIso}`);
  // Two passes so a time next to a DST change uses the offset in force at the
  // result, not at the naive guess.
  let t = asUtc - tzOffsetMs(asUtc, timeZone);
  t = asUtc - tzOffsetMs(t, timeZone);
  return new Date(t).toISOString();
}

// Epoch ms of a provider date-time. Graph returns "2026-11-12T22:00:00.0000000"
// with timeZone "UTC" (no suffix); Google returns an offset suffix.
export function instantOf(dateTime, timeZone) {
  if (!dateTime) return NaN;
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(dateTime);
  if (hasZone) return Date.parse(dateTime);
  if (timeZone && timeZone !== "UTC") return Date.parse(wallClockToInstant(dateTime.slice(0, 19), timeZone));
  return Date.parse(`${dateTime.slice(0, 19)}Z`);
}

// Query window around an instant: one minute either side.
export function windowAround(startIso) {
  const t = Date.parse(startIso);
  if (Number.isNaN(t)) throw new Error(`Invalid start: ${startIso}`);
  return {
    from: new Date(t - 60_000).toISOString(),
    to: new Date(t + 60_000).toISOString(),
  };
}

export function sameInstant(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}
