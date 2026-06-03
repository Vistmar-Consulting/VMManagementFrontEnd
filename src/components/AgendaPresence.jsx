import Stack from "@mui/material/Stack";
import Avatar from "@mui/material/Avatar";
import Tooltip from "@mui/material/Tooltip";
import Box from "@mui/material/Box";
import { useOthers, useSelf, useStatus, useSyncStatus } from "../lib/liveblocks.js";

const initials = (name) => String(name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default function AgendaPresence() {
  const others = useOthers();
  const self = useSelf();
  const status = useStatus();          // DIAGNOSTIC: connection status
  const syncStatus = useSyncStatus();  // DIAGNOSTIC: storage/doc sync status
  const people = [
    ...(self ? [{ id: "self", info: self.info, me: true }] : []),
    ...others.map((o) => ({ id: o.connectionId, info: o.info, me: false })),
  ].filter((p) => p.info);
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      {/* DIAGNOSTIC badge — remove after debugging collab sync */}
      <Box
        data-collab-status={`conn=${status} sync=${syncStatus} others=${others.length}`}
        sx={{ fontSize: 10, color: "text.secondary", fontFamily: "monospace", px: 0.5 }}
      >
        {`conn=${status} sync=${syncStatus} others=${others.length}`}
      </Box>
      <Stack direction="row" spacing={-0.75} alignItems="center">
        {people.map((p) => (
          <Tooltip key={p.id} title={p.info.name + (p.me ? " (you)" : "")}>
            <Avatar sx={{ width: 26, height: 26, fontSize: 11, bgcolor: p.info.color, border: "2px solid #fff" }}>
              {initials(p.info.name)}
            </Avatar>
          </Tooltip>
        ))}
      </Stack>
    </Stack>
  );
}
