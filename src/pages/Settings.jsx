import { Alert, Stack, Typography } from "@mui/material";

export default function Settings() {
  return (
    <Stack spacing={4}>
      <Typography variant="body2" color="text.secondary">
        Display preferences, notification settings, default Organization filter.
      </Typography>
      <Alert severity="info" variant="outlined">
        Settings UI lands in a later V1 slice.
      </Alert>
    </Stack>
  );
}
