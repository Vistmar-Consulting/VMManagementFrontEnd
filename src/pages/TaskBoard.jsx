import { Alert, Box, Card, CardContent, Stack, Typography } from "@mui/material";

const COLUMNS = [
  { id: 1, label: "Assigned" },
  { id: 2, label: "In Progress" },
  { id: 3, label: "Review" },
  { id: 6, label: "Done" },
];

export default function TaskBoard() {
  return (
    <Stack spacing={4}>
      <Alert severity="info" variant="outlined">
        Placeholder columns — items collection wiring + drag-and-drop lands in the next slice.
      </Alert>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(4, minmax(0, 1fr))" },
          gap: 4,
        }}
      >
        {COLUMNS.map((column) => (
          <Card key={column.id} sx={{ minHeight: 280, bgcolor: "background.paper" }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>{column.label}</Typography>
              <Typography variant="caption" color="text.secondary">
                statusId {column.id}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>
    </Stack>
  );
}
