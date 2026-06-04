import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { buildTocEntries } from "../lib/agendaToc.js";
import { t } from "../theme/tokens.js";

// Live, clickable Table of Contents for the agenda Overview. Pure projection of
// the reactive `topics` array — create/delete/reorder/rename (local or remote
// collaborator) all reflect automatically via Firestore onSnapshot. Hidden when
// there are no topics. Clicking an entry smooth-scrolls to its anchor, which
// carries scroll-margin-top to clear the sticky toolbar.
export default function AgendaTOC({ topics, isMaster = false, orgById = {} }) {
  const entries = buildTocEntries(topics, { isMaster, orgById, hasOpenFloor: true });
  if (entries.length === 0) return null;

  const goTo = (anchorId) => {
    document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Box
      component="nav"
      aria-label="Agenda contents"
      sx={{
        mb: 2.5,
        p: 1.5,
        border: `1px solid ${t.cream3}`,
        borderRadius: "8px",
        background: t.cream,
      }}
    >
      <Typography sx={sectionTitleSx}>Contents</Typography>
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
        {entries.map((e) => {
          if (e.type === "org") {
            return (
              <Box
                component="li"
                key={e.anchorId}
                onClick={() => goTo(e.anchorId)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    goTo(e.anchorId);
                  }
                }}
                role="link"
                tabIndex={0}
                aria-label={`Jump to ${e.label} section`}
                sx={{
                  mt: 0.75,
                  mb: 0.25,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: e.accentColor || t.ink3,
                  "&:hover": { textDecoration: "underline" },
                }}
              >
                {e.label}
              </Box>
            );
          }
          return (
            <Box
              component="li"
              key={e.anchorId}
              onClick={() => goTo(e.anchorId)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  goTo(e.anchorId);
                }
              }}
              role="link"
              tabIndex={0}
              aria-label={`Jump to ${e.label}`}
              sx={{
                py: "2px",
                cursor: "pointer",
                fontSize: 13,
                color: t.ink,
                "&:hover": { color: t.copper, textDecoration: "underline" },
              }}
            >
              {e.type === "topic" ? `${e.number}. ${e.label}` : e.label}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// Local copy of AgendaDetail's sectionTitleSx (module-private there). Kept in
// sync intentionally — small + stable.
const sectionTitleSx = {
  fontFamily: t.serif,
  fontSize: 15,
  fontWeight: 700,
  color: t.ink,
  borderBottom: `1.5px solid ${t.copper}`,
  py: "2px",
  mb: "6px",
};
