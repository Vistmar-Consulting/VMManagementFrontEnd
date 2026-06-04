import { useState } from "react";
import { Alert, Box, Collapse, Stack, Typography } from "@mui/material";
import { ExpandMore } from "@mui/icons-material";

import { useCollection } from "../hooks/useCollection.js";
import { getContrastText } from "../theme/pillColors.js";
import OrgDeliverablesCard from "../components/OrgDeliverablesCard.jsx";
import OrgMembersCard from "../components/OrgMembersCard.jsx";

export default function Organizations() {
  const { data: orgs, loading, error } = useCollection("organizations");
  const [expandedIds, setExpandedIds] = useState(new Set());

  const sorted = [...(orgs || [])].sort(
    (a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)
  );

  const toggleOrg = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <Stack spacing={4} sx={{ maxWidth: 960 }}>
      <Typography variant="body2" color="text.secondary">
        Admin-only · CRUD for client organizations and Vistamar itself.
      </Typography>

      {loading && (
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      )}

      {error && (
        <Alert severity="error">
          Failed to load organizations: {error.message}
        </Alert>
      )}

      {!loading && !error && (
        <Stack spacing={2}>
          {sorted.length === 0 ? (
            <Alert severity="info" variant="outlined">
              No organizations yet.
            </Alert>
          ) : (
            sorted.map((org) => {
              const accent = org.accentColor || "#888";
              const bannerText = getContrastText(accent);
              const isExpanded = expandedIds.has(org.id);

              return (
                <Box
                  key={org.id}
                  sx={{
                    bgcolor: "background.paper",
                    borderRadius: 1.5,
                    boxShadow: 1,
                    overflow: "hidden",
                    opacity: org.archived ? 0.55 : 1,
                  }}
                >
                  {/* Accent banner / clickable header */}
                  <Box
                    onClick={() => toggleOrg(org.id)}
                    sx={{
                      bgcolor: accent,
                      px: 3,
                      py: 1.5,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      userSelect: "none",
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        sx={{
                          fontWeight: 700,
                          fontSize: 15,
                          color: bannerText,
                          lineHeight: 1.3,
                        }}
                      >
                        {org.name}
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography
                          sx={{
                            fontSize: 12,
                            color: bannerText,
                            opacity: 0.78,
                          }}
                        >
                          {org.type || "client"}
                        </Typography>
                        {org.archived && (
                          <Typography
                            sx={{
                              fontSize: 11,
                              fontWeight: 700,
                              letterSpacing: 0.8,
                              textTransform: "uppercase",
                              color: bannerText,
                              opacity: 0.78,
                            }}
                          >
                            · archived
                          </Typography>
                        )}
                      </Stack>
                    </Box>

                    <ExpandMore
                      sx={{
                        color: bannerText,
                        opacity: 0.85,
                        fontSize: 22,
                        transition: "transform 0.2s",
                        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                        flexShrink: 0,
                      }}
                    />
                  </Box>

                  {/* Expandable content */}
                  <Collapse in={isExpanded} unmountOnExit>
                    <Stack spacing={2} sx={{ p: 2 }}>
                      <OrgDeliverablesCard org={org} />
                      <OrgMembersCard orgSlug={org.id} allowVMDomain={org.type === "internal"} />
                    </Stack>
                  </Collapse>
                </Box>
              );
            })
          )}
        </Stack>
      )}
    </Stack>
  );
}
