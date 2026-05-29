// MeetingDetailModal — per-meeting Fireflies deep view.
//
// Ported near-verbatim from Console archive src/pages/pages/Agenda.jsx:2861-3468.
// Pure presentational over the Fireflies API + localStorage cache; no Firestore.
// Swaps: archive's inline firefliesQuery/queries/helpers → ../lib/fireflies.js;
// inline `t` palette → ../theme/tokens.js; styled MiniPill/ShimmerBar →
// ./firefliesStyled.js. React.useMemo → useMemo. Logic unchanged.
//
// Caching: detail cached at localStorage `fireflies-detail-{id}` (fetched on
// open); sentences at `fireflies-sentences-{id}` (fetched only when transcript
// expanded). React Query staleTime:Infinity, retry:0.

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Collapse,
  Dialog,
  DialogContent,
  Divider,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import {
  ChevronLeft,
  ChevronRight,
  Close,
  ExpandMore,
  FiberManualRecord,
  Search,
} from "@mui/icons-material";
import { format } from "date-fns";

import {
  firefliesQuery,
  formatTimestamp,
  GQL_MEETING_DETAIL,
  GQL_TRANSCRIPT_SENTENCES,
  parseTimestampRange,
} from "../lib/fireflies.js";
import { t } from "../theme/tokens.js";
import { MiniPill, ShimmerBar } from "./firefliesStyled.js";

export default function MeetingDetailModal({ transcriptId, onClose }) {
  const [search, setSearch] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [highlightRange, setHighlightRange] = useState(null);

  const FF_DETAIL_KEY = `fireflies-detail-${transcriptId}`;
  const cachedDetail = useMemo(() => {
    try { const raw = localStorage.getItem(FF_DETAIL_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }, [FF_DETAIL_KEY]);

  const { data, isLoading } = useQuery({
    queryKey: ["fireflies-transcript", transcriptId],
    queryFn: async () => {
      const d = await firefliesQuery(GQL_MEETING_DETAIL, { transcriptId });
      try { localStorage.setItem(FF_DETAIL_KEY, JSON.stringify(d)); } catch {}
      return d;
    },
    initialData: cachedDetail || undefined,
    enabled: !cachedDetail,
    staleTime: Infinity,
    retry: 0,
  });

  // Transcript sentences — fetched on demand when expanded, cached to localStorage
  const FF_SENTENCES_KEY = `fireflies-sentences-${transcriptId}`;
  const cachedSentences = useMemo(() => {
    try { const raw = localStorage.getItem(FF_SENTENCES_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }, [FF_SENTENCES_KEY]);

  const { data: sentencesData } = useQuery({
    queryKey: ["fireflies-sentences", transcriptId],
    queryFn: async () => {
      const d = await firefliesQuery(GQL_TRANSCRIPT_SENTENCES, { transcriptId });
      try { localStorage.setItem(FF_SENTENCES_KEY, JSON.stringify(d)); } catch {}
      return d;
    },
    initialData: cachedSentences || undefined,
    enabled: transcriptExpanded && !cachedSentences,
    staleTime: Infinity,
    retry: 0,
  });

  const sentences = sentencesData?.transcript?.sentences || [];

  const meeting = data?.transcript;
  const summary = meeting?.summary;

  const actionItems = (() => {
    if (!summary?.action_items) return [];
    if (Array.isArray(summary.action_items)) return summary.action_items;
    return summary.action_items.split("\n").filter(Boolean);
  })();

  const decisions = (() => {
    if (!summary?.outline) {
      if (!summary?.shorthand_bullet) return [];
      if (Array.isArray(summary.shorthand_bullet)) return summary.shorthand_bullet;
      return summary.shorthand_bullet.split("\n").filter(Boolean);
    }
    if (Array.isArray(summary.outline)) return summary.outline;
    return summary.outline.split("\n").filter(Boolean);
  })();

  const overview = summary?.overview || summary?.short_overview || summary?.bullet_gist || "";

  const countMatches = useCallback((text, query) => {
    if (!query || !text) return 0;
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return (text.match(regex) || []).length;
  }, []);

  const transcriptText = sentences.map((s) => s.text).join(" ");
  const allText = [overview, ...actionItems, ...decisions, transcriptText].join("\n");
  const totalMatches = search ? countMatches(allText, search) : 0;

  const highlightWithActive = useCallback((text, query, startOffset) => {
    if (!query || !text) return { node: text, endOffset: startOffset };
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);
    let offset = startOffset;
    const node = parts.map((part, i) => {
      if (regex.test(part)) {
        const isActive = offset === matchIdx;
        offset++;
        return (
          <span
            key={i}
            ref={isActive ? (el) => { if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); } : undefined}
            style={{
              background: isActive ? "#f59e0b" : "#fde68a",
              borderRadius: 2,
              padding: "0 1px",
              fontWeight: isActive ? 700 : "inherit",
            }}
          >
            {part}
          </span>
        );
      }
      return part;
    });
    return { node, endOffset: offset };
  }, [matchIdx]);

  const renderHighlighted = useCallback((text, offsetStart) => {
    if (!search) return { node: text, endOffset: offsetStart };
    return highlightWithActive(text, search, offsetStart);
  }, [search, highlightWithActive]);

  // Render markdown-ish text from Fireflies (bold, lists, line breaks)
  const renderMarkdown = useCallback((text, offsetStart) => {
    if (!text) return { node: null, endOffset: offsetStart };
    // Split into lines, handle "- " prefixed bullet items
    const lines = text.split(/\n|(?= - \*\*)/g).filter((l) => l.trim());
    let offset = offsetStart;
    const nodes = lines.map((line, li) => {
      const trimmed = line.replace(/^- /, "").trim();
      // Process **bold** segments
      const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
      const rendered = parts.map((part, pi) => {
        const boldMatch = part.match(/^\*\*(.+)\*\*$/);
        if (boldMatch) {
          const { node, endOffset } = renderHighlighted(boldMatch[1], offset);
          offset = endOffset;
          return <strong key={`${li}-${pi}`}>{node}</strong>;
        }
        const { node, endOffset } = renderHighlighted(part, offset);
        offset = endOffset;
        return <span key={`${li}-${pi}`}>{node}</span>;
      });
      // If line started with "- ", render as a bullet
      if (line.trimStart().startsWith("- ")) {
        return (
          <Box key={li} sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 0.5 }}>
            <FiberManualRecord sx={{ fontSize: 5, color: t.ink3, mt: "7px", flexShrink: 0 }} />
            <span>{rendered}</span>
          </Box>
        );
      }
      return <Box key={li} sx={{ mb: 0.5 }}>{rendered}</Box>;
    });
    return { node: nodes, endOffset: offset };
  }, [renderHighlighted]);

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: "12px", maxHeight: "80vh" } }}
    >
      {isLoading ? (
        <Box sx={{ p: 4 }}>
          <ShimmerBar $h={22} $w="55%" $mb={10} />
          <ShimmerBar $h={14} $w="35%" $mb={24} />
          <ShimmerBar $h={10} $w="20%" $mb={12} />
          <ShimmerBar $h={12} $w="95%" $mb={6} />
          <ShimmerBar $h={12} $w="88%" $mb={6} />
          <ShimmerBar $h={12} $w="75%" $mb={20} />
          <ShimmerBar $h={10} $w="18%" $mb={12} />
          <ShimmerBar $h={12} $w="80%" $mb={6} />
          <ShimmerBar $h={12} $w="70%" $mb={6} />
          <ShimmerBar $h={12} $w="85%" $mb={6} />
          <ShimmerBar $h={12} $w="60%" $mb={0} />
        </Box>
      ) : !meeting ? (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography sx={{ color: t.ink3 }}>Meeting not found</Typography>
        </Box>
      ) : (
        <>
          {/* Header */}
          <Box sx={{ p: "20px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <Box>
              <Typography sx={{ fontFamily: t.serif, fontSize: 18, fontWeight: 700, color: t.ink, mb: 0.3 }}>
                {meeting.title}
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography sx={{ fontSize: 12, color: t.ink3 }}>
                  {meeting.date ? format(new Date(meeting.date), "EEEE, MMMM d, yyyy 'at' h:mm a") : ""}
                </Typography>
              </Box>
            </Box>
            <IconButton size="small" onClick={onClose} sx={{ mt: -0.5 }}>
              <Close sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>

          {/* Navigation dropdowns */}
          {(() => {
            // Extract Key Decision headers
            const decisionHeaders = decisions
              .map((d, i) => ({ text: d.replace(/^- /, "").trim(), idx: i }))
              .filter(({ text }) => /\*\*.+\*\*/.test(text) && (text.includes("(") || /^\W/.test(text)))
              .map(({ text, idx }) => ({
                label: text.replace(/\*\*/g, "").replace(/\([\d:]+\s*-\s*[\d:]+\)/g, "").replace(/^[^\w]*/, "").trim(),
                id: `kd-${idx}`,
                rawText: text,
              }));
            // Extract Assignee headers from action items
            const assigneeHeaders = actionItems
              .map((item, i) => ({ text: item.trim(), idx: i }))
              .filter(({ text }) => /^\*\*[^*]+\*\*$/.test(text))
              .map(({ text, idx }) => ({
                label: text.replace(/\*\*/g, "").trim(),
                id: `ai-${idx}`,
              }));
            const dropdownSx = {
              minWidth: 150,
              "& .MuiInputBase-root": { fontSize: 11, borderRadius: "8px", background: t.cream, height: 32, color: t.ink3 },
              "& .MuiOutlinedInput-notchedOutline": { borderColor: t.cream3 },
              "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: t.copperLight },
              "& .Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: t.copper },
              "& .MuiSelect-select": { py: "6px" },
            };
            const menuProps = {
              autoFocus: false,
              anchorOrigin: { vertical: "bottom", horizontal: "left" },
              transformOrigin: { vertical: "top", horizontal: "left" },
              PaperProps: {
                sx: {
                  maxHeight: 300,
                  mt: "-1px",
                  borderRadius: "0 0 8px 8px",
                  border: `1px solid ${t.cream3}`,
                  borderTop: "none",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  background: t.cream,
                },
              },
            };
            return (
              <Box sx={{ px: 3, py: 1.5, display: "flex", alignItems: "center", gap: 1.5 }}>
                {decisionHeaders.length > 0 && (
                  <TextField
                    select
                    size="small"
                    value="__none__"
                    onChange={(e) => {
                      if (e.target.value === "__none__") return;
                      setSearch(""); setMatchIdx(0);
                      const el = document.getElementById(e.target.value);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                      const header = decisionHeaders.find((h) => h.id === e.target.value);
                      if (header) {
                        const range = parseTimestampRange(header.rawText || "");
                        if (range) {
                          setHighlightRange(range);
                          setTranscriptExpanded(true);
                        }
                      }
                    }}
                    sx={dropdownSx}
                    SelectProps={{
                      renderValue: () => "Decisions ↓",
                      MenuProps: menuProps,
                    }}
                  >
                    <MenuItem value="__none__" sx={{ display: "none" }} />
                    {[...decisionHeaders].sort((a, b) => a.label.localeCompare(b.label)).map((h) => (
                      <MenuItem key={h.id} value={h.id} sx={{ fontSize: 12 }}>{h.label}</MenuItem>
                    ))}
                  </TextField>
                )}
                {assigneeHeaders.length > 0 && (
                  <TextField
                    select
                    size="small"
                    value="__none__"
                    onChange={(e) => {
                      if (e.target.value === "__none__") return;
                      setSearch(""); setMatchIdx(0);
                      const el = document.getElementById(e.target.value);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    sx={dropdownSx}
                    SelectProps={{
                      renderValue: () => "Assignee ↓",
                      MenuProps: menuProps,
                    }}
                  >
                    <MenuItem value="__none__" sx={{ display: "none" }} />
                    {[...assigneeHeaders].sort((a, b) => a.label.localeCompare(b.label)).map((h) => (
                      <MenuItem key={h.id} value={h.id} sx={{ fontSize: 12 }}>{h.label}</MenuItem>
                    ))}
                  </TextField>
                )}
                <Box sx={{ flex: 1 }} />
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, maxWidth: 240 }}>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Find..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setMatchIdx(0); }}
                    InputProps={{
                      startAdornment: <Search sx={{ color: t.ink3, fontSize: 16, mr: 0.5 }} />,
                      ...(search && {
                        endAdornment: (
                          <IconButton size="small" onClick={() => { setSearch(""); setMatchIdx(0); }}>
                            <Close sx={{ fontSize: 14 }} />
                          </IconButton>
                        ),
                      }),
                    }}
                    sx={{
                      "& .MuiInputBase-root": { fontSize: 11, borderRadius: "8px", background: t.cream, height: 32 },
                      "& .MuiOutlinedInput-notchedOutline": { borderColor: t.cream3 },
                      "& .Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: t.copper },
                    }}
                  />
                  {search && totalMatches > 0 && (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.3, flexShrink: 0 }}>
                      <Typography sx={{ fontSize: 10, color: t.ink3, whiteSpace: "nowrap" }}>
                        {matchIdx + 1}/{totalMatches}
                      </Typography>
                      <IconButton size="small" sx={{ p: 0.3 }} onClick={() => setMatchIdx((p) => (p - 1 + totalMatches) % totalMatches)}>
                        <ChevronLeft sx={{ fontSize: 14 }} />
                      </IconButton>
                      <IconButton size="small" sx={{ p: 0.3 }} onClick={() => setMatchIdx((p) => (p + 1) % totalMatches)}>
                        <ChevronRight sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Box>
                  )}
                  {search && totalMatches === 0 && (
                    <Typography sx={{ fontSize: 10, color: t.ink3, whiteSpace: "nowrap" }}>0</Typography>
                  )}
                </Box>
              </Box>
            );
          })()}

          {/* Keyword quick-search pills */}
          {summary?.keywords?.length > 0 && (
            <Box sx={{ px: 3, py: 1.5, display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center" }}>
              <Typography sx={{ fontSize: 10, color: t.ink3, mr: 0.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Topics:
              </Typography>
              {summary.keywords.map((kw, i) => {
                const isActive = search.toLowerCase() === kw.toLowerCase();
                return (
                  <MiniPill
                    key={i}
                    onClick={() => {
                      if (isActive) { setSearch(""); setMatchIdx(0); }
                      else { setSearch(kw); setMatchIdx(0); setTranscriptExpanded(true); }
                    }}
                    style={{
                      background: isActive ? t.copper : t.cream2,
                      color: isActive ? "white" : t.ink3,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {kw}
                  </MiniPill>
                );
              })}
            </Box>
          )}

          <Divider />

          {/* Content */}
          <DialogContent sx={{ p: "16px 24px 24px" }}>
            {/* Overview */}
            {overview && (() => {
              const { node } = renderMarkdown(overview, 0);
              return (
                <Box sx={{ mb: 3 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: t.copper, mb: 1 }}>
                    Overview
                  </Typography>
                  <Typography component="div" sx={{ fontSize: 13, color: t.ink, lineHeight: 1.7 }}>
                    {node}
                  </Typography>
                </Box>
              );
            })()}

            {/* Action Items */}
            {actionItems.length > 0 && (() => {
              let offset = search ? countMatches(overview, search) : 0;
              return (
                <Box sx={{ mb: 3 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: t.copper, mb: 1 }}>
                    Action Items
                  </Typography>
                  {actionItems.map((item, i) => {
                    // Items like "**Name**" are section headers
                    const headerMatch = item.trim().match(/^\*\*(.+)\*\*$/);
                    if (headerMatch) {
                      const { node, endOffset } = renderHighlighted(headerMatch[1], offset);
                      offset = endOffset;
                      return (
                        <Typography key={i} id={`ai-${i}`} sx={{ fontSize: 12, fontWeight: 700, color: t.ink, mt: i > 0 ? 1.5 : 0, mb: 0.5 }}>
                          {node}
                        </Typography>
                      );
                    }
                    // Strip leading "- " if present
                    const cleaned = item.replace(/^- /, "").trim();
                    // Render inline bold
                    const parts = cleaned.split(/(\*\*[^*]+\*\*)/g);
                    const rendered = parts.map((part, pi) => {
                      const bold = part.match(/^\*\*(.+)\*\*$/);
                      if (bold) {
                        const { node, endOffset } = renderHighlighted(bold[1], offset);
                        offset = endOffset;
                        return <strong key={pi}>{node}</strong>;
                      }
                      const { node, endOffset } = renderHighlighted(part, offset);
                      offset = endOffset;
                      return <span key={pi}>{node}</span>;
                    });
                    return (
                      <Box
                        key={i}
                        onClick={() => {
                          const range = parseTimestampRange(cleaned);
                          if (range) {
                            const CONTEXT = 30;
                            setHighlightRange({ start: range.start - CONTEXT, end: range.start + CONTEXT });
                            setTranscriptExpanded(true);
                            setTimeout(() => {
                              const el = document.getElementById("transcript-highlight");
                              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                            }, 300);
                          }
                        }}
                        sx={{
                          display: "flex", alignItems: "flex-start", gap: 1, mb: 0.4, pl: 2,
                          cursor: "pointer", borderRadius: "4px",
                          "&:hover": { background: "rgba(184,115,51,0.04)" }, transition: "background 0.15s",
                        }}
                      >
                        <FiberManualRecord sx={{ fontSize: 5, color: t.ink3, mt: "6px", flexShrink: 0 }} />
                        <Typography component="span" sx={{ fontSize: 12, color: t.ink2, lineHeight: 1.6 }}>{rendered}</Typography>
                      </Box>
                    );
                  })}
                </Box>
              );
            })()}

            {/* Key Decisions */}
            {decisions.length > 0 && (() => {
              let offset = search
                ? countMatches(overview, search) + actionItems.reduce((sum, ai) => sum + countMatches(ai, search), 0)
                : 0;
              return (
                <Box>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: t.copper, mb: 1 }}>
                    Key Decisions
                  </Typography>
                  {decisions.map((item, i) => {
                    const cleaned = item.replace(/^- /, "").trim();
                    // Detect header lines: contain **bold** text (topic titles with timestamps/emoji)
                    const isHeader = /\*\*.+\*\*/.test(cleaned) && (cleaned.includes("(") || /^\W/.test(cleaned));
                    const parts = cleaned.split(/(\*\*[^*]+\*\*)/g);
                    const rendered = parts.map((part, pi) => {
                      const bold = part.match(/^\*\*(.+)\*\*$/);
                      if (bold) {
                        const { node, endOffset } = renderHighlighted(bold[1], offset);
                        offset = endOffset;
                        return <strong key={pi}>{node}</strong>;
                      }
                      const { node, endOffset } = renderHighlighted(part, offset);
                      offset = endOffset;
                      return <span key={pi}>{node}</span>;
                    });
                    if (isHeader) {
                      return (
                        <Typography
                          key={i}
                          id={`kd-${i}`}
                          component="div"
                          onClick={() => {
                            const range = parseTimestampRange(cleaned);
                            if (range) {
                              setHighlightRange(range);
                              setTranscriptExpanded(true);
                              setTimeout(() => {
                                const el = document.getElementById("transcript-highlight");
                                if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                              }, 300);
                            }
                          }}
                          sx={{ fontSize: 12, fontWeight: 600, color: t.ink, mt: i > 0 ? 1.2 : 0, mb: 0.3, cursor: "pointer", "&:hover": { color: t.copper }, transition: "color 0.15s" }}
                        >
                          {rendered}
                        </Typography>
                      );
                    }
                    return (
                      <Box key={i} sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 0.4, pl: 2 }}>
                        <FiberManualRecord sx={{ fontSize: 5, color: t.ink3, mt: "6px", flexShrink: 0 }} />
                        <Typography component="span" sx={{ fontSize: 12, color: t.ink2, lineHeight: 1.6 }}>{rendered}</Typography>
                      </Box>
                    );
                  })}
                </Box>
              );
            })()}

            {/* ── Transcript ── */}
            <Box sx={{ mt: 3, borderTop: `1px solid ${t.cream2}`, pt: 2 }}>
              <Box
                onClick={() => setTranscriptExpanded(!transcriptExpanded)}
                sx={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  cursor: "pointer", "&:hover": { opacity: 0.8 }, transition: "opacity 0.15s",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.8 }}>
                  <ExpandMore sx={{ fontSize: 16, color: t.ink3, transform: transcriptExpanded ? "rotate(0)" : "rotate(-90deg)", transition: "transform 0.2s" }} />
                  <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: t.copper }}>
                    Transcript
                  </Typography>
                </Box>
                {meeting?.duration && (
                  <Typography sx={{ fontSize: 10, color: t.ink3 }}>
                    {formatTimestamp(meeting.duration)}
                  </Typography>
                )}
              </Box>

              <Collapse in={transcriptExpanded}>
                <Box sx={{ mt: 1.5, maxHeight: 500, overflowY: "auto" }} id="transcript-container">
                  {sentences.length === 0 ? (
                    <Box sx={{ py: 2 }}>
                      <ShimmerBar $h={12} $w="30%" $mb={8} />
                      <ShimmerBar $h={12} $w="90%" $mb={4} />
                      <ShimmerBar $h={12} $w="75%" $mb={8} />
                      <ShimmerBar $h={12} $w="25%" $mb={8} />
                      <ShimmerBar $h={12} $w="85%" $mb={4} />
                      <ShimmerBar $h={12} $w="60%" $mb={0} />
                    </Box>
                  ) : (
                    (() => {
                      // Group consecutive sentences by same speaker
                      const groups = [];
                      sentences.forEach((s) => {
                        const last = groups[groups.length - 1];
                        if (last && last.speaker === s.speaker_name) {
                          last.sentences.push(s);
                        } else {
                          groups.push({ speaker: s.speaker_name, startTime: s.start_time, sentences: [s] });
                        }
                      });
                      // Transcript search offset starts after overview + actionItems + decisions
                      let txOffset = search
                        ? countMatches(overview, search) + actionItems.reduce((sum, ai) => sum + countMatches(ai, search), 0) + decisions.reduce((sum, d) => sum + countMatches(d, search), 0)
                        : 0;
                      return groups.map((group, gi) => {
                        const groupStart = parseFloat(group.startTime);
                        const groupEnd = parseFloat(group.sentences[group.sentences.length - 1].end_time || group.sentences[group.sentences.length - 1].start_time);
                        const isHighlighted = highlightRange &&
                          groupEnd >= highlightRange.start &&
                          groupStart <= highlightRange.end;
                        const isFirstHighlight = isHighlighted && (gi === 0 || (() => {
                          const prevGroup = groups[gi - 1];
                          const prevEnd = parseFloat(prevGroup.sentences[prevGroup.sentences.length - 1].end_time || prevGroup.sentences[prevGroup.sentences.length - 1].start_time);
                          return prevEnd < highlightRange.start;
                        })());
                        const groupText = group.sentences.map((s) => s.text).join(" ");
                        const { node: highlightedText, endOffset } = renderHighlighted(groupText, txOffset);
                        txOffset = endOffset;
                        return (
                          <Box
                            key={gi}
                            id={isFirstHighlight ? "transcript-highlight" : undefined}
                            sx={{
                              py: 0.5, px: 1, mt: gi > 0 ? 0.8 : 0,
                              borderLeft: isHighlighted ? `3px solid ${t.copper}` : "3px solid transparent",
                              background: isHighlighted ? "rgba(184,115,51,0.08)" : "transparent",
                              transition: "all 0.2s",
                            }}
                          >
                            <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.8, mb: 0.3 }}>
                              <Typography sx={{ fontSize: 11, fontWeight: 700, color: t.ink }}>
                                {group.speaker}
                              </Typography>
                              <Typography sx={{ fontSize: 9, color: t.ink3 }}>
                                {formatTimestamp(group.startTime)}
                              </Typography>
                            </Box>
                            <Typography sx={{ fontSize: 12, color: t.ink2, lineHeight: 1.7 }}>
                              {highlightedText}
                            </Typography>
                          </Box>
                        );
                      });
                    })()
                  )}
                </Box>
              </Collapse>
            </Box>
          </DialogContent>
        </>
      )}
    </Dialog>
  );
}
