import { Navigate, useLocation } from "react-router-dom";
import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";

import { useAuth } from "../contexts/AuthContext.jsx";

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

export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { user, profile, loading, error, isAdmin, signOut, retryBootstrap } = useAuth();
  const location = useLocation();

  if (loading) return <CenteredSpinner />;

  if (!user) {
    return <Navigate to="/signin" state={{ from: location.pathname }} replace />;
  }

  if (error) {
    return (
      <Box sx={{ p: 4, maxWidth: 720, mx: "auto" }}>
        <Stack spacing={2}>
          <Alert severity="error">
            Failed to load your profile: {error.message}
          </Alert>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={retryBootstrap}>
              Retry
            </Button>
            <Button variant="outlined" onClick={signOut}>
              Sign out
            </Button>
          </Stack>
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
            Your access has been disabled. Contact a Vistamar admin to reactivate.
          </Alert>
          <Button variant="outlined" onClick={signOut} sx={{ alignSelf: "flex-start" }}>
            Sign out
          </Button>
        </Stack>
      </Box>
    );
  }

  if (requireAdmin && !isAdmin) {
    return (
      <Box sx={{ p: 4, maxWidth: 720, mx: "auto" }}>
        <Alert severity="warning">
          This page is admin-only. Ask another admin to grant you access.
        </Alert>
      </Box>
    );
  }

  return children;
}
