// Ported from _PM_Archive_From_Console_2026-05-12/src/pages/pages/PmAvatar.jsx
// Rename PmAvatar → MemberAvatar, switch to Firestore field names (displayName +
// avatarColor on users/{uid}), add multi-assignee overlapping render with +N
// overflow.
//
// Single: <MemberAvatar user={user} />
// Multi:  <MemberAvatar users={[u1, u2, u3]} max={3} />

import { Box, Tooltip } from "@mui/material";

const DEFAULT_BG = "#e0e0e0";

function initialsFromName(displayName, email) {
  const trimmed = (displayName || "").trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return parts[0][0].toUpperCase();
  }
  const local = (email || "?").split("@")[0];
  return (local[0] || "?").toUpperCase();
}

function SingleAvatar({ user, size = 28, border = true, tooltip = true }) {
  const initials = initialsFromName(user?.displayName, user?.email);
  const bg = user?.avatarColor || DEFAULT_BG;
  const borderW = border ? 2 : 0;
  const outer = size + borderW * 2;

  const svg = (
    <svg
      width={outer}
      height={outer}
      viewBox={`0 0 ${outer} ${outer}`}
      style={{ flexShrink: 0, display: "block" }}
    >
      <circle cx={outer / 2} cy={outer / 2} r={size / 2} fill={bg} />
      {border && (
        <circle
          cx={outer / 2}
          cy={outer / 2}
          r={size / 2 + borderW / 2}
          fill="none"
          stroke="#fff"
          strokeWidth={borderW}
        />
      )}
      <text
        x={outer / 2}
        y={outer / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={size * 0.38}
        fontWeight={700}
        fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
      >
        {initials}
      </text>
    </svg>
  );

  if (!tooltip || !user) return svg;
  return <Tooltip title={user.displayName || user.email || ""} enterDelay={400}>{svg}</Tooltip>;
}

function OverflowChip({ count, size }) {
  const borderW = 2;
  const outer = size + borderW * 2;
  return (
    <Tooltip title={`${count} more`} enterDelay={300}>
      <svg width={outer} height={outer} viewBox={`0 0 ${outer} ${outer}`} style={{ flexShrink: 0 }}>
        <circle cx={outer / 2} cy={outer / 2} r={size / 2} fill="#f0f0f0" />
        <circle cx={outer / 2} cy={outer / 2} r={size / 2 + borderW / 2} fill="none" stroke="#fff" strokeWidth={borderW} />
        <text
          x={outer / 2}
          y={outer / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#666"
          fontSize={size * 0.36}
          fontWeight={700}
          fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
        >
          {`+${count}`}
        </text>
      </svg>
    </Tooltip>
  );
}

export default function MemberAvatar({ user, users, size = 28, max = 3, border = true, tooltip = true }) {
  // Single mode
  if (user && !users) {
    return <SingleAvatar user={user} size={size} border={border} tooltip={tooltip} />;
  }

  // Multi mode
  if (!users || users.length === 0) return null;
  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;
  const overlap = Math.round(size * 0.35);

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
          <OverflowChip count={overflow} size={size} />
        </Box>
      )}
    </Box>
  );
}
