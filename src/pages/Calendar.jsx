// V2.1 — Calendar page ported from Console's Agenda.jsx (archive lines
// 568-1447). Three stacked sections:
//   1. Recurring Meetings — copper card grid
//   2. Ad Hoc Meetings    — purple card grid (future-dated non-recurring)
//   3. Calendar           — month grid with meeting chips
// Org filter chips at the top apply to all three sections. Card clicks
// open the same preview popover the calendar chip clicks open. V2.1 swaps
// Console's "Open Agenda" primary action for "Reschedule" since the agenda
// detail pages don't exist yet (V2.3).

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocalStorage } from "@uidotdev/usehooks";
import {
  Avatar,
  Box,
  Chip,
  CircularProgress,
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
} from "date-fns";

import { useCollection } from "../hooks/useCollection.js";
import { listMeetings } from "../lib/meetingsApi.js";
import { groupRecurringMeetings, detectCadence } from "../lib/meetingHelpers.js";
import MemberAvatar from "../components/MemberAvatar.jsx";
import RescheduleDialog from "../components/RescheduleDialog.jsx";

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
  if (!attendees?.length) return null;
  const visible = attendees.slice(0, max);
  const overflow = attendees.length - visible.length;
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

function RecurringCard({ series, userByEmail, onClick }) {
  const cadenceLabel = detectCadence(series.instanceCount);
  const nextDt = series.nextDate ? parseISO(series.nextDate) : null;

  return (
    <Box
      onClick={onClick}
      sx={{
        background: "white",
        borderRadius: "14px",
        cursor: "pointer",
        overflow: "hidden",
        transition: "transform 0.15s, box-shadow 0.15s",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)",
        borderLeft: `4px solid ${t.copper}`,
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: "0 4px 20px rgba(184,115,51,0.15)",
        },
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ p: 2.5, flex: 1, display: "flex", flexDirection: "column" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
          <Typography sx={{ fontFamily: t.sans, fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.copper }}>
            Recurring{cadenceLabel ? ` · ${cadenceLabel}` : ""}
          </Typography>
          <ChevronRight sx={{ fontSize: 18, color: t.cream3 }} />
        </Box>

        <Typography sx={{ fontFamily: t.serif, fontSize: 18, fontWeight: 500, color: t.ink, mb: 0.3 }}>
          {series.title || "(untitled)"}
        </Typography>
        <Typography sx={{ fontSize: 11, color: t.ink3, mb: 1.5, display: "flex", alignItems: "center", gap: 0.5 }}>
          <Schedule sx={{ fontSize: 12 }} />
          {nextDt ? `Next: ${format(nextDt, "MMM d 'at' h:mm a")}` : "No upcoming instances"}
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", mt: "auto", pt: 1.5, borderTop: `1px solid ${t.cream}` }}>
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
        background: "white",
        borderRadius: "14px",
        cursor: "pointer",
        overflow: "hidden",
        transition: "transform 0.15s, box-shadow 0.15s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        border: "2px solid transparent",
        borderLeft: `4px solid ${t.purple}`,
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
        },
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ p: 2.5, flex: 1, display: "flex", flexDirection: "column" }}>
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
          <ChevronRight sx={{ fontSize: 18, color: t.cream3 }} />
        </Box>

        <Typography sx={{ fontFamily: t.serif, fontSize: 18, fontWeight: 500, color: t.ink, mb: 0.3 }}>
          {meeting.title || "(untitled)"}
        </Typography>

        {dt && (
          <Typography sx={{ fontSize: 11, color: t.ink3, mb: 1.5, display: "flex", alignItems: "center", gap: 0.5 }}>
            <Schedule sx={{ fontSize: 12 }} />
            {format(dt, "MMM d 'at' h:mm a")}
          </Typography>
        )}

        {meeting.attendees?.length > 0 && (
          <Box sx={{ display: "flex", alignItems: "center", mt: "auto", pt: 1.5, borderTop: `1px solid ${t.cream}` }}>
            <AttendeeAvatars attendees={meeting.attendees} userByEmail={userByEmail} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────

export default function Calendar() {
  const { data: orgs } = useCollection("organizations");
  const { data: users } = useCollection("users");
  const [orgFilter, setOrgFilter] = useLocalStorage("vm-calendar-org-filter", "all");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [popoverAnchor, setPopoverAnchor] = useState(null);
  const [popoverMeeting, setPopoverMeeting] = useState(null);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);

  // Single broad query: visible-month window EXTENDED forward 90 days so
  // the Recurring + Ad-Hoc card sections always have upcoming data. The
  // calendar grid (current month) is a subset; cards filter ahead.
  const queryWindow = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const today = new Date();
    const futureEnd = addDays(today, 90);
    const monthGridEnd = endOfWeek(endOfMonth(currentMonth));
    const end = futureEnd > monthGridEnd ? futureEnd : monthGridEnd;
    return { start: start.toISOString(), end: end.toISOString() };
  }, [currentMonth]);

  const meetingsQuery = useQuery({
    queryKey: ["meetings-list", queryWindow.start, queryWindow.end],
    queryFn: () => listMeetings({ start: queryWindow.start, end: queryWindow.end }),
  });
  const meetings = meetingsQuery.data?.meetings || [];

  // Client-side org filter applied to all three sections. NOTE legacy
  // meetings@'s events still carry numeric Console-era orgIds in
  // extendedProperties; Management orgs use slugs. Until a one-shot rewrite
  // runs, only "All" matches every existing meeting.
  const filtered = useMemo(() => {
    if (orgFilter === "all") return meetings;
    return meetings.filter((m) => m.org_id === orgFilter);
  }, [meetings, orgFilter]);

  // Recurring series — derived from filtered list
  const recurringSeries = useMemo(() => groupRecurringMeetings(filtered), [filtered]);

  // Ad-hoc upcoming = single (non-recurring) meetings with date >= now
  const adHocUpcoming = useMemo(() => {
    const now = new Date();
    return filtered
      .filter((m) => m.type !== "recurring" && m.date && new Date(m.date) >= now)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
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
      <Box sx={{ mb: 3 }}>
        <Typography sx={{ fontFamily: t.serif, fontSize: 28, fontWeight: 400, color: t.ink }}>
          Meetings
        </Typography>
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
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 2, mb: 3.5, ml: "11px" }}>
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

      {/* ═══ AD HOC MEETINGS ═══ */}
      <GroupHeader color={t.purple} label="Ad Hoc Meetings" />
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 2, mb: 3.5, ml: "11px" }}>
        {adHocUpcoming.map((m) => (
          <AdHocCard
            key={m.event_id}
            meeting={m}
            userByEmail={userByEmail}
            onClick={(e) => openCardPopover(e, m)}
          />
        ))}
        {adHocUpcoming.length === 0 && !meetingsQuery.isLoading && (
          <Typography sx={{ fontSize: 12, color: t.ink3, fontStyle: "italic", py: 2 }}>
            No upcoming ad-hoc meetings.
          </Typography>
        )}
      </Box>

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

              {m.attendees?.length > 0 && (
                <>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, mb: 1 }}>
                    <People sx={{ fontSize: 16, color: t.ink3 }} />
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: t.ink }}>
                      {m.attendees.length} attendee{m.attendees.length !== 1 ? "s" : ""}
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.8, maxHeight: 180, overflowY: "auto", mb: 1.5 }}>
                    {m.attendees.map((a, idx) => {
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
              )}

              {/* V2.1 primary action — Reschedule. V2.3 will add "Open Agenda"
                  alongside this once agenda detail pages exist. */}
              <Box
                component="button"
                onClick={() => {
                  setRescheduleTarget(popoverMeeting);
                  closePopover();
                }}
                disabled={!canReschedule}
                sx={{
                  width: "100%",
                  py: 1,
                  border: "none",
                  borderRadius: "8px",
                  background: canReschedule ? t.copper : "#cfcfcf",
                  color: "white",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: canReschedule ? "pointer" : "not-allowed",
                  transition: "background 0.15s",
                  "&:hover": canReschedule ? { background: "#a0622d" } : {},
                }}
              >
                Reschedule
              </Box>
              {!canReschedule && (
                <Typography sx={{ fontSize: 11, color: t.ink3, mt: 0.8, textAlign: "center" }}>
                  This meeting was created before the new system — cancel and recreate to migrate.
                </Typography>
              )}
            </Box>
          );
        })()}
      </Popover>

      {rescheduleTarget && (
        <RescheduleDialog
          meeting={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          onSuccess={() => {
            setRescheduleTarget(null);
            meetingsQuery.refetch();
          }}
        />
      )}
    </Box>
  );
}
