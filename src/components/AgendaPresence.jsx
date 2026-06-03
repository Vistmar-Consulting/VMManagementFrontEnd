import Stack from "@mui/material/Stack";
import Avatar from "@mui/material/Avatar";
import Tooltip from "@mui/material/Tooltip";
import { useOthers, useSelf } from "../lib/liveblocks.js";

const initials = (name) => String(name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default function AgendaPresence() {
  const others = useOthers();
  const self = useSelf();
  const people = [
    ...(self ? [{ id: "self", info: self.info, me: true }] : []),
    ...others.map((o) => ({ id: o.connectionId, info: o.info, me: false })),
  ].filter((p) => p.info);
  if (people.length === 0) return null;
  return (
    <Stack direction="row" spacing={-0.75} alignItems="center">
      {people.map((p) => (
        <Tooltip key={p.id} title={p.info.name + (p.me ? " (you)" : "")}>
          <Avatar sx={{ width: 26, height: 26, fontSize: 11, bgcolor: p.info.color, border: "2px solid #fff" }}>
            {initials(p.info.name)}
          </Avatar>
        </Tooltip>
      ))}
    </Stack>
  );
}
