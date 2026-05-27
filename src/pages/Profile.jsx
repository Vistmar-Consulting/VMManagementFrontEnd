import { Card, CardContent, Chip, Stack, Typography } from "@mui/material";

import MemberAvatar from "../components/MemberAvatar.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function Profile() {
  const { user, profile, isAdmin } = useAuth();

  if (!profile) return null;

  return (
    <Card sx={{ maxWidth: 560 }}>
      <CardContent>
        <Stack direction="row" spacing={4} alignItems="center" sx={{ mb: 4 }}>
          <MemberAvatar user={profile} size={56} border={false} tooltip={false} />
          <Stack sx={{ flex: 1 }}>
            <Typography variant="h5">{profile.displayName}</Typography>
            <Typography variant="body2" color="text.secondary">{profile.email}</Typography>
          </Stack>
          <Chip
            label={isAdmin ? "admin" : "member"}
            color={isAdmin ? "primary" : "default"}
            variant="outlined"
            size="small"
          />
        </Stack>

        <Stack spacing={2}>
          <ProfileRow label="First name" value={profile.firstName} />
          <ProfileRow label="Last name" value={profile.lastName} />
          <ProfileRow label="Avatar color" value={profile.avatarColor} mono />
          <ProfileRow label="Active" value={profile.active ? "yes" : "no"} />
          <ProfileRow label="UID" value={user.uid} mono />
          <ProfileRow
            label="Joined"
            value={profile.joinedAt?.toDate?.()?.toLocaleString?.() || String(profile.joinedAt || "—")}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}

function ProfileRow({ label, value, mono = false }) {
  return (
    <Stack direction="row" spacing={4} alignItems="baseline">
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 120 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined }}
      >
        {value}
      </Typography>
    </Stack>
  );
}
