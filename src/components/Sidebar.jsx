import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Box,
  Collapse,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import {
  CalendarDays,
  Captions,
  LayoutDashboard,
  Settings,
  SquareKanban,
} from "lucide-react";

// Top-level routes. Members route removed from sidebar 2026-05-27 — page
// stub still mounted at /members for future Members admin work, just not
// linked from anywhere.
const TOP_LEVEL = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/board", label: "Task Board", icon: SquareKanban },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/fireflies", label: "Fireflies", icon: Captions },
];

// Settings is now a parent group, not a navigable route itself. Clicking
// it toggles its child list; Organizations + Profile each navigate.
// Children render without icons — nested under a parent that has its own.
const SETTINGS_CHILDREN = [
  { to: "/organizations", label: "Organizations", requireAdmin: true },
  { to: "/profile", label: "Profile" },
];

const navItemSx = (theme) => ({
  mx: 2,
  borderRadius: 1.5,
  color: theme.sidebar.color,
  "&.active": {
    bgcolor: theme.sidebar.active,
    color: "#FFFFFF",
  },
  "&:hover": {
    bgcolor: "rgba(255,255,255,0.04)",
    color: "#FFFFFF",
  },
});

export default function Sidebar({ isAdmin }) {
  const location = useLocation();
  const visibleSettingsChildren = SETTINGS_CHILDREN.filter(
    (c) => !c.requireAdmin || isAdmin,
  );
  const isOnSettingsChild = visibleSettingsChildren.some(
    (c) => c.to === location.pathname,
  );
  // Always default to collapsed; user clicks to expand.
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <Box
      component="nav"
      aria-label="Primary navigation"
      sx={(theme) => ({
        width: theme.sidebar.width,
        flexShrink: 0,
        minHeight: "100vh",
        bgcolor: theme.sidebar.background,
        color: theme.sidebar.color,
        display: "flex",
        flexDirection: "column",
      })}
    >
      <Stack
        sx={(theme) => ({
          height: theme.appBar.height,
          px: 5,
          justifyContent: "center",
          bgcolor: theme.sidebar.header.background,
          color: theme.sidebar.header.color,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        })}
      >
        <Typography
          variant="h6"
          sx={(theme) => ({
            color: theme.sidebar.header.brand,
            fontWeight: 600,
            letterSpacing: 0.2,
          })}
        >
          Vistamar Management
        </Typography>
      </Stack>

      <List sx={{ py: 2 }}>
        {TOP_LEVEL.map(({ to, label, icon: Icon }) => (
          <ListItemButton
            key={to}
            component={NavLink}
            to={to}
            sx={navItemSx}
          >
            <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
              <Icon size={18} strokeWidth={2} />
            </ListItemIcon>
            <ListItemText
              primary={label}
              primaryTypographyProps={{ fontSize: 13.5, fontWeight: 500 }}
            />
          </ListItemButton>
        ))}

        {/* Settings group — clickable parent that toggles expansion only,
            does NOT navigate. Children render indented inside <Collapse>. */}
        <ListItemButton
          onClick={() => setSettingsOpen((o) => !o)}
          sx={(theme) => ({
            ...navItemSx(theme),
            // Highlight the parent when a child is the current route.
            ...(isOnSettingsChild && {
              color: "#FFFFFF",
            }),
          })}
        >
          <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
            <Settings size={18} strokeWidth={2} />
          </ListItemIcon>
          <ListItemText
            primary="Settings"
            primaryTypographyProps={{ fontSize: 13.5, fontWeight: 500 }}
          />
        </ListItemButton>

        <Collapse in={settingsOpen} timeout="auto" unmountOnExit>
          <List disablePadding>
            {visibleSettingsChildren.map(({ to, label }) => (
              <ListItemButton
                key={to}
                component={NavLink}
                to={to}
                sx={(theme) => ({
                  ...navItemSx(theme),
                  pl: 9,
                })}
              >
                <ListItemText
                  primary={label}
                  primaryTypographyProps={{ fontSize: 13, fontWeight: 500 }}
                />
              </ListItemButton>
            ))}
          </List>
        </Collapse>
      </List>
    </Box>
  );
}
