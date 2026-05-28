// Sign-in page using Google Identity Services.
//
// Flow:
//   1. GIS button (Google-rendered iframe) loads in the page.
//   2. User clicks → Google's account chooser appears (in-page, no popup).
//   3. After they pick a @vistamarconsulting.com account, Google returns
//      a JWT ID token via the callback.
//   4. We exchange the ID token for a Firebase Auth credential via
//      signInWithCredential — Firebase recognizes the user and onAuth-
//      StateChanged fires.
//   5. AuthContext's domain guard checks email is @vistamarconsulting.com;
//      if not, signs the user back out and surfaces an error.
//
// This is Google's documented modern pattern (replaces signInWithPopup /
// signInWithRedirect for new apps). Works in all major browsers; no popup
// blockers, no COOP issues, no redirect-state IndexedDB flakiness.

import { useEffect, useRef, useState } from "react";
import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";

import { auth } from "../firebase.js";

// Public OAuth client ID for the management-db9eb Firebase project. Same
// client Firebase Auth's Google provider uses under the hood — visible in
// any OAuth redirect URL. Not a secret.
const GOOGLE_CLIENT_ID = "206947368406-o23e9ehu6flnv1cng6mvfnl9vvmp9icp.apps.googleusercontent.com";

export default function SignIn() {
  const buttonRef = useRef(null);
  const [error, setError] = useState(null);
  const [gsiReady, setGsiReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const initGoogle = () => {
      if (cancelled) return false;
      if (!window.google?.accounts?.id || !buttonRef.current) return false;

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          if (cancelled) return;
          setError(null);
          try {
            const credential = GoogleAuthProvider.credential(response.credential);
            await signInWithCredential(auth, credential);
            // AuthContext's onAuthStateChanged + domain guard take over.
          } catch (err) {
            setError(err?.message || "Sign-in failed.");
          }
        },
        ux_mode: "popup",
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      window.google.accounts.id.renderButton(buttonRef.current, {
        type: "standard",
        theme: "filled_blue",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        logo_alignment: "left",
        width: 280,
      });

      setGsiReady(true);
      return true;
    };

    // GIS script loads async via <script src="…/gsi/client" async defer>.
    // Poll until window.google.accounts.id is defined, then init.
    if (!initGoogle()) {
      const interval = setInterval(() => {
        if (initGoogle()) clearInterval(interval);
      }, 100);
      // Safety: stop polling after 10s.
      setTimeout(() => clearInterval(interval), 10000);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 3 }}>
      <Stack spacing={3} alignItems="center" sx={{ maxWidth: 380, textAlign: "center" }}>
        <Typography variant="h4" component="h1">Vistamar Management</Typography>
        <Typography variant="body2" color="text.secondary">
          Internal access only. Sign in with your <b>@vistamarconsulting.com</b> Google account.
        </Typography>

        {/* The Google-rendered button mounts here. */}
        <Box ref={buttonRef} sx={{ minHeight: 44 }} />

        {!gsiReady && (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">Loading Google sign-in…</Typography>
          </Stack>
        )}

        {error && <Alert severity="error" sx={{ width: "100%" }}>{error}</Alert>}
      </Stack>
    </Box>
  );
}
