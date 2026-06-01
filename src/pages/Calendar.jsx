// V2.1 — Calendar page ported from Console's Agenda.jsx (archive lines
// 568-1447). Three stacked sections:
//   1. Recurring Meetings — copper card grid
//   2. Ad Hoc Meetings    — purple card grid (future-dated non-recurring)
//   3. Calendar           — month grid with meeting chips
// Org filter chips at the top apply to all three sections. Card clicks
// open the same preview popover the calendar chip clicks open. V2.1 swaps
// Console's "Open Agenda" primary action for "Reschedule" since the agenda
// detail pages don't exist yet (V2.3).

import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useLocalStorage } from "@uidotdev/usehooks";
import {
  Avatar,
  Box,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  Popover,
  Stack,
  Typography,
} from "@mui/material";
import {
  ChevronLeft,
  ChevronRight,
  Close,
  People,
  Refresh,
  Schedule,
} from "@mui/icons-material";
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isToday,
  isBefore,
  startOfDay,
} from "date-fns";

import { doc, setDoc, serverTimestamp } from "firebase/firestore";

import { useCollection } from "../hooks/useCollection.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { db } from "../firebase.js";
import { listMeetings } from "../lib/meetingsApi.js";
import { groupRecurringMeetings, detectCadence, visibleAttendees } from "../lib/meetingHelpers.js";
import { reconcileMeetingsToFirestore } from "../lib/reconcileMeetings.js";
import MemberAvatar from "../components/MemberAvatar.jsx";
import NewMeetingDialog from "../components/NewMeetingDialog.jsx";
import RescheduleDialog from "../components/RescheduleDialog.jsx";
import CancelMeetingDialog from "../components/CancelMeetingDialog.jsx";

// Design tokens — local to this page since Management's global palette
// excludes cream/copper. Ported verbatim from archive Agenda.jsx lines 86-107.
const t = {
  ink: "#1a1a2e",
  ink2: "#3d3d5c",
  ink3: "#6b6b8a",
  cream: "#faf8f5",
  cream2: "#f0ede8",
  cream3: "#e8e4dd",
  copper: "#b87333",
  copperLight: "#d4a574",
  copperFaint: "rgba(184,115,51,0.08)",
  blue: "#376fd0",
  purple: "#5e35b1",
  purpleLight: "#ede7f6",
  serif: "'Playfair Display', Georgia, serif",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Helpers ───────────────────────────────────────────────────────────

function GroupHeader({ color, label }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
      <Box sx={{ width: 3, height: 18, borderRadius: 1, background: color, flexShrink: 0 }} />
      <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color }}>
        {label}
      </Typography>
    </Box>
  );
}

function AttendeeAvatars({ attendees, userByEmail, max = 5 }) {
  const display = visibleAttendees(attendees);
  if (!display.length) return null;
  const visible = display.slice(0, max);
  const overflow = display.length - visible.length;
  return (
    <Box sx={{ display: "flex" }}>
      {visible.map((a, i) => {
        const userRecord = a.email ? userByEmail[a.email.toLowerCase()] : null;
        const userForAvatar = userRecord || { displayName: a.name || a.email, email: a.email };
        return (
          <Box key={a.email || i} sx={{ ml: i > 0 ? "-6px" : 0, zIndex: visible.length - i }}>
            <MemberAvatar user={userForAvatar} size={24} border tooltip={false} />
          </Box>
        );
      })}
      {overflow > 0 && (
        <Avatar sx={{ width: 24, height: 24, bgcolor: "#e9eaec", color: "#5a5a5a", fontSize: 10, fontWeight: 700, border: "2px solid #fff", boxSizing: "content-box", ml: "-6px" }}>
          {`+${overflow}`}
        </Avatar>
      )}
    </Box>
  );
}

// ─── Cards ─────────────────────────────────────────────────────────────

// Uniform card dimensions so every Recurring + AdHoc card is the same size
// regardless of title length / attendee count. Tighter than the first cut
// (Andy 2026-05-28: "smaller, all same size").
const CARD_SX = {
  background: "white",
  borderRadius: "10px",
  cursor: "pointer",
  overflow: "hidden",
  transition: "transform 0.15s, box-shadow 0.15s",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)",
  display: "flex",
  flexDirection: "column",
  minHeight: 118,
};
const CARD_TITLE_SX = {
  fontFamily: t.serif,
  fontSize: 14,
  fontWeight: 500,
  color: t.ink,
  lineHeight: 1.25,
  // Clamp to 2 lines so a long title can't push the card taller than peers.
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  textOverflow: "ellipsis",
  mb: 0.4,
};
const CARD_META_SX = {
  fontSize: 11,
  color: t.ink3,
  mb: 1,
  display: "flex",
  alignItems: "center",
  gap: 0.5,
};
const CARD_FOOTER_SX = {
  display: "flex",
  alignItems: "center",
  mt: "auto",
  pt: 1,
  borderTop: `1px solid ${t.cream}`,
  minHeight: 32,
};

function RecurringCard({ series, userByEmail, onClick }) {
  const cadenceLabel = detectCadence(series.instanceCount);
  const nextDt = series.nextDate ? parseISO(series.nextDate) : null;

  return (
    <Box
      onClick={onClick}
      sx={{
        ...CARD_SX,
        borderLeft: `4px solid ${t.copper}`,
        "&:hover": { transform: "translateY(-2px)", boxShadow: "0 4px 16px rgba(184,115,51,0.15)" },
      }}
    >
      <Box sx={{ p: 1.5, flex: 1, display: "flex", flexDirection: "column" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
          <Typography sx={{ fontFamily: t.sans, fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.copper }}>
            Recurring{cadenceLabel ? ` · ${cadenceLabel}` : ""}
          </Typography>
          <ChevronRight sx={{ fontSize: 16, color: t.cream3 }} />
        </Box>
        <Typography sx={CARD_TITLE_SX}>{series.title || "(untitled)"}</Typography>
        <Typography sx={CARD_META_SX}>
          <Schedule sx={{ fontSize: 12 }} />
          {nextDt ? `Next: ${format(nextDt, "MMM d · h:mm a")}` : "No upcoming instances"}
        </Typography>
        <Box sx={CARD_FOOTER_SX}>
          <AttendeeAvatars attendees={series.attendees} userByEmail={userByEmail} />
        </Box>
      </Box>
    </Box>
  );
}

function AdHocCard({ meeting, userByEmail, onClick }) {
  const dt = meeting.date ? parseISO(meeting.date) : null;
  return (
    <Box
      onClick={onClick}
      sx={{
        ...CARD_SX,
        borderLeft: `4px solid ${t.purple}`,
        "&:hover": { transform: "translateY(-2px)", boxShadow: "0 4px 16px rgba(94,53,177,0.15)" },
      }}
    >
      <Box sx={{ p: 1.5, flex: 1, display: "flex", flexDirection: "column" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
          <Typography sx={{ fontFamily: t.sans, fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.purple }}>
            Ad Hoc
          </Typography>
          <ChevronRight sx={{ fontSize: 16, color: t.cream3 }} />
        </Box>
        <Typography sx={CARD_TITLE_SX}>{meeting.title || "(untitled)"}</Typography>

        <Typography sx={CARD_META_SX}>
          <Schedule sx={{ fontSize: 12 }} />
          {dt ? format(dt, "MMM d · h:mm a") : "Date TBD"}
        </Typography>
        <Box sx={CARD_FOOTER_SX}>
          <AttendeeAvatars attendees={meeting.attendees} userByEmail={userByEmail} />
        </Box>
      </Box>
    </Box>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────

export default function Calendar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: orgs } = useCollection("organizations");
  const { data: users } = useCollection("users");
  // V2.1.1 — Firestore subscriptions for the substrate. Render is still
  // API-driven below; these subs warm the local cache so V2.2 (Firestore-
  // primary reads) flips with no further wiring. They also feed the joined
  // view used by RescheduleDialog to find the matching agenda doc by id.
  const { data: calendarSeriesDocs } = useCollection("calendar_series");
  const { data: agendaDocs } = useCollection("agendas");
  const [orgFilter, setOrgFilter] = useLocalStorage("vm-calendar-org-filter", "all");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [popoverAnchor, setPopoverAnchor] = useState(null);
  const [popoverMeeting, setPopoverMeeting] = useState(null);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [pastExpanded, setPastExpanded] = useState(false);
  const [newMeetingOpen, setNewMeetingOpen] = useState(false);

  // Single broad query: visible-month window EXTENDED forward 90 days so
  // the Recurring + Ad-Hoc card sections always have upcoming data. The
  // calendar grid (current month) is a subset; cards filter ahead.
  const queryWindow = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    // Day-aligned so the window (and thus the React Query key below) is STABLE
    // across navigations within the same day. Using `new Date()` here carried
    // the current time-of-day, making the key unique every mount → no cache
    // reuse → a full 5–10s refetch on every visit to the Calendar.
    const today = startOfDay(new Date());
    const futureEnd = addDays(today, 90);
    const monthGridEnd = endOfWeek(endOfMonth(currentMonth));
    const end = futureEnd > monthGridEnd ? futureEnd : monthGridEnd;
    return { start: start.toISOString(), end: end.toISOString() };
  }, [currentMonth]);

  const meetingsQuery = useQuery({
    queryKey: ["meetings-list", queryWindow.start, queryWindow.end],
    queryFn: () => listMeetings({ start: queryWindow.start, end: queryWindow.end }),
    // "Load once, self-healing." The list is fetched once and kept for the whole
    // session (gcTime Infinity), so re-navigating to the Calendar is always an
    // instant cache hit — never a blank reload. In-app create/reschedule/cancel
    // invalidate ["meetings-list"] directly (in the meeting dialogs), so those
    // changes appear immediately. The long staleTime + refetchOnWindowFocus
    // quietly re-syncs EXTERNAL changes (RSVPs, client/teammate edits in
    // Google/Outlook) when you return to the tab — stale-while-revalidate, so
    // still no blank. The manual Refresh button forces an immediate re-sync.
    staleTime: 60 * 60_000, // 1h — don't auto-refetch within the hour
    gcTime: Infinity, // keep the cache for the session (no cold blank reloads)
    refetchOnWindowFocus: true, // quiet background re-sync on tab focus when stale
  });
  const meetings = meetingsQuery.data?.meetings || [];

  // V2.1.1 reconciliation worker — runs after each successful API fetch.
  // Diffs the API response against calendar_series + agendas in Firestore
  // and mints / updates docs as needed (auto-bind pattern from Console's
  // autoBindCalendarMeeting). Ref-guarded to avoid re-running on stale data
  // when an in-flight reconcile finishes after the user has navigated months.
  const reconciledKeyRef = useRef(null);
  useEffect(() => {
    if (!meetingsQuery.data || !user?.uid || !orgs || orgs.length === 0) return;
    const key = `${queryWindow.start}:${queryWindow.end}:${meetings.length}`;
    if (reconciledKeyRef.current === key) return;
    reconciledKeyRef.current = key;
    (async () => {
      try {
        const stats = await reconcileMeetingsToFirestore({
          meetings,
          orgs,
          uid: user.uid,
        });
        if (stats.unassigned > 0 && import.meta.env.DEV) {
          console.warn(
            `[reconcileMeetings] ${stats.unassigned} meetings missing an organizations[].consoleOrgId match. ` +
            `Set consoleOrgId on each org doc (Firebase console) to enable per-org filtering.`
          );
        }
      } catch (err) {
        console.error("[reconcileMeetings] failed:", err);
      }
    })();
  }, [meetingsQuery.data, meetings, orgs, user?.uid, queryWindow.start, queryWindow.end]);

  // Build a Graph→Firestore-agenda lookup so RescheduleDialog can pass the
  // matching agenda doc through and write its meetingDatetime field after
  // the API call succeeds. Keyed by graphEventId then googleEventId.
  const agendaByExternalId = useMemo(() => {
    const map = {};
    for (const a of agendaDocs || []) {
      if (a.graphEventId) map[a.graphEventId] = a;
      if (a.googleEventId) map[a.googleEventId] = a;
    }
    return map;
  }, [agendaDocs]);

  // Client-side org filter applied to all three sections. NOTE legacy
  // meetings@'s events still carry numeric Console-era orgIds in
  // extendedProperties; Management orgs use slugs. Until a one-shot rewrite
  // runs, only "All" matches every existing meeting.
  // Build the numeric Console-orgId → slug lookup from the organizations
  // collection. Each org doc carries an optional `consoleOrgId` number set by
  // an admin during V2.1.1 bootstrap (see DEFERRED.md). Meetings whose
  // numeric org_id has no matching org doc fall through as "unassigned" and
  // only appear under the "All" chip until manually assigned.
  const consoleOrgLookup = useMemo(() => {
    const map = {};
    for (const o of orgs || []) {
      if (o.consoleOrgId != null) map[String(o.consoleOrgId)] = o.id;
    }
    return map;
  }, [orgs]);

  // Firestore calendar_series → organizationId lookup. Authoritative source
  // for org assignment (auto-resolved via attendee domain in reconciliation,
  // or hand-assigned via the agenda detail hero chip). The Calendar list
  // consults this first so series with `org_id: null` from the API still
  // surface under their assigned org chip.
  const seriesOrgLookup = useMemo(() => {
    const map = {};
    for (const s of calendarSeriesDocs || []) {
      if (s.organizationId) map[s.id] = s.organizationId;
    }
    return map;
  }, [calendarSeriesDocs]);

  // Retired meetings (e.g. a departed team member's leftover Google event that
  // can't be deleted): calendar_series flagged `archived` are hidden from the
  // calendar everywhere. The reconcile preserves the flag (its drift-update
  // touches only specific fields, never `archived`).
  const archivedSeries = useMemo(
    () => new Set((calendarSeriesDocs || []).filter((s) => s.archived).map((s) => s.id)),
    [calendarSeriesDocs],
  );

  // For each API meeting, resolve its slug org id in this order:
  //   1. Firestore calendar_series.organizationId (canonical post-reconcile).
  //   2. Numeric Console-era org_id → consoleOrgLookup (legacy fallback).
  // The seriesId of an API meeting is m.series_id for recurring, m.event_id
  // for ad-hoc (matches reconciliation's seriesIdFor() helper).
  const orgSlugFor = (m) => {
    const seriesId = m.series_id || m.event_id;
    if (seriesId && seriesOrgLookup[seriesId]) return seriesOrgLookup[seriesId];
    if (m.org_id != null) return consoleOrgLookup[String(m.org_id)] || null;
    return null;
  };

  const filtered = useMemo(() => {
    const base = meetings.filter((m) => !archivedSeries.has(m.series_id || m.event_id));
    if (orgFilter === "all") return base;
    return base.filter((m) => orgSlugFor(m) === orgFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings, orgFilter, consoleOrgLookup, seriesOrgLookup, archivedSeries]);

  // Recurring series — derived from filtered list
  const recurringSeries = useMemo(() => groupRecurringMeetings(filtered), [filtered]);

  // Upcoming = non-recurring meetings with date >= now (asc by date)
  const upcomingMeetings = useMemo(() => {
    const now = new Date();
    return filtered
      .filter((m) => m.type !== "recurring" && m.date && new Date(m.date) >= now)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [filtered]);

  // Past = non-recurring meetings with date < now (reverse chronological)
  const pastMeetings = useMemo(() => {
    const now = new Date();
    return filtered
      .filter((m) => m.type !== "recurring" && m.date && new Date(m.date) < now)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [filtered]);

  // Calendar grid: index by YYYY-MM-DD for fast cell lookup
  const meetingsByDate = useMemo(() => {
    const idx = {};
    filtered.forEach((m) => {
      if (!m.date) return;
      const key = m.date.slice(0, 10);
      if (!idx[key]) idx[key] = [];
      idx[key].push(m);
    });
    return idx;
  }, [filtered]);

  // Day cells covering startOfWeek(monthStart) → endOfWeek(monthEnd)
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    const result = [];
    let d = start;
    while (d <= end) {
      result.push(d);
      d = addDays(d, 1);
    }
    return result;
  }, [currentMonth]);

  // Email → user-record map for proper pastel avatars on internal attendees
  const userByEmail = useMemo(() => {
    const m = {};
    (users || []).forEach((u) => {
      if (u.email) m[u.email.toLowerCase()] = u;
    });
    return m;
  }, [users]);

  const today = new Date();

  const closePopover = () => {
    setPopoverAnchor(null);
    setPopoverMeeting(null);
  };

  // Retire a meeting: flag its calendar_series `archived: true`. The Calendar's
  // archivedSeries set is derived live from the calendar_series subscription,
  // so the meeting drops off everywhere as soon as the write lands — no API
  // call and no list invalidation needed. Used for retired/replaced series
  // (e.g. a renamed biweekly) and legacy events that can't be rescheduled.
  const handleRetire = async (meeting) => {
    const seriesId = meeting?.series_id || meeting?.event_id;
    if (!seriesId) return;
    if (!window.confirm(
      `Retire "${meeting.title || "this meeting"}"?\n\nIt'll be hidden from the calendar everywhere. ` +
      `Nothing is emailed and the event is left untouched in Google/Outlook — use this for replaced or stale series.`
    )) return;
    try {
      await setDoc(
        doc(db, "calendar_series", seriesId),
        { archived: true, updatedAt: serverTimestamp(), updatedByUid: user?.uid || null },
        { merge: true },
      );
      closePopover();
    } catch (err) {
      console.error("[Calendar] retire failed:", err);
      window.alert(`Retire failed: ${err.message}`);
    }
  };

  // Card click → open popover anchored to the card. For RecurringCard we
  // anchor the popover on the next-instance meeting so Reschedule operates
  // on a real Google event id rather than the abstract series.
  const openCardPopover = (event, meetingLike) => {
    event.stopPropagation();
    setPopoverAnchor(event.currentTarget);
    setPopoverMeeting(meetingLike);
  };

  return (
    <Box sx={{ py: 4, px: 3, maxWidth: 1200, mx: "auto" }}>
      {/* Page header */}
      <Box sx={{ mb: 3, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography sx={{ fontFamily: t.serif, fontSize: 28, fontWeight: 400, color: t.ink }}>
          Meeting Agendas
        </Typography>
        <Box
          component="button"
          onClick={() => setNewMeetingOpen(true)}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.6,
            px: 1.8,
            py: 0.9,
            borderRadius: 1,
            border: `1px solid ${t.copper}`,
            background: t.copper,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "background 0.15s, border-color 0.15s",
            "&:hover": { background: "#a0612b", borderColor: "#a0612b" },
          }}
        >
          + New Meeting
        </Box>
      </Box>

      {/* Org filter chips */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, mb: 3 }} useFlexGap>
        <Chip
          label="All"
          onClick={() => setOrgFilter("all")}
          variant={orgFilter === "all" ? "filled" : "outlined"}
          color={orgFilter === "all" ? "primary" : "default"}
          size="small"
        />
        {[...(orgs || [])]
          .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))
          .map((org) => (
            <Chip
              key={org.id}
              label={org.name}
              onClick={() => setOrgFilter(org.id)}
              variant={orgFilter === org.id ? "filled" : "outlined"}
              size="small"
              sx={{
                ...(orgFilter === org.id && {
                  bgcolor: org.accentColor || "primary.main",
                  color: "#fff",
                }),
              }}
            />
          ))}
      </Stack>

      {/* ═══ RECURRING MEETINGS ═══ */}
      <GroupHeader color={t.copper} label="Recurring Meetings" />
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 2, mb: 3.5, ml: "11px" }}>
        {recurringSeries.map((series) => {
          // The "actionable" target for popover/reschedule is the next instance
          // of the series — that's the event the reschedule callable patches.
          const nextInstance = series.instances?.find((i) => new Date(i.date) >= today) || series.instances?.[0];
          return (
            <RecurringCard
              key={series.seriesKey}
              series={series}
              userByEmail={userByEmail}
              onClick={(e) => nextInstance && openCardPopover(e, nextInstance)}
            />
          );
        })}
        {recurringSeries.length === 0 && !meetingsQuery.isLoading && (
          <Typography sx={{ fontSize: 12, color: t.ink3, fontStyle: "italic", py: 2 }}>
            No recurring meetings in the next 90 days.
          </Typography>
        )}
      </Box>

      {/* ═══ UPCOMING MEETINGS ═══ */}
      <GroupHeader color={t.purple} label="Upcoming Meetings" />
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 2, mb: 3.5, ml: "11px" }}>
        {upcomingMeetings.map((m) => (
          <AdHocCard
            key={m.event_id}
            meeting={m}
            userByEmail={userByEmail}
            onClick={(e) => openCardPopover(e, m)}
          />
        ))}
        {upcomingMeetings.length === 0 && !meetingsQuery.isLoading && (
          <Typography sx={{ fontSize: 12, color: t.ink3, fontStyle: "italic", py: 2 }}>
            No upcoming ad-hoc meetings.
          </Typography>
        )}
      </Box>

      {/* ═══ PAST MEETINGS (collapsible) ═══ */}
      <Box
        onClick={() => setPastExpanded(!pastExpanded)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          cursor: "pointer",
          py: 1,
          mb: pastExpanded ? 1.5 : 2.5,
        }}
      >
        <Box sx={{ width: 3, height: 18, borderRadius: 1, background: "#9e9e9e", flexShrink: 0 }} />
        <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "#9e9e9e" }}>
          Past Meetings
        </Typography>
        <Typography sx={{ fontSize: 10, color: t.cream3 }}>
          {pastExpanded ? "▼" : "▶"} {pastMeetings.length} meeting{pastMeetings.length !== 1 ? "s" : ""}
        </Typography>
      </Box>
      <Collapse in={pastExpanded}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 2,
            mb: 3.5,
            ml: "11px",
            opacity: 0.7,
          }}
        >
          {pastMeetings.map((m) => (
            <AdHocCard
              key={m.event_id}
              meeting={m}
              userByEmail={userByEmail}
              onClick={(e) => openCardPopover(e, m)}
            />
          ))}
          {pastMeetings.length === 0 && (
            <Typography sx={{ fontSize: 12, color: t.ink3, fontStyle: "italic", py: 2 }}>
              No past ad-hoc meetings in window.
            </Typography>
          )}
        </Box>
      </Collapse>

      {/* ═══ CALENDAR ═══ */}
      <Box sx={{ mt: 4 }}>
        {/* Month nav header */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton
              size="small"
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              sx={{ color: t.ink3 }}
              aria-label="Previous month"
            >
              <ChevronLeft sx={{ fontSize: 20 }} />
            </IconButton>
            <Typography sx={{ fontFamily: t.serif, fontSize: 20, fontWeight: 500, color: t.ink, minWidth: 160, textAlign: "center" }}>
              {format(currentMonth, "MMMM yyyy")}
            </Typography>
            <IconButton
              size="small"
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              sx={{ color: t.ink3 }}
              aria-label="Next month"
            >
              <ChevronRight sx={{ fontSize: 20 }} />
            </IconButton>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <IconButton
              size="small"
              onClick={() => meetingsQuery.refetch()}
              disabled={meetingsQuery.isFetching}
              aria-label="Refresh"
              sx={{ color: t.ink3 }}
            >
              <Refresh sx={{ fontSize: 18 }} />
            </IconButton>
            <IconButton size="small" onClick={() => setCurrentMonth(new Date())} aria-label="Jump to today">
              <Typography sx={{ fontSize: 11, fontWeight: 600, color: t.copper }}>Today</Typography>
            </IconButton>
          </Box>
        </Box>

        {/* Day-of-week headers */}
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${t.cream3}` }}>
          {DAY_NAMES.map((d) => (
            <Box key={d} sx={{ py: 0.8, textAlign: "center" }}>
              <Typography sx={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: t.ink3 }}>
                {d}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Calendar grid */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            border: `1px solid ${t.cream3}`,
            borderTop: "none",
            borderRadius: "0 0 12px 12px",
            overflow: "hidden",
          }}
        >
          {days.map((d, i) => {
            const dateKey = format(d, "yyyy-MM-dd");
            const dayMeetings = meetingsByDate[dateKey] || [];
            const inMonth = isSameMonth(d, currentMonth);
            const isCurrentDay = isToday(d);

            return (
              <Box
                key={i}
                sx={{
                  minHeight: 80,
                  p: 0.8,
                  borderRight: (i + 1) % 7 !== 0 ? `1px solid ${t.cream3}` : "none",
                  borderBottom: i < days.length - 7 ? `1px solid ${t.cream3}` : "none",
                  background: isCurrentDay ? t.copperFaint : inMonth ? "white" : t.cream,
                  transition: "background 0.1s",
                }}
              >
                <Typography
                  sx={{
                    fontSize: 11,
                    fontWeight: isCurrentDay ? 700 : 400,
                    color: isCurrentDay ? "white" : inMonth ? t.ink : t.cream3,
                    mb: 0.5,
                    ...(isCurrentDay && {
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: t.copper,
                    }),
                  }}
                >
                  {format(d, "d")}
                </Typography>

                {dayMeetings.map((m) => {
                  const isRecurring = m.type === "recurring";
                  const chipColor = isRecurring ? t.copper : t.purple;
                  const pastMeeting = m.date && isBefore(parseISO(m.date), today);
                  return (
                    <Box
                      key={m.event_id}
                      onClick={(e) => openCardPopover(e, m)}
                      sx={{
                        mt: 0.3,
                        px: 0.8,
                        py: 0.3,
                        borderRadius: "4px",
                        borderLeft: `3px solid ${chipColor}`,
                        background: isRecurring ? "rgba(184,115,51,0.1)" : "rgba(94,53,177,0.08)",
                        cursor: "pointer",
                        opacity: pastMeeting ? 0.45 : 1,
                        transition: "opacity 0.15s, background 0.15s",
                        "&:hover": {
                          opacity: pastMeeting ? 0.7 : 1,
                          background: isRecurring ? "rgba(184,115,51,0.18)" : "rgba(94,53,177,0.15)",
                        },
                        overflow: "hidden",
                      }}
                    >
                      <Typography
                        sx={{
                          fontSize: 9,
                          fontWeight: 600,
                          color: chipColor,
                          lineHeight: 1.3,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {m.title || "(untitled)"}
                      </Typography>
                      <Typography sx={{ fontSize: 8, color: t.ink3, lineHeight: 1.2 }}>
                        {m.date ? format(parseISO(m.date), "h:mm a") : ""}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>

        {meetingsQuery.isLoading && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2, px: 1 }}>
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.secondary">Loading meetings…</Typography>
          </Stack>
        )}
        {meetingsQuery.isError && (
          <Typography variant="body2" color="error" sx={{ mt: 2, px: 1 }}>
            Failed to load meetings: {meetingsQuery.error.message}
          </Typography>
        )}
      </Box>

      {/* Shared meeting-preview popover (opened by both calendar chip clicks
          AND Recurring/AdHoc card clicks) */}
      <Popover
        open={Boolean(popoverAnchor)}
        anchorEl={popoverAnchor}
        onClose={closePopover}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              borderRadius: "12px",
              minWidth: 320,
              maxWidth: 340,
              p: 2.5,
              boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            },
          },
        }}
      >
        {popoverMeeting && (() => {
          const m = popoverMeeting;
          const meetingDate = m.date ? parseISO(m.date) : null;
          const meetingEnd = m.end_date ? parseISO(m.end_date) : null;
          const timeStr = meetingDate && meetingEnd
            ? `${format(meetingDate, "h:mm")} – ${format(meetingEnd, "h:mm a")}`
            : meetingDate ? format(meetingDate, "h:mm a") : "";
          const isRecurring = m.type === "recurring";
          const canReschedule = !!m.m365EventId;

          // Resolve the Firestore docs backing this meeting for the cancel
          // flow. Agenda doc id == series_id (recurring) / event_id (ad-hoc),
          // same key the Open Agenda route uses.
          const seriesId = m.series_id || m.event_id;
          const seriesDoc = (calendarSeriesDocs || []).find((s) => s.id === seriesId) || null;
          const agendaForMeeting =
            agendaByExternalId[m.event_id]
            || agendaByExternalId[m.m365EventId]
            || agendaByExternalId[m.series_id]
            || (agendaDocs || []).find((a) => a.id === seriesId)
            || null;
          // Only offer Cancel when the meeting is actually API-cancellable
          // (has a Graph binding the cancel dialog can act on). An unbound
          // legacy meeting would otherwise get a Firestore-only "cancel" that
          // reports success while the real Google/Outlook event lives on —
          // for those, Retire is the correct path (see the legacy note below).
          const canCancel = !!(seriesDoc?.graphSeriesEventId || agendaForMeeting?.graphEventId);

          return (
            <Box>
              <IconButton
                size="small"
                onClick={closePopover}
                sx={{ position: "absolute", top: 8, right: 8, color: t.ink3 }}
                aria-label="Close"
              >
                <Close sx={{ fontSize: 18 }} />
              </IconButton>

              <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.2, pr: 3 }}>
                <Box sx={{ width: 14, height: 14, borderRadius: "3px", background: isRecurring ? t.copper : t.purple, flexShrink: 0, mt: "4px" }} />
                <Box>
                  <Typography sx={{ fontSize: 18, fontWeight: 600, color: t.ink, lineHeight: 1.3 }}>
                    {m.title || "(untitled)"}
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: t.ink3, mt: 0.3 }}>
                    {meetingDate ? format(meetingDate, "EEEE, MMMM d") : ""}{timeStr ? ` · ${timeStr}` : ""}
                  </Typography>
                  {isRecurring && (
                    <Typography sx={{ fontSize: 12, color: t.ink3, opacity: 0.7, mt: 0.2 }}>
                      Recurring meeting
                    </Typography>
                  )}
                </Box>
              </Box>

              <Divider sx={{ my: 1.5 }} />

              {m.teams_url && (
                <>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.2, py: 0.5 }}>
                    <Box sx={{ width: 20, height: 20, borderRadius: "4px", background: "#5059C9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Typography sx={{ fontSize: 11, fontWeight: 700, color: "white", lineHeight: 1 }}>T</Typography>
                    </Box>
                    <Typography
                      component="a"
                      href={m.teams_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ fontSize: 13, color: "#5059C9", textDecoration: "none", fontWeight: 500, "&:hover": { textDecoration: "underline" } }}
                    >
                      Microsoft Teams Meeting
                    </Typography>
                  </Box>
                  <Divider sx={{ my: 1.5 }} />
                </>
              )}

              {(() => {
                const displayAttendees = visibleAttendees(m.attendees);
                if (!displayAttendees.length) return null;
                return (
                  <>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, mb: 1 }}>
                      <People sx={{ fontSize: 16, color: t.ink3 }} />
                      <Typography sx={{ fontSize: 13, fontWeight: 600, color: t.ink }}>
                        {displayAttendees.length} attendee{displayAttendees.length !== 1 ? "s" : ""}
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.8, maxHeight: 180, overflowY: "auto", mb: 1.5 }}>
                      {displayAttendees.map((a, idx) => {
                        const userRecord = a.email ? userByEmail[a.email.toLowerCase()] : null;
                        const userForAvatar = userRecord || { displayName: a.name || a.email, email: a.email };
                        return (
                          <Box key={idx} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <MemberAvatar user={userForAvatar} size={24} border={false} tooltip={false} />
                            <Typography sx={{ fontSize: 13, color: t.ink }}>{a.name || a.email}</Typography>
                          </Box>
                        );
                      })}
                    </Box>
                    <Divider sx={{ my: 1.5 }} />
                  </>
                );
              })()}

              {/* Primary: Open Agenda (V2.2 — agenda detail page now exists).
                  Secondary: Reschedule (kept on the popover for V2.2.1; will
                  move into the agenda detail hero's schedule popover in
                  V2.2.2). */}
              <Box
                component="button"
                onClick={() => {
                  closePopover();
                  // Agenda doc id == series_id for recurring or event_id for ad-hoc.
                  // The reconciliation worker uses the same key, so this URL
                  // always lines up with a real agendas/{id} doc.
                  const agendaIdForRoute = popoverMeeting.series_id || popoverMeeting.event_id;
                  navigate(`/agendas/${agendaIdForRoute}`);
                }}
                sx={{
                  width: "100%",
                  py: 1,
                  border: "none",
                  borderRadius: "8px",
                  background: t.copper,
                  color: "white",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.15s",
                  "&:hover": { background: "#a0622d" },
                }}
              >
                Open Agenda
              </Box>
              <Box
                component="button"
                onClick={() => {
                  setRescheduleTarget(popoverMeeting);
                  closePopover();
                }}
                disabled={!canReschedule}
                sx={{
                  width: "100%",
                  mt: 1,
                  py: 0.8,
                  border: `1px solid ${canReschedule ? t.cream3 : "#e0e0e0"}`,
                  borderRadius: "8px",
                  background: "transparent",
                  color: canReschedule ? t.ink2 : t.ink3,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: canReschedule ? "pointer" : "not-allowed",
                  transition: "background 0.15s, border-color 0.15s",
                  "&:hover": canReschedule
                    ? { background: t.cream2, borderColor: t.ink3 }
                    : {},
                }}
              >
                Reschedule
              </Box>

              {/* Cancel + Retire — meeting lifecycle actions. Cancel routes
                  through CancelMeetingDialog (next / all-future + emails;
                  all-future archives the agenda). Retire just hides a
                  replaced/stale series from the calendar (no emails). */}
              <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                {canCancel && (
                  <Box
                    component="button"
                    onClick={() => {
                      setCancelTarget({
                        agenda: agendaForMeeting,
                        agendaId: agendaForMeeting?.id || seriesId,
                        calendarSeries: seriesDoc,
                      });
                      closePopover();
                    }}
                    sx={{
                      flex: 1,
                      py: 0.8,
                      border: "1px solid #e9c4c4",
                      borderRadius: "8px",
                      background: "transparent",
                      color: "#b3261e",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      transition: "background 0.15s, border-color 0.15s",
                      "&:hover": { background: "#fbedec", borderColor: "#b3261e" },
                    }}
                  >
                    Cancel meeting
                  </Box>
                )}
                <Box
                  component="button"
                  onClick={() => handleRetire(m)}
                  sx={{
                    flex: 1,
                    py: 0.8,
                    border: `1px solid ${t.cream3}`,
                    borderRadius: "8px",
                    background: "transparent",
                    color: t.ink3,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "background 0.15s, border-color 0.15s",
                    "&:hover": { background: t.cream2, borderColor: t.ink3 },
                  }}
                >
                  Retire
                </Box>
              </Box>

              {!canReschedule && (
                <Typography sx={{ fontSize: 11, color: t.ink3, mt: 0.8, textAlign: "center", lineHeight: 1.4 }}>
                  Reschedule isn’t available — this meeting predates the new system.
                  Use <strong>Retire</strong> to hide it, then recreate it via <strong>+ New Meeting</strong>.
                </Typography>
              )}
            </Box>
          );
        })()}
      </Popover>

      {rescheduleTarget && (
        <RescheduleDialog
          meeting={rescheduleTarget}
          agenda={
            agendaByExternalId[rescheduleTarget.event_id]
            || agendaByExternalId[rescheduleTarget.m365EventId]
            || agendaByExternalId[rescheduleTarget.series_id]
            || null
          }
          onClose={() => setRescheduleTarget(null)}
          onSuccess={() => setRescheduleTarget(null)}
        />
      )}

      {cancelTarget && (
        <CancelMeetingDialog
          agenda={cancelTarget.agenda}
          agendaId={cancelTarget.agendaId}
          calendarSeries={cancelTarget.calendarSeries}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {newMeetingOpen && (
        <NewMeetingDialog
          orgs={orgs}
          users={users}
          onClose={() => setNewMeetingOpen(false)}
        />
      )}
    </Box>
  );
}
