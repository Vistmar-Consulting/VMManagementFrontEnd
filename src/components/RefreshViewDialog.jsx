// src/components/RefreshViewDialog.jsx
//
// "Refresh this view?" — confirms rerunning a saved Board Chat view's request
// against the board as it is now (one billed Board Chat run). The request is
// editable, so a refresh can also adjust what the view shows. While it runs
// the dialog can't be closed; a failure leaves the view unchanged and is
// shown here.
import { useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

// view: { label }; initialRequest: the request to rerun (saved, or recovered
// from the chat that made the view). onConfirm(request) resolves or throws.
export default function RefreshViewDialog({ view, initialRequest, loadingRequest = false, onConfirm, onClose }) {
  const [request, setRequest] = useState(initialRequest || "");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await onConfirm(request.trim());
    } catch (err) {
      setError(err.message);
      setRunning(false);
    }
  };

  return (
    <Dialog open onClose={running ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Refresh this view?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Board Chat reruns <strong>{view.label}</strong> against the board as it is now and updates the view. Your other
          views and filters are not changed. This is one Board Chat run (about $0.10–$0.20; it reads the whole board).
        </Typography>
        <TextField
          label="What this view shows"
          value={loadingRequest ? "" : request}
          placeholder={loadingRequest ? "Loading the original request…" : ""}
          onChange={(e) => setRequest(e.target.value)}
          disabled={running || loadingRequest}
          multiline
          minRows={2}
          maxRows={6}
          fullWidth
          helperText="Edit it to change what the view shows."
        />
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={running}>Cancel</Button>
        <Button variant="contained" onClick={run} disabled={running || loadingRequest || !request.trim()}>
          {running ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={14} color="inherit" />
              <span>Refreshing…</span>
            </Stack>
          ) : "Refresh"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
