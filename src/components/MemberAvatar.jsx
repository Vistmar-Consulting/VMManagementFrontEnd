// Single + multi-assignee avatar used everywhere a user is shown:
// the Assigned column on the board, the top-bar account button, the
// Profile page, and the assignee dropdown.
//
// Rendering rules (Andy 2026-05-27):
//   - First-name initial + last-name initial (e.g. "AD" for Andy Deemer).
//     Falls back to single-letter display name or email local-part.
//   - Background = user.avatarColor (hash-from-uid pastel by default).
//   - Text = near-black rgba(0,0,0,0.78) so the pastel reads as warm.
//
// Modes:
//   <MemberAvatar user={u} size={32} />
//   <MemberAvatar users={[u1, u2, u3]} size={28} max={3} />   // overlapping + "+N" overflow

import { Avatar, Box, Tooltip } from "@mui/material";

const DEFAULT_BG = "#e0e0e0";
const TEXT_COLOR = "rgba(0, 0, 0, 0.78)";

function initialsFromUser(user) {
  if (!user) return "?";
  const first = (user.firstName || "").trim();
  const last = (user.lastName || "").trim();
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
  const display = (user.displayName || "").trim();
  if (display) {
    const parts = display.split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    if (parts[0]?.[0]) return parts[0][0].toUpperCase();
  }
  const local = (user.email || "?").split("@")[0];
  return (local[0] || "?").toUpperCase();
}

function SingleAvatar({ user, size = 28, border = true, tooltip = true }) {
  const avatar = (
    <Avatar
      sx={{
        width: size,
        height: size,
        bgcolor: user?.avatarColor || DEFAULT_BG,
        color: TEXT_COLOR,
        fontSize: Math.round(size * 0.4),
        fontWeight: 700,
        lineHeight: 1,
        border: border ? "2px solid #fff" : "none",
        boxSizing: "content-box",
      }}
    >
      {initialsFromUser(user)}
    </Avatar>
  );

  if (!tooltip || !user) return avatar;
  return (
    <Tooltip title={user.displayName || user.email || ""} enterDelay={400}>
      {avatar}
    </Tooltip>
  );
}

function OverflowChip({ count, size, names }) {
  return (
    <Tooltip title={names || `${count} more`} enterDelay={300}>
      <Avatar
        sx={{
          width: size,
          height: size,
          bgcolor: "#e9eaec",
          color: "#5a5a5a",
          fontSize: Math.round(size * 0.36),
          fontWeight: 700,
          border: "2px solid #fff",
          boxSizing: "content-box",
        }}
      >
        {`+${count}`}
      </Avatar>
    </Tooltip>
  );
}

export default function MemberAvatar({ user, users, size = 28, max = 3, border = true, tooltip = true }) {
  // Single mode.
  if (user && !users) {
    return <SingleAvatar user={user} size={size} border={border} tooltip={tooltip} />;
  }

  // Multi mode.
  if (!users || users.length === 0) return null;
  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;
  const overlap = Math.round(size * 0.35);
  const overflowNames = users.slice(max).map((u) => u?.displayName || u?.email || "").filter(Boolean).join(", ");

  return (
    <Box sx={{ display: "inline-flex", alignItems: "center" }}>
      {visible.map((u, idx) => (
        <Box
          key={u?.id || idx}
          sx={{ marginLeft: idx === 0 ? 0 : `-${overlap}px`, zIndex: visible.length - idx }}
        >
          <SingleAvatar user={u} size={size} border={border} tooltip={tooltip} />
        </Box>
      ))}
      {overflow > 0 && (
        <Box sx={{ marginLeft: `-${overlap}px`, zIndex: 0 }}>
          <OverflowChip count={overflow} size={size} names={overflowNames} />
        </Box>
      )}
    </Box>
  );
}
