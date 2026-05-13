import { useState } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";

import { useAuth } from "../contexts/AuthContext.jsx";

export default function SignIn() {
  const { signIn } = useAuth();
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleClick = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signIn();
    } catch (err) {
      if (err?.code !== "auth/popup-closed-by-user") {
        setError(err?.message ?? "Sign-in failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 3 }}>
      <Stack spacing={3} alignItems="center" sx={{ maxWidth: 380, textAlign: "center" }}>
        <Typography variant="h4" component="h1">
          Vistamar Management
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Internal access only. Sign in with your <b>@vistamarconsulting.com</b> Google account.
        </Typography>
        <Button
          variant="contained"
          size="large"
          onClick={handleClick}
          disabled={submitting}
        >
          {submitting ? "Signing in…" : "Continue with Google"}
        </Button>
        {error && <Alert severity="error" sx={{ width: "100%" }}>{error}</Alert>}
      </Stack>
    </Box>
  );
}
