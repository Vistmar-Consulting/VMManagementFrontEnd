import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from "@mui/material";

import { AuthProvider, useAuth } from "./contexts/AuthContext.jsx";
import SignIn from "./pages/SignIn.jsx";

function CenteredSpinner({ caption }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <Stack alignItems="center" spacing={2}>
        <CircularProgress />
        {caption ? (
          <Typography variant="body2" color="text.secondary">{caption}</Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

function Shell() {
  const { user, profile, loading, error, isAdmin, signOut } = useAuth();

  if (loading) return <CenteredSpinner />;

  if (!user) return <SignIn />;

  if (error) {
    return (
      <Box sx={{ p: 4, maxWidth: 720, mx: "auto" }}>
        <Stack spacing={2}>
          <Alert severity="error">
            Failed to load your profile: {error.message}
          </Alert>
          <Button variant="outlined" onClick={signOut} sx={{ alignSelf: "flex-start" }}>
            Sign out
          </Button>
        </Stack>
      </Box>
    );
  }

  if (!profile) return <CenteredSpinner caption="Loading profile…" />;

  if (!profile.active) {
    return (
      <Box sx={{ p: 4, maxWidth: 720, mx: "auto" }}>
        <Stack spacing={2}>
          <Alert severity="warning">
            Your access has been disabled. Contact a Vistamar admin to reactivate your account.
          </Alert>
          <Button variant="outlined" onClick={signOut} sx={{ alignSelf: "flex-start" }}>
            Sign out
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 4, maxWidth: 720, mx: "auto" }}>
      <Stack spacing={2}>
        <Typography variant="h4" component="h1">Vistamar Management</Typography>
        <Typography>
          Signed in as <b>{profile.displayName || user.email}</b> ({profile.email})
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              bgcolor: profile.avatarColor,
              color: "rgba(0,0,0,0.78)",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {(profile.firstName || profile.email || "?").slice(0, 1).toUpperCase()}
          </Box>
          <Chip
            size="small"
            label={isAdmin ? `${profile.role} · admin` : profile.role}
            color={isAdmin ? "primary" : "default"}
            variant="outlined"
          />
        </Stack>
        <Typography variant="caption" color="text.secondary">UID: {user.uid}</Typography>
        <Typography variant="body2" color="text.secondary">
          V1 scaffold — Project Board, Members, and Organizations pages land in the next slices.
        </Typography>
        <Button variant="outlined" onClick={signOut} sx={{ alignSelf: "flex-start" }}>
          Sign out
        </Button>
      </Stack>
    </Box>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
