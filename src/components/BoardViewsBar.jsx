// src/components/BoardViewsBar.jsx
//
// Board Chat's saved filter views on the Task Board: one "AI views" button
// opening a searchable list (newest first), and the view that is on shown as
// a single pill beside it. Each view can be turned on or off, refreshed
// (rerun its request against the board as it is now) or deleted. Scales to
// any number of views without crowding the board.
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Badge,
  Box,
  Button,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";

// The list gets a search box once it is longer than this.
const SEARCH_FROM = 6;

const countLabel = (n) => (n == null ? "Filter" : `${n} item${n === 1 ? "" : "s"}`);

function when(view) {
  const ms = view.refreshedAtMs || view.createdAtMs;
  if (!ms) return null;
  return `${view.refreshedAtMs ? "refreshed" : "made"} ${formatDistanceToNow(new Date(ms), { addSuffix: true })}`;
}

// views: [{ id, label, request, filters, createdAtMs, refreshedAtMs }].
// itemCount(view) → number | null (null for a column-filter view).
// onToggle(id) switches a view on or off (or, when edited, puts its filters
// back); onTurnOff turns the view that is on off.
export default function BoardViewsBar({ views, activeId, edited, itemCount, onToggle, onTurnOff, onDelete, onRefresh, refreshingId = null }) {
  const [anchor, setAnchor] = useState(null);
  const [query, setQuery] = useState("");
  if (views.length === 0) return null;

  const active = views.find((v) => v.id === activeId) || null;
  const q = query.trim().toLowerCase();
  const shown = [...views].reverse()
    .filter((v) => !q || `${v.label} ${v.request || ""}`.toLowerCase().includes(q));

  return (
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
      <Badge badgeContent={views.length} color="secondary" max={99}>
        <Button
          size="small"
          variant="outlined"
          color="secondary"
          startIcon={<AutoAwesomeIcon fontSize="small" />}
          endIcon={<ExpandMoreIcon fontSize="small" />}
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-haspopup="true"
          aria-expanded={Boolean(anchor)}
          sx={{ textTransform: "none" }}
        >
          AI views
        </Button>
      </Badge>

      {active && (
        <Box
          role="group"
          aria-label={`View on: ${active.label}`}
          sx={{
            display: "inline-flex", alignItems: "center", gap: 0.5, pl: 1.25, pr: 0.25, height: 30,
            borderRadius: 15, bgcolor: "secondary.main", color: "secondary.contrastText", maxWidth: "100%",
          }}
        >
          <AutoAwesomeIcon sx={{ fontSize: 15, opacity: 0.85 }} />
          <Typography noWrap sx={{ fontSize: 13, fontWeight: 600, minWidth: 0 }}>{active.label}</Typography>
          <Typography noWrap sx={{ fontSize: 12, opacity: 0.85, flexShrink: 0 }}>
            {`· ${countLabel(itemCount(active))}${edited ? " · edited" : ""}`}
          </Typography>
          {edited && (
            <Tooltip title="You changed the filters since — put the view's back">
              <Button
                size="small"
                onClick={() => onToggle(active.id)}
                aria-label={`Reapply view ${active.label}`}
                sx={{ color: "inherit", minWidth: 0, px: 0.75, py: 0, fontSize: 12, textTransform: "none", textDecoration: "underline" }}
              >
                Reapply
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Refresh: rerun this view's request on the board as it is now">
            <span>
              <IconButton
                size="small"
                aria-label={`Refresh view ${active.label}`}
                onClick={() => onRefresh(active)}
                disabled={refreshingId === active.id}
                sx={{ color: "inherit", p: 0.4 }}
              >
                <RefreshIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Turn the view off">
            <IconButton size="small" aria-label={`Turn off view ${active.label}`} onClick={onTurnOff} sx={{ color: "inherit", p: 0.4 }}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: 380, maxWidth: "calc(100vw - 32px)" } } }}
      >
        <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
          <Typography variant="subtitle2">Saved AI views</Typography>
          <Typography variant="caption" color="text.secondary">Made by Board Chat. Click one to show it on the board.</Typography>
          {views.length > SEARCH_FROM && (
            <TextField
              size="small"
              fullWidth
              autoFocus
              placeholder="Find a view…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              sx={{ mt: 1 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment> }}
            />
          )}
        </Box>
        <List dense sx={{ maxHeight: 360, overflowY: "auto", pt: 0 }}>
          {shown.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>No view matches.</Typography>
          )}
          {shown.map((v) => {
            const on = v.id === activeId;
            const meta = [countLabel(itemCount(v)), when(v)].filter(Boolean).join(" · ");
            return (
              <ListItemButton
                key={v.id}
                selected={on}
                aria-pressed={on}
                onClick={() => onToggle(v.id)}
                sx={{ pr: 10, "& .view-actions": { opacity: 0.55 }, "&:hover .view-actions, &:focus-within .view-actions": { opacity: 1 } }}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  {on ? <CheckIcon fontSize="small" color="secondary" /> : <AutoAwesomeIcon fontSize="small" sx={{ color: "text.disabled" }} />}
                </ListItemIcon>
                <ListItemText
                  primary={v.label}
                  secondary={meta}
                  primaryTypographyProps={{ noWrap: true, fontWeight: on ? 600 : 400 }}
                  secondaryTypographyProps={{ noWrap: true }}
                  title={v.request || v.label}
                />
                <Box className="view-actions" sx={{ position: "absolute", right: 8, display: "flex" }} onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="Refresh">
                    <span>
                      <IconButton size="small" aria-label={`Refresh ${v.label}`} disabled={refreshingId === v.id} onClick={() => { setAnchor(null); onRefresh(v); }}>
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton size="small" aria-label={`Delete ${v.label}`} onClick={() => onDelete(v.id)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </ListItemButton>
            );
          })}
        </List>
      </Popover>
    </Stack>
  );
}
