import { useState } from "react";
import { Alert, Box, Button, Card, CardContent, Snackbar, Stack, Typography } from "@mui/material";
import { Sparkles } from "lucide-react";

import KanbanCard from "../components/KanbanCard.jsx";
import { BOARD_COLUMNS, STATUS } from "../constants/itemStatuses.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useCollection } from "../hooks/useCollection.js";
import { useItems } from "../hooks/useItems.js";
import { seedSampleItems } from "../seed/sampleItems.js";

const VISTAMAR_ORG_ID = "vistamar";

export default function KanbanBoard() {
  const { user, isAdmin } = useAuth();
  const { data: allItems, loading: itemsLoading, error: itemsError } = useItems();
  const { data: orgs } = useCollection("organizations");
  const { data: users } = useCollection("users");

  // V1 client-side filter: top-level only, not archived. Server returns the
  // whole items collection ordered by rank; we slice it here.
  const items = allItems.filter(
    (item) => item.parentId == null && item.statusId !== STATUS.ARCHIVE,
  );

  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState(null);
  const [seedError, setSeedError] = useState(null);

  const orgLookup = Object.fromEntries(orgs.map((o) => [o.id, o]));
  const userLookup = Object.fromEntries(users.map((u) => [u.id, u]));

  const handleSeed = async () => {
    setSeeding(true);
    setSeedError(null);
    try {
      const count = await seedSampleItems({
        organizationId: VISTAMAR_ORG_ID,
        createdBy: user.uid,
      });
      setSeedResult(count === 0 ? "Sample items already exist — skipped." : `Seeded ${count} sample items.`);
    } catch (err) {
      setSeedError(err.message || String(err));
    } finally {
      setSeeding(false);
    }
  };

  const itemsByStatus = BOARD_COLUMNS.reduce((acc, col) => {
    acc[col.id] = items.filter((item) => item.statusId === col.id);
    return acc;
  }, {});

  const totalItems = items.length;
  const showSeedAction = isAdmin && totalItems === 0 && !itemsLoading;

  return (
    <Stack spacing={4}>
      {itemsError ? (
        <Alert severity="error">Failed to load items: {itemsError.message}</Alert>
      ) : null}

      {showSeedAction ? (
        <Card sx={{ bgcolor: "rgba(71, 130, 218, 0.06)" }}>
          <CardContent>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={3} alignItems={{ sm: "center" }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="h6" gutterBottom>No items yet</Typography>
                <Typography variant="body2" color="text.secondary">
                  Seed ~10 sample items against the Vistamar org so you can see the board, drag-and-drop wiring, and filters land in upcoming slices. Idempotent — runs once.
                </Typography>
              </Box>
              <Button
                variant="contained"
                startIcon={<Sparkles size={16} />}
                onClick={handleSeed}
                disabled={seeding}
              >
                {seeding ? "Seeding…" : "Seed sample items"}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(4, minmax(0, 1fr))" },
          gap: 3,
          alignItems: "start",
        }}
      >
        {BOARD_COLUMNS.map((column) => {
          const columnItems = itemsByStatus[column.id] || [];
          return (
            <Stack
              key={column.id}
              spacing={2}
              sx={(theme) => ({
                bgcolor: "background.paper",
                borderRadius: 1.5,
                p: 3,
                minHeight: 200,
                border: `1px solid ${theme.palette.divider}`,
              })}
            >
              <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: column.color }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{column.label}</Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">{columnItems.length}</Typography>
              </Stack>

              {itemsLoading && columnItems.length === 0 ? (
                <Typography variant="caption" color="text.secondary">Loading…</Typography>
              ) : null}

              {!itemsLoading && columnItems.length === 0 ? (
                <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                  No items
                </Typography>
              ) : null}

              <Stack spacing={2}>
                {columnItems.map((item) => (
                  <KanbanCard
                    key={item.id}
                    item={item}
                    orgLookup={orgLookup}
                    userLookup={userLookup}
                  />
                ))}
              </Stack>
            </Stack>
          );
        })}
      </Box>

      <Snackbar
        open={Boolean(seedResult)}
        autoHideDuration={4000}
        onClose={() => setSeedResult(null)}
        message={seedResult}
      />
      <Snackbar
        open={Boolean(seedError)}
        autoHideDuration={6000}
        onClose={() => setSeedError(null)}
      >
        <Alert severity="error" onClose={() => setSeedError(null)}>
          Seed failed: {seedError}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
