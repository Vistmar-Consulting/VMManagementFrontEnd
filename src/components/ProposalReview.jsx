// Proposed-agenda review for Sync Meeting. Changes = read-only redline against
// the agenda as it was when the dialog opened; Edit = the proposal itself,
// editable (topic bodies, Open Floor, new-topic titles — retained titles stay
// locked, as Apply keeps them). Edits go up through onTopicChange /
// onOpenFloorChange into the dialog's proposal, so Refine and Apply see them.
// readOnly locks every field while Refine/Apply is in flight: edits typed then
// would be overwritten by the refined proposal (or flush onto it stale).
import { useMemo, useState } from "react";
import { Box, Tab, Tabs, TextField, Typography } from "@mui/material";
import RichBodyEditor from "./editor/RichBodyEditor.jsx";
import { buildAgendaRedline } from "../lib/agendaDiff.js";
import { sanitizeRedlineHtml } from "../lib/agendaHtml.js";
import { t } from "../theme/tokens.js";

const BOX_SX = { border: "1px solid", borderColor: "divider", borderRadius: 1, p: 2, overflow: "auto" };

const REDLINE_SX = {
  fontSize: 13,
  lineHeight: 1.4,
  "& ul, & ol": { pl: 3, m: 0 },
  "& li": { mb: 0.3 },
  "& li p": { m: 0 },
  "& table": { borderCollapse: "collapse", width: "100%", my: 0.75 },
  "& th, & td": { border: "1px solid", borderColor: "divider", p: "4px 6px", verticalAlign: "top" },
  "& td p, & th p": { m: 0 },
  "& del": { color: t.red, textDecoration: "line-through" },
  "& ins": { color: t.green, textDecoration: "none", backgroundColor: `${t.green}1f` },
};

const CAPTION = {
  new: "New topic",
  dropped: "AI suggests removing — kept unless you check Delete above",
};

function RedlineHeading({ row }) {
  const name = row.name || "(untitled)";
  return (
    <Typography variant="subtitle2" sx={{ fontSize: 15, fontWeight: 700 }}>
      {row.kind === "new" ? <ins>{name}</ins> : row.kind === "dropped" ? <del>{name}</del> : name}
    </Typography>
  );
}

export default function ProposalReview({
  prevTopics,
  prevOpenFloorHtml,
  topics,
  proposal,
  statuses,
  rev,
  onTopicChange,
  onOpenFloorChange,
  readOnly = false,
}) {
  const [tab, setTab] = useState("changes");
  const redline = useMemo(
    () => (tab === "changes" ? buildAgendaRedline({ prevTopics, prevOpenFloorHtml, topics, proposal }) : []),
    [tab, prevTopics, prevOpenFloorHtml, topics, proposal],
  );
  const liveName = new Map((topics || []).map((tp) => [tp.id, tp.name || ""]));

  return (
    <Box>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 36, mb: 1 }}>
        <Tab value="changes" label="Changes" id="proposal-tab-changes" aria-controls="proposal-panel-changes" sx={{ minHeight: 36 }} />
        <Tab value="edit" label="Edit" id="proposal-tab-edit" aria-controls="proposal-panel-edit" sx={{ minHeight: 36 }} />
      </Tabs>

      {tab === "changes" ? (
        <Box
          role="tabpanel"
          id="proposal-panel-changes"
          aria-labelledby="proposal-tab-changes"
          sx={{ ...BOX_SX, ...REDLINE_SX, maxHeight: 360 }}
        >
          {redline
            .filter((row) => row.kind !== "openFloor" || row.html)
            .map((row, i) => (
              <Box key={i} component="section" sx={{ mb: 1.5 }}>
                <RedlineHeading row={row} />
                {CAPTION[row.kind] && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                    {CAPTION[row.kind]}
                  </Typography>
                )}
                <Box dangerouslySetInnerHTML={{ __html: sanitizeRedlineHtml(row.html) || "<em>Empty</em>" }} />
              </Box>
            ))}
        </Box>
      ) : (
        <Box role="tabpanel" id="proposal-panel-edit" aria-labelledby="proposal-tab-edit" sx={{ ...BOX_SX, maxHeight: 520 }}>
          {(proposal.topics || []).map((tp, i) => {
            const blank = !String(tp.name || "").trim();
            const retained = statuses[i] === "retained";
            const title = retained ? liveName.get(tp.ref) || "(untitled)" : blank ? "New topic" : String(tp.name).trim();
            return (
              <Box key={`${rev}-${i}`} sx={{ mb: 2 }}>
                {retained ? (
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    {title}
                  </Typography>
                ) : (
                  <TextField
                    size="small"
                    fullWidth
                    label="New topic title"
                    value={tp.name || ""}
                    onChange={(e) => onTopicChange(i, { name: e.target.value })}
                    disabled={readOnly}
                    error={blank}
                    helperText={blank ? "A new topic needs a title" : " "}
                    sx={{ mb: 0.5 }}
                  />
                )}
                <RichBodyEditor
                  valueHtml={tp.bodyHtml || ""}
                  onChangeHtml={(html) => onTopicChange(i, { bodyHtml: html })}
                  debounceMs={0}
                  editable={!readOnly}
                  ariaLabel={`${title} body`}
                />
              </Box>
            );
          })}
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Open Floor</Typography>
          <RichBodyEditor
            key={`${rev}-openFloor`}
            valueHtml={proposal.openFloorHtml || ""}
            onChangeHtml={onOpenFloorChange}
            debounceMs={0}
            editable={!readOnly}
            ariaLabel="Open Floor body"
          />
        </Box>
      )}
    </Box>
  );
}
