import { NavLink } from "react-router-dom";
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Stack, Typography } from "@mui/material";
import {
  Building2,
  LayoutDashboard,
  Settings,
  SquareKanban,
  UserCircle,
  Users,
} from "lucide-react";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/board", label: "Task Board", icon: SquareKanban },
  { to: "/members", label: "Members", icon: Users, requireAdmin: true },
  { to: "/organizations", label: "Organizations", icon: Building2, requireAdmin: true },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/profile", label: "Profile", icon: UserCircle },
];

export default function Sidebar({ isAdmin }) {
  const visible = NAV_ITEMS.filter((item) => !item.requireAdmin || isAdmin);

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
        {visible.map(({ to, label, icon: Icon }) => (
          <ListItemButton
            key={to}
            component={NavLink}
            to={to}
            sx={(theme) => ({
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
            })}
          >
            <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
              <Icon size={18} strokeWidth={2} />
            </ListItemIcon>
            <ListItemText primary={label} primaryTypographyProps={{ fontSize: 13.5, fontWeight: 500 }} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}
