// Read-only render of stored agenda body HTML. Always sanitized.
import { Box } from "@mui/material";
import { sanitizeHtml } from "../../lib/agendaHtml.js";
import { t } from "../../theme/tokens.js";

export default function RichBodyView({ html, sx }) {
  const clean = sanitizeHtml(html);
  if (!clean) return null;
  return (
    <Box
      sx={{
        fontSize: 13,
        color: t.ink2,
        lineHeight: 1.15,
        "& ul, & ol": { pl: 3, m: 0 },
        "& li": { mb: 0.3 },
        "& li p": { m: 0 },
        "& a": { color: t.copper },
        "& u": { textDecoration: "underline" },
        "& table": { borderCollapse: "collapse", tableLayout: "fixed", width: "100%", my: 0.75 },
        "& th, & td": { border: `1px solid ${t.cream3}`, p: "4px 6px", verticalAlign: "top" },
        "& th": { backgroundColor: t.cream2, fontWeight: 600, textAlign: "left" },
        "& th p, & td p": { m: 0 },
        ...sx,
      }}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
