// src/pages/Calendar.jsx
//
// V2.1 — read-only list of upcoming meetings from meetings@'s Graph/Google
// calendar, filtered by Organization. Each row has a Reschedule button that
// opens the RescheduleDialog.
//
// Data flow: useQuery("meetings-list") → GET /api/meetings/list → backend
// reads from Google mirror, enriches with Graph RSVPs. Refetches after a
// successful reschedule.

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocalStorage } from "@uidotdev/usehooks";
import styled from "@emotion/styled";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { Refresh, EventRepeat, Event as EventIcon, Schedule } from "@mui/icons-material";
import { format, addDays, startOfDay } from "date-fns";

import { useCollection } from "../hooks/useCollection.js";
import { listMeetings } from "../lib/meetingsApi.js";
import RescheduleDialog from "../components/RescheduleDialog.jsx";

const PageHeader = styled(Box)`
  padding: 24px 32px 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const ListWrap = styled(Box)`
  padding: 0 32px 32px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const MeetingRow = styled(Box)`
  display: grid;
  grid-template-columns: 140px 1fr auto auto;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: ${({ theme }) => theme.palette.background.paper};
  border: 1px solid ${({ theme }) => theme.palette.divider};
  border-radius: 8px;
  transition: border-color 120ms ease;
  &:hover {
    border-color: ${({ theme }) => theme.palette.primary.main};
  }
`;

export default function Calendar() {
  const { data: orgs } = useCollection("organizations");
  const [orgFilter, setOrgFilter] = useLocalStorage("vm-calendar-org-filter", "all");
  const [rescheduleTarget, setRescheduleTarget] = useState(null);

  // Default window: today + 30 days
  const window = useMemo(() => {
    const start = startOfDay(new Date());
    const end = addDays(start, 30);
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);

  const meetingsQuery = useQuery({
    queryKey: ["meetings-list", window.start, window.end],
    // Backend treats null orgId as "all"; we filter client-side via chips for
    // consistent behavior with archive's PM events (numeric orgIds) and new
    // Management events (slug orgIds) coexisting.
    queryFn: () => listMeetings({ start: window.start, end: window.end }),
  });

  const meetings = meetingsQuery.data?.meetings || [];

  const visible = useMemo(() => {
    if (orgFilter === "all") return meetings;
    return meetings.filter((m) => {
      const orgId = m.org_id || m.orgId || null;
      return orgId === orgFilter;
    });
  }, [meetings, orgFilter]);

  return (
    <>
      <PageHeader>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Typography variant="h4">Calendar</Typography>
          <Typography variant="body2" color="text.secondary">
            Next 30 days · {meetings.length} meeting{meetings.length === 1 ? "" : "s"}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <IconButton
            size="small"
            onClick={() => meetingsQuery.refetch()}
            disabled={meetingsQuery.isFetching}
            aria-label="Refresh"
          >
            <Refresh fontSize="small" />
          </IconButton>
        </Stack>

        {/* Org filter chips — matches TaskBoard pattern */}
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }} useFlexGap>
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
      </PageHeader>

      <ListWrap>
        {meetingsQuery.isLoading && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2, py: 3 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">Loading meetings…</Typography>
          </Stack>
        )}

        {meetingsQuery.isError && (
          <Typography variant="body2" color="error" sx={{ px: 2, py: 3 }}>
            Failed to load meetings: {meetingsQuery.error.message}
          </Typography>
        )}

        {!meetingsQuery.isLoading && visible.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 3, fontStyle: "italic" }}>
            No meetings in the next 30 days{orgFilter !== "all" ? " for this organization" : ""}.
          </Typography>
        )}

        {visible.map((m) => {
          const start = m.date ? new Date(m.date) : null;
          const dateLabel = start ? format(start, "EEE MMM d") : "—";
          const timeLabel = start ? format(start, "h:mm a") : "—";
          const recurring = m.type === "recurring";
          return (
            <MeetingRow key={m.event_id}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{dateLabel}</Typography>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Schedule sx={{ fontSize: 14, color: "text.secondary" }} />
                  <Typography variant="caption" color="text.secondary">{timeLabel}</Typography>
                </Stack>
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  {recurring ? (
                    <EventRepeat sx={{ fontSize: 16, color: "text.secondary" }} />
                  ) : (
                    <EventIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                  )}
                  <Typography variant="body1" sx={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.title || "(untitled)"}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {(m.attendees || []).length} attendee{(m.attendees || []).length === 1 ? "" : "s"}
                  {m.teams_url ? " · Teams" : ""}
                </Typography>
              </Box>
              <Box>
                {m.teams_url && (
                  <Button
                    size="small"
                    href={m.teams_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Join
                  </Button>
                )}
              </Box>
              <Box>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setRescheduleTarget(m)}
                  disabled={!m.m365EventId}  // pre-pivot events with no Graph binding can't be rescheduled via new path
                  title={!m.m365EventId ? "Pre-pivot event — recreate via the new architecture" : ""}
                >
                  Reschedule
                </Button>
              </Box>
            </MeetingRow>
          );
        })}
      </ListWrap>

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
    </>
  );
}
