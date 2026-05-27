import { useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Box,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from "@mui/material";
import { LogOut } from "lucide-react";

import MemberAvatar from "./MemberAvatar.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

const ROUTE_TITLES = {
  "/dashboard": "Dashboard",
  "/board": "Task Board",
  "/members": "Members",
  "/organizations": "Organizations",
  "/settings": "Settings",
  "/profile": "Profile",
};

export default function AppTopBar() {
  const { user, profile, isAdmin, signOut } = useAuth();
  const location = useLocation();
  const [menuAnchor, setMenuAnchor] = useState(null);

  const title = ROUTE_TITLES[location.pathname] || "Vistamar Management";

  return (
    <Stack
      component="header"
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={(theme) => ({
        height: theme.appBar.height,
        px: 6,
        bgcolor: theme.appBar.background,
        color: theme.appBar.color,
        borderBottom: `1px solid ${theme.palette.divider}`,
      })}
    >
      <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>

      <Stack direction="row" spacing={2} alignItems="center">
        {isAdmin ? (
          <Chip size="small" label="admin" color="primary" variant="outlined" />
        ) : null}
        <IconButton
          onClick={(event) => setMenuAnchor(event.currentTarget)}
          aria-label="Account menu"
          sx={{ p: 0 }}
        >
          <MemberAvatar user={profile || { email: user?.email }} size={32} border={false} tooltip={false} />
        </IconButton>
      </Stack>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Box sx={{ px: 4, py: 2, minWidth: 220 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {profile?.displayName || user?.displayName || user?.email}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {profile?.email || user?.email}
          </Typography>
        </Box>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            signOut();
          }}
        >
          <LogOut size={16} style={{ marginRight: 12 }} />
          Sign out
        </MenuItem>
      </Menu>
    </Stack>
  );
}
