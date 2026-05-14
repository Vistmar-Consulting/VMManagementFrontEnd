import { Alert, Stack, Typography } from "@mui/material";

import { useCollection } from "../hooks/useCollection.js";

export default function Organizations() {
  const { data: orgs, loading, error } = useCollection("organizations");

  return (
    <Stack spacing={4} sx={{ maxWidth: 960 }}>
      <Typography variant="body2" color="text.secondary">
        Admin-only · CRUD for client organizations and Vistamar itself.
      </Typography>

      {loading ? (
        <Typography variant="body2" color="text.secondary">Loading…</Typography>
      ) : null}

      {error ? (
        <Alert severity="error">Failed to load organizations: {error.message}</Alert>
      ) : null}

      {!loading && !error ? (
        <Stack spacing={2}>
          {orgs.length === 0 ? (
            <Alert severity="info" variant="outlined">
              No organizations yet.
            </Alert>
          ) : (
            orgs.map((org) => (
              <Stack
                key={org.id}
                direction="row"
                alignItems="center"
                spacing={3}
                sx={{ p: 3, bgcolor: "background.paper", borderRadius: 1.5, boxShadow: 1 }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: org.accentColor || "#888",
                    display: "inline-block",
                  }}
                />
                <Stack sx={{ flex: 1 }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>{org.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    slug: {org.id} · type: {org.type}{org.archived ? " · archived" : ""}
                  </Typography>
                </Stack>
              </Stack>
            ))
          )}
        </Stack>
      ) : null}

      <Alert severity="info" variant="outlined">
        Create / edit / archive UI lands in a later V1 slice. For now, organizations are seeded manually in the Firebase console.
      </Alert>
    </Stack>
  );
}
