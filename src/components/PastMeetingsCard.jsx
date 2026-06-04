// PastMeetingsCard — Fireflies "Past Meetings" section on the Agenda detail page.
//
// Ported from Console archive src/pages/pages/Agenda.jsx:3470-3743. Logic
// (list fetch + localStorage cache + prefetch-in-batches-of-10 + deep search)
// is verbatim. Changes for Management:
//   - Title source: the `firefliesTitles` prop (the agenda doc's array) instead
//     of the archive's org-scoped useFirefliesMeetings hook.
//   - Title match is CASE-INSENSITIVE (archive used a case-sensitive Set) —
//     historical titles are hand-entered and case drift is common (Andy call,
//     2026-05-29). Going-forward titles created via this tool stay consistent.
//   - Section chrome matches the neighboring Open Floor section (copper bar +
//     uppercase label) rather than the archive's sidebar Section card, since it
//     mounts in the main column below Open Floor per AGENDA_DETAIL_PAGE_REFERENCE.md.
//
// Caching: list at localStorage `fireflies-meetings-cache`; per-meeting detail
// at `fireflies-detail-{id}`. Fireflies Business plan = 60 req/min; the
// aggressive cache keeps us well under in practice.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box, Button, CircularProgress, Divider, IconButton,
  TextField, Tooltip, Typography,
} from "@mui/material";
import { Close, Refresh, Search } from "@mui/icons-material";
import { format } from "date-fns";

import { firefliesQuery, GQL_MEETING_DETAIL, GQL_MEETING_LIST } from "../lib/fireflies.js";
import { t } from "../theme/tokens.js";
import { MiniPill, ShimmerBar } from "./firefliesStyled.js";
import MeetingDetailModal from "./MeetingDetailModal.jsx";

export default function PastMeetingsCard({ firefliesTitles }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  // Snapshot of recording IDs at mount (or last manual refresh).
  // Used to mark recordings that appeared since then with a NEW badge.
  const seedIdsRef = useRef(
    (() => {
      try {
        const raw = localStorage.getItem("fireflies-meetings-cache");
        const parsed = raw ? JSON.parse(raw) : null;
        return new Set((parsed?.data?.transcripts || []).map((tr) => tr.id));
      } catch { return new Set(); }
    })()
  );

  // Persist the Fireflies list to localStorage so it survives page refreshes.
  const FF_CACHE_KEY = "fireflies-meetings-cache";
  const cached = useMemo(() => {
    try {
      const raw = localStorage.getItem(FF_CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }, []);

  const CACHE_TTL_MS = 30 * 60 * 1000;
  const { data: listData, isLoading: listLoading, isFetching, refetch } = useQuery({
    queryKey: ["fireflies-meetings-all"],
    queryFn: async () => {
      const data = await firefliesQuery(GQL_MEETING_LIST, { limit: 50 });
      const now = new Date();
      try { localStorage.setItem(FF_CACHE_KEY, JSON.stringify({ data, fetchedAt: now.toISOString() })); } catch {}
      return data;
    },
    initialData: cached?.data || undefined,
    initialDataUpdatedAt: cached?.fetchedAt ? new Date(cached.fetchedAt).getTime() : 0,
    staleTime: CACHE_TTL_MS,
    retry: 0,
  });

  // Filter to only meetings matching this agenda's Fireflies title mappings.
  // Case-insensitive + trimmed so hand-entered historical aliases still match.
  const allMeetings = useMemo(() => {
    const all = listData?.transcripts || [];
    if (!firefliesTitles?.length) return [];
    const titleSet = new Set(firefliesTitles.map((s) => (s || "").toLowerCase().trim()));
    return all.filter((m) => titleSet.has((m.title || "").toLowerCase().trim()));
  }, [listData, firefliesTitles]);

  // Prefetch all meeting details in parallel on mount — enables deep search
  const [detailsMap, setDetailsMap] = useState({});
  const [prefetchDone, setPrefetchDone] = useState(false);
  useEffect(() => {
    if (!allMeetings.length || prefetchDone) return;
    let cancelled = false;
    (async () => {
      const toFetch = [];
      const fromCache = {};
      for (const m of allMeetings) {
        const key = `fireflies-detail-${m.id}`;
        try {
          const raw = localStorage.getItem(key);
          if (raw) { fromCache[m.id] = JSON.parse(raw); continue; }
        } catch {}
        toFetch.push(m);
      }
      if (!cancelled && Object.keys(fromCache).length) setDetailsMap((prev) => ({ ...prev, ...fromCache }));

      // Fetch uncached in parallel batches of 10
      for (let i = 0; i < toFetch.length; i += 10) {
        if (cancelled) break;
        const batch = toFetch.slice(i, i + 10);
        const results = await Promise.allSettled(
          batch.map(async (m) => {
            const d = await firefliesQuery(GQL_MEETING_DETAIL, { transcriptId: m.id });
            try { localStorage.setItem(`fireflies-detail-${m.id}`, JSON.stringify(d)); } catch {}
            return { id: m.id, data: d };
          })
        );
        if (cancelled) break;
        const batchMap = {};
        for (const r of results) {
          if (r.status === "fulfilled") batchMap[r.value.id] = r.value.data;
        }
        setDetailsMap((prev) => ({ ...prev, ...batchMap }));
      }
      if (!cancelled) setPrefetchDone(true);
    })();
    return () => { cancelled = true; };
  }, [allMeetings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stubs retained for JSX compatibility — Task 2 removes these render blocks entirely.
  const meetingTitles = [];
  const [titleFilter, setTitleFilter] = useState(null);

  // Deep search across prefetched details
  const meetings = useMemo(() => {
    let filtered = allMeetings;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((m) => {
        const title = (m.title || "").toLowerCase();
        const snippet = (m.summary?.short_summary || m.summary?.overview || "").toLowerCase();
        const date = m.date ? format(new Date(m.date), "MMM d, yyyy").toLowerCase() : "";
        if (title.includes(q) || snippet.includes(q) || date.includes(q)) return true;
        // Deep search in prefetched detail data
        const detail = detailsMap[m.id]?.transcript?.summary;
        if (detail) {
          const overview = (detail.overview || "").toLowerCase();
          const actions = (detail.action_items || "").toLowerCase();
          const keywords = (Array.isArray(detail.keywords) ? detail.keywords.join(" ") : (detail.keywords || "")).toLowerCase();
          const topicsDisc = (Array.isArray(detail.topics_discussed) ? detail.topics_discussed.join(" ") : (detail.topics_discussed || "")).toLowerCase();
          const bullets = (detail.bullet_gist || "").toLowerCase();
          if (overview.includes(q) || actions.includes(q) || keywords.includes(q) || topicsDisc.includes(q) || bullets.includes(q)) return true;
        }
        return false;
      });
    }
    return filtered;
  }, [allMeetings, search, detailsMap]);
  const highlight = (text, query) => {
    if (!query || !text) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <span key={i} style={{ background: "#fde68a", borderRadius: 2, padding: "0 1px" }}>{part}</span>
      ) : part
    );
  };

  const handleRefresh = () => {
    // Update seedIds to current list so only recordings that appear *after*
    // this press get the NEW badge.
    seedIdsRef.current = new Set((listData?.transcripts || []).map((t) => t.id));
    refetch();
  };

  return (
    <>
      <Box sx={{ mt: 4 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <Box sx={{ width: 3, height: 16, borderRadius: 0.5, background: t.copper }} />
          <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.copper }}>
            Past Meetings
          </Typography>
          {meetings?.length > 0 && (
            <MiniPill style={{ background: t.copperFaint, color: t.copper }}>{meetings.length}</MiniPill>
          )}
        </Box>

        <Box sx={{ pl: 1 }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search past meetings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: <Search sx={{ color: t.ink3, fontSize: 18, mr: 0.5 }} />,
              ...(search && {
                endAdornment: (
                  <IconButton size="small" onClick={() => setSearch("")}>
                    <Close sx={{ fontSize: 16 }} />
                  </IconButton>
                ),
              }),
            }}
            sx={{
              mb: 1.5,
              "& .MuiInputBase-root": { fontSize: 12, borderRadius: "8px", background: t.cream },
              "& .MuiOutlinedInput-notchedOutline": { borderColor: t.cream3 },
              "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: t.copperLight },
              "& .Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: t.copper },
            }}
          />

          {/* Meeting title filter pills */}
          {meetingTitles.length > 1 && (
            <>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center", py: 1.5 }}>
                <Typography sx={{ fontSize: 10, color: t.ink3, mr: 0.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Meetings:
                </Typography>
                {meetingTitles.map(({ title, count: c }) => {
                  const isActive = titleFilter === title;
                  return (
                    <MiniPill
                      key={title}
                      onClick={() => setTitleFilter(isActive ? null : title)}
                      style={{
                        background: isActive ? t.copper : t.cream2,
                        color: isActive ? "white" : t.ink3,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {title} ({c})
                    </MiniPill>
                  );
                })}
              </Box>
              <Divider sx={{ mb: 1.5 }} />
            </>
          )}

          <Box sx={{ maxHeight: 400, overflowY: "auto" }}>
            {listLoading ? (
              [0, 1, 2].map((i) => (
                <Box key={i} sx={{ p: 1.5, borderBottom: `1px solid ${t.cream2}` }}>
                  <ShimmerBar $h={14} $w="40%" $mb={6} />
                  <ShimmerBar $h={12} $w="90%" $mb={4} />
                  <ShimmerBar $h={12} $w="70%" $mb={0} />
                </Box>
              ))
            ) : !meetings || meetings.length === 0 ? (
              <Typography sx={{ fontSize: 12, color: t.ink3, fontStyle: "italic", py: 2, textAlign: "center" }}>
                {search ? "No meetings match your search" : "No recorded meetings found for this series"}
              </Typography>
            ) : (
              meetings.map((m) => {
                const actionItems = (() => {
                  const s = m.summary;
                  if (!s?.action_items) return [];
                  if (Array.isArray(s.action_items)) return s.action_items;
                  return s.action_items.split("\n").filter(Boolean);
                })();
                const snippet = m.summary?.short_summary || m.summary?.overview || "";
                const truncated = snippet.length > 160 ? snippet.slice(0, 160) + "..." : snippet;
                return (
                  <Box
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    sx={{
                      p: 1.5,
                      borderBottom: `1px solid ${t.cream2}`,
                      cursor: "pointer",
                      transition: "background 0.1s",
                      "&:hover": { background: t.copperFaint },
                      "&:last-child": { borderBottom: "none" },
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.3 }}>
                      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
                        <Typography sx={{ fontSize: 12, fontWeight: 600, color: t.ink }}>
                          {m.title || "Untitled"}
                        </Typography>
                        <Typography sx={{ fontSize: 10, color: t.ink3 }}>
                          {m.date ? format(new Date(m.date), "MMM d, yyyy") : "Unknown date"}
                        </Typography>
                      </Box>
                      {actionItems.length > 0 && (
                        <MiniPill style={{ background: t.copperFaint, color: t.copper }}>
                          {actionItems.length} action item{actionItems.length !== 1 ? "s" : ""}
                        </MiniPill>
                      )}
                    </Box>
                    <Typography sx={{ fontSize: 11, color: t.ink2, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {search ? highlight(truncated, search) : truncated}
                    </Typography>
                  </Box>
                );
              })
            )}
          </Box>
        </Box>
      </Box>

      {selectedId && (
        <MeetingDetailModal
          transcriptId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}
