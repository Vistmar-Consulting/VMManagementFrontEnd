// dev/audit-recurring-meetings.mjs
//
// READ-ONLY fleet audit of every recurring meeting on the meetings@ host
// calendar, checking the two conditions that make a single-occurrence
// reschedule fail or strand attendees:
//
//   1. DUPLICATE / STALE SERIES — the same meeting title backed by more than
//      one live recurring master (Google recurringEventId). Occurrence
//      resolution can't tell which series is canonical, so the reschedule
//      dialog may anchor to the wrong one (the BMD "Marketing" duplicate).
//
//   2. GRAPH ↔ GOOGLE DIVERGENCE — an occurrence whose wall-clock start
//      differs between Graph (canonical, fans .ics to attendees) and the
//      Google mirror, or exists on one side only. This is the Business-Dev
//      failure: Graph moved to Mon, Google stranded on Fri, attendees saw Fri.
//
// Compares USER-VISIBLE wall-clock time (Pacific), the same thing an attendee
// reads off the invite — no timezone math, just the YYYY-MM-DDTHH:mm prefix.
//
// Touches nothing. No writes, no patches, no cancels. Pure GET.
//
// Run:  node --env-file=.env.vercel dev/audit-recurring-meetings.mjs

import { google } from "googleapis";
import { getGoogleCredentials, getTeamsCredentials } from "../api/meetings/_lib/keyvault.js";

// Forward window: today through +120 days (same horizon the FE uses to resolve
// the next occurrence in AgendaDetail).
const now = new Date();
const WINDOW_START = now.toISOString().slice(0, 10);
const WINDOW_END = new Date(now.getTime() + 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const IMPERSONATE = "meetings@vistamarconsulting.com";

function line() { console.log("─".repeat(76)); }
// Normalize a Google/Graph start object to the Pacific wall-clock the attendee
// sees. Google dateTime carries an offset ("...-07:00"); Graph (Prefer PST)
// carries none. Both share the YYYY-MM-DDTHH:mm prefix in Pacific local time.
function wall(startObj) {
  const dt = startObj?.dateTime;
  if (!dt) return null; // all-day / no time — not a scheduled meeting
  return dt.slice(0, 16);
}
// Normalize en-dash / em-dash / hyphen and collapse whitespace so titles that
// differ only in dash style ("GV – Biweekly" vs "GV - Biweekly") match.
function normTitle(s) {
  return (s || "").replace(/[‒-―−-]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
}

// ── Google (invite-fan mirror) ──
async function googleClient(subject) {
  const creds = await getGoogleCredentials();
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
    subject,
  });
  await auth.authorize();
  return google.calendar({ version: "v3", auth });
}

async function googleRecurring(cal) {
  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: new Date(`${WINDOW_START}T00:00:00Z`).toISOString(),
    timeMax: new Date(`${WINDOW_END}T23:59:59Z`).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500,
  });
  // Keep only expanded instances of a recurring master (recurringEventId set).
  const items = (res.data.items || []).filter(
    (e) => e.recurringEventId && e.status !== "cancelled" && e.start?.dateTime
  );
  // master id -> { title, m365, occ:Set<wall> }
  const byMaster = new Map();
  for (const e of items) {
    const k = e.recurringEventId;
    if (!byMaster.has(k)) {
      byMaster.set(k, {
        title: e.summary || "(untitled)",
        m365: e.extendedProperties?.private?.m365EventId || null,
        occ: new Set(),
      });
    }
    byMaster.get(k).occ.add(wall(e.start));
  }
  return byMaster;
}

// ── Graph (canonical) ──
async function graphToken() {
  const { clientId, clientSecret, tenantId } = await getTeamsCredentials();
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Graph auth failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function graphRecurring() {
  const token = await graphToken();
  const { hostUserId } = await getTeamsCredentials();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${hostUserId}/calendarView` +
      `?startDateTime=${WINDOW_START}T00:00:00&endDateTime=${WINDOW_END}T23:59:59` +
      `&$select=id,subject,type,start,isCancelled,seriesMasterId&$top=999`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="Pacific Standard Time"',
      },
    }
  );
  if (!res.ok) throw new Error(`Graph calendarView -> ${res.status} ${await res.text()}`);
  const data = await res.json();
  // Only occurrences/exceptions of a series (seriesMasterId set), not cancelled.
  const items = (data.value || []).filter(
    (e) => e.seriesMasterId && !e.isCancelled && e.start?.dateTime
  );
  // series master id -> { title, occ:Set<wall> }
  const byMaster = new Map();
  for (const e of items) {
    const k = e.seriesMasterId;
    if (!byMaster.has(k)) byMaster.set(k, { title: e.subject || "(untitled)", occ: new Set() });
    byMaster.get(k).occ.add(wall(e.start));
  }
  return byMaster;
}

(async () => {
  line();
  console.log(`RECURRING MEETING AUDIT  window ${WINDOW_START}..${WINDOW_END}  (READ-ONLY)`);
  console.log(`Host calendar: ${IMPERSONATE}`);
  line();

  const cal = await googleClient(IMPERSONATE);
  const gMasters = await googleRecurring(cal);
  const xMasters = await graphRecurring();

  console.log(`Google recurring series found: ${gMasters.size}`);
  console.log(`Graph  recurring series found: ${xMasters.size}`);
  line();

  // ── Merge both calendars into one record per normalized title ──
  // A healthy series = exactly 1 Google master + 1 Graph master whose
  // occurrence sets agree. Anything else is an anomaly.
  const merged = new Map(); // normTitle -> { display, g:[{id,occ,m365}], x:[{id,occ}] }
  function rec(t, display) {
    if (!merged.has(t)) merged.set(t, { display, g: [], x: [] });
    return merged.get(t);
  }
  for (const [id, v] of gMasters) rec(normTitle(v.title), v.title).g.push({ id, occ: v.occ, m365: v.m365 });
  for (const [id, v] of xMasters) rec(normTitle(v.title), v.title).x.push({ id, occ: v.occ });

  const gUnion = (r) => new Set(r.g.flatMap((m) => [...m.occ]).filter(Boolean));
  const xUnion = (r) => new Set(r.x.flatMap((m) => [...m.occ]).filter(Boolean));

  const dupSeries = [];      // >1 master on either calendar for one title
  const divergedSeries = []; // occurrence sets disagree
  const missingCanonical = []; // on Google, no Graph
  const graphOnly = [];      // on Graph, no Google (not app-visible)

  for (const [t, r] of merged) {
    if (r.g.length === 0) { graphOnly.push(r); continue; }
    if (r.x.length === 0) { missingCanonical.push(r); continue; }
    if (r.g.length > 1 || r.x.length > 1) dupSeries.push(r);
    const g = gUnion(r), x = xUnion(r);
    const onlyG = [...g].filter((w) => !x.has(w)).sort();
    const onlyX = [...x].filter((w) => !g.has(w)).sort();
    if (onlyG.length || onlyX.length) divergedSeries.push({ r, onlyG, onlyX });
  }

  // ── Check 1: duplicate / stale series (>1 master on either calendar) ──
  console.log(`\n■ CHECK 1 — Duplicate / stale recurring series`);
  if (dupSeries.length === 0) {
    console.log("  ✓ none — every meeting maps to exactly one Google + one Graph master.");
  } else {
    for (const r of dupSeries) {
      console.log(`  ✗ "${r.display}" — ${r.g.length} Google master(s) + ${r.x.length} Graph master(s):`);
      for (const m of r.g) {
        const d = [...m.occ].filter(Boolean).sort();
        console.log(`      [Google] ${m.id}  next=${d[0] || "-"}  occ=${d.length}  m365=${m.m365 || "(none)"}`);
      }
      for (const m of r.x) {
        const d = [...m.occ].filter(Boolean).sort();
        console.log(`      [Graph ] ${m.id}  next=${d[0] || "-"}  occ=${d.length}`);
      }
    }
  }

  // ── Check 2: Graph↔Google occurrence divergence ──
  console.log(`\n■ CHECK 2 — Graph ↔ Google occurrence divergence`);
  if (divergedSeries.length === 0) {
    console.log("  ✓ none — every matched series' occurrences agree across Graph and Google.");
  } else {
    for (const { r, onlyG, onlyX } of divergedSeries) {
      console.log(`  ✗ "${r.display}" — occurrences disagree:`);
      if (onlyX.length) console.log(`      Graph-only (attendees NOT seeing on Google): ${onlyX.join(", ")}`);
      if (onlyG.length) console.log(`      Google-only (stale mirror, Graph moved away): ${onlyG.join(", ")}`);
    }
  }

  // ── Inventory: the Google-keyed series the FE actually reschedules ──
  console.log(`\n■ INVENTORY — Google-keyed recurring series (what the app sees)`);
  for (const [, r] of merged) {
    if (r.g.length === 0) continue;
    const d = [...gUnion(r)].sort();
    console.log(`  • "${r.display}"  next=${d[0] || "-"}  occ=${d.length}`);
  }

  // ── Note: Graph-only series (no Google mirror; invisible to the app) ──
  console.log(`\n■ NOTE — Graph-only recurring series (no Google mirror; invisible to the app)`);
  if (missingCanonical.length) {
    for (const r of missingCanonical)
      console.log(`  ⚠ "${r.display}" — on Google but canonical Graph series MISSING.`);
  }
  if (graphOnly.length === 0 && missingCanonical.length === 0) {
    console.log("  ✓ none.");
  } else {
    for (const r of graphOnly) {
      const d = [...xUnion(r)].sort();
      console.log(`  • "${r.display}"  next=${d[0] || "-"}  occ=${d.length}  (created directly in Outlook, not via the app)`);
    }
  }

  line();
  console.log(
    `SUMMARY: ${gMasters.size} app-visible series | ${dupSeries.length} duplicated | ` +
    `${divergedSeries.length} diverged | ${missingCanonical.length} missing-canonical | ${graphOnly.length} graph-only`
  );
  console.log("Done. Nothing was modified.");
  line();
})().catch((err) => {
  console.error("\nAUDIT FAILED:", err.message);
  process.exit(1);
});
