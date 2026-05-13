import { Box, Button, CircularProgress, Stack, Typography } from "@mui/material";

import { AuthProvider, useAuth } from "./contexts/AuthContext.jsx";
import SignIn from "./pages/SignIn.jsx";

function Shell() {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!user) return <SignIn />;

  return (
    <Box sx={{ p: 4, maxWidth: 720, mx: "auto" }}>
      <Stack spacing={2}>
        <Typography variant="h4" component="h1">Vistamar Management</Typography>
        <Typography>
          Signed in as <b>{user.displayName ?? user.email}</b> ({user.email})
        </Typography>
        <Typography variant="caption" color="text.secondary">UID: {user.uid}</Typography>
        <Typography variant="body2" color="text.secondary">
          V1 scaffold — Project Board, Members, Organizations pages land in the next slices.
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
