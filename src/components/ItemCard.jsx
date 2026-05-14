import { Box, Chip, Stack, Typography } from "@mui/material";
import { Calendar, PauseCircle } from "lucide-react";

import { useCollection } from "../hooks/useCollection.js";

function formatDue(dueDate) {
  if (!dueDate) return null;
  const d = dueDate.toDate ? dueDate.toDate() : new Date(dueDate);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isOverdue(dueDate, statusId) {
  if (!dueDate) return false;
  if (statusId === 5) return false; // Done — never overdue
  const d = dueDate.toDate ? dueDate.toDate() : new Date(dueDate);
  return d.getTime() < Date.now();
}

export default function ItemCard({ item, orgLookup, userLookup }) {
  const org = orgLookup?.[item.organizationId];
  const assignee = userLookup?.[item.assigneeId];

  const dueText = formatDue(item.dueDate);
  const overdue = isOverdue(item.dueDate, item.statusId);

  return (
    <Box
      sx={(theme) => ({
        p: 3,
        borderRadius: 1.5,
        bgcolor: "background.paper",
        boxShadow: 1,
        border: `1px solid ${theme.palette.divider}`,
        opacity: item.onHold ? 0.7 : 1,
      })}
    >
      <Stack spacing={2}>
        <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.35 }}>
          {item.title}
        </Typography>

        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          {org ? (
            <Chip
              size="small"
              label={org.name}
              sx={{
                bgcolor: org.accentColor || "#888",
                color: "rgba(0,0,0,0.78)",
                fontWeight: 600,
                fontSize: 11,
                height: 20,
              }}
            />
          ) : null}

          {item.onHold ? (
            <Chip
              size="small"
              icon={<PauseCircle size={12} />}
              label="On hold"
              variant="outlined"
              sx={{ fontSize: 11, height: 20 }}
            />
          ) : null}

          {dueText ? (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Calendar size={12} color={overdue ? "#d32f2f" : undefined} />
              <Typography
                variant="caption"
                sx={{ color: overdue ? "error.main" : "text.secondary", fontWeight: overdue ? 600 : 400 }}
              >
                {dueText}
              </Typography>
            </Stack>
          ) : null}

          <Box sx={{ flex: 1 }} />

          {assignee ? (
            <Box
              sx={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                bgcolor: assignee.avatarColor || "primary.main",
                color: "rgba(0,0,0,0.78)",
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                fontWeight: 700,
              }}
              title={assignee.displayName || assignee.email}
            >
              {(assignee.firstName || assignee.email || "?").slice(0, 1).toUpperCase()}
            </Box>
          ) : null}
        </Stack>
      </Stack>
    </Box>
  );
}
