import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";

import { useAuth } from "../contexts/AuthContext.jsx";

export default function Dashboard() {
  const { profile } = useAuth();

  return (
    <Stack spacing={4} sx={{ maxWidth: 960 }}>
      <Card>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            Welcome, {profile?.firstName || profile?.displayName || "Vistamar"}.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Mini Project Board and recent activity land here. For now, this is a placeholder so you can navigate the app while the data layer ships.
          </Typography>
        </CardContent>
      </Card>
      <Alert severity="info" variant="outlined">
        V1 work-in-progress · Project Board page is the next slice.
      </Alert>
    </Stack>
  );
}
