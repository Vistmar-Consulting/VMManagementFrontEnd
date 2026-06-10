import { useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Box,
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useLocalStorage } from "@uidotdev/usehooks";
import {
  CalendarDays,
  Captions,
  ChevronLeft,
  ChevronRight,
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
  { to: "/settings/ai-integration", label: "AI Integration", requireAdmin: true },
  { to: "/settings/client-sops", label: "Client SOPs", requireAdmin: true },
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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const location = useLocation();
  const visibleSettingsChildren = SETTINGS_CHILDREN.filter(
    (c) => !c.requireAdmin || isAdmin,
  );
  const isOnSettingsChild = visibleSettingsChildren.some(
    (c) => c.to === location.pathname,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Seed collapsed state once at mount. useRef + IIFE reads localStorage
  // synchronously so the default is the correct isMobile value — not a
  // stale snapshot from useLocalStorage's internal useEffect.
  const defaultCollapsed = useRef(
    (() => {
      const stored = localStorage.getItem("vm-sidebar-collapsed");
      return stored === null ? isMobile : JSON.parse(stored);
    })()
  );
  const [collapsed, setCollapsed] = useLocalStorage(
    "vm-sidebar-collapsed",
    defaultCollapsed.current
  );

  return (
    <Box
      component="nav"
      aria-label="Primary navigation"
      sx={(theme) => ({
        position: "sticky",
        top: 0,
        width: collapsed ? theme.sidebar.collapsedWidth : theme.sidebar.width,
        flexShrink: 0,
        minHeight: "100vh",
        bgcolor: theme.sidebar.background,
        color: theme.sidebar.color,
        display: "flex",
        flexDirection: "column",
        // overflow: hidden clips label text during the collapse transition.
        // NOTE: a box-shadow on this element would also be clipped; use
        // filter: drop-shadow() instead if a shadow is ever added.
        overflow: "hidden",
        transition: "width 0.2s ease",
      })}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent={collapsed ? "center" : "space-between"}
        sx={(theme) => ({
          height: theme.appBar.height,
          px: collapsed ? 0 : 5,
          bgcolor: theme.sidebar.header.background,
          color: theme.sidebar.header.color,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
          transition: "padding 0.2s ease",
        })}
      >
        {!collapsed && (
          <Typography
            variant="h6"
            sx={(theme) => ({
              color: theme.sidebar.header.brand,
              fontWeight: 600,
              letterSpacing: 0.2,
              whiteSpace: "nowrap",
            })}
          >
            Vistamar Management
          </Typography>
        )}
        <IconButton
          onClick={() => setCollapsed((c) => !c)}
          size="small"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          sx={{ color: "rgba(255,255,255,0.6)", "&:hover": { color: "#fff" } }}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </IconButton>
      </Stack>

      <List sx={{ py: 2 }}>
        {TOP_LEVEL.map(({ to, label, icon: Icon }) => (
          <ListItemButton
            key={to}
            component={NavLink}
            to={to}
            onClick={() => collapsed && setCollapsed(false)}
            aria-label={collapsed ? label : undefined}
            sx={navItemSx}
          >
            <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
              <Icon size={18} strokeWidth={2} />
            </ListItemIcon>
            {!collapsed && (
              <ListItemText
                primary={label}
                primaryTypographyProps={{ fontSize: 13.5, fontWeight: 500 }}
              />
            )}
          </ListItemButton>
        ))}

        {/* Settings group — clickable parent that toggles expansion only,
            does NOT navigate. Children render indented inside <Collapse>. */}
        <ListItemButton
          onClick={() => {
            if (collapsed) {
              // Expand sidebar AND open settings children so the user
              // reaches Settings on a single tap.
              setCollapsed(false);
              setSettingsOpen(true);
            } else {
              setSettingsOpen((o) => !o);
            }
          }}
          aria-label={collapsed ? "Settings" : undefined}
          sx={(theme) => ({
            ...navItemSx(theme),
            ...(isOnSettingsChild && {
              color: "#FFFFFF",
            }),
          })}
        >
          <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
            <Settings size={18} strokeWidth={2} />
          </ListItemIcon>
          {!collapsed && (
            <ListItemText
              primary="Settings"
              primaryTypographyProps={{ fontSize: 13.5, fontWeight: 500 }}
            />
          )}
        </ListItemButton>

        <Collapse in={settingsOpen && !collapsed} timeout="auto" unmountOnExit>
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
