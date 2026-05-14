import { Alert, Stack, Typography } from "@mui/material";

export default function Members() {
  return (
    <Stack spacing={4}>
      <Typography variant="body2" color="text.secondary">
        Admin-only · grant/revoke access, edit roles, deactivate users.
      </Typography>
      <Alert severity="info" variant="outlined">
        Members admin page lands in a later V1 slice. For now, role changes happen in the Firebase console.
      </Alert>
    </Stack>
  );
}
