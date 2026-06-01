// FirefliesMeetings — management page (v0.2.3.g, new per Andy 2026-05-29).
//
// Own top-level sidebar tab (/fireflies). Title-centric: lists unique Fireflies
// recording titles and lets you map each to an existing Meeting Agenda. The map
// writes the title into the agenda's `firefliesTitles[]` array (the same lookup
// the PastMeetingsCard reads). This is the sole mapping UI — there is no
// per-agenda editor (Andy call).
//
// Why title-centric + grouped: the lookup matches by TITLE (case-insensitive),
// and recordings repeat the same title weekly, so the unit you manage is the
// unique title, not each recording. Meetings drifted titles over time, so one
// agenda can carry several historical titles; map each title row to the agenda.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { Add, Close, Refresh, Search } from "@mui/icons-material";
import { format } from "date-fns";
import { arrayRemove, arrayUnion, doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { db } from "../firebase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useCollection } from "../hooks/useCollection.js";
import { firefliesQuery, GQL_MEETING_LIST } from "../lib/fireflies.js";
import { t } from "../theme/tokens.js";
import { MiniPill } from "../components/firefliesStyled.js";
import MeetingDetailModal from "../components/MeetingDetailModal.jsx";

const PAGE_SIZE = 50;

export default function FirefliesMeetings() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState(null);
  const [mappingTitle, setMappingTitle] = useState(null); // which title row is showing its agenda picker
  const [writeError, setWriteError] = useState(null);

  // Fireflies recordings. Seed limit-50 from the card's shared localStorage
  // cache so first paint is instant when the card was visited; larger pages
  // fetch fresh (kept in React Query memory for the session).
  const seed = useMemo(() => {
    if (limit !== PAGE_SIZE) return undefined;
    try {
      const raw = localStorage.getItem("fireflies-meetings-cache");
      return raw ? JSON.parse(raw).data : undefined;
    } catch { return undefined; }
  }, [limit]);

  const { data: listData, isFetching, refetch } = useQuery({
    queryKey: ["fireflies-meetings-manage", limit],
    queryFn: async () => {
      const data = await firefliesQuery(GQL_MEETING_LIST, { limit });
      if (limit === PAGE_SIZE) {
        try { localStorage.setItem("fireflies-meetings-cache", JSON.stringify({ data, fetchedAt: new Date().toISOString() })); } catch {}
      }
      return data;
    },
    initialData: seed,
    staleTime: Infinity,
    retry: 0,
  });

  // All agendas (Firestore) — to resolve which agendas each title is mapped to
  // and to power the "map to agenda" autocomplete.
  const { data: agendas } = useCollection("agendas");
  // calendar_series — to keep the "map to agenda" dropdown to ACTIVE meetings
  // only (drop archived/cancelled series + orphaned agendas whose series was
  // deleted; dedupe per meeting).
  const { data: seriesDocs } = useCollection("calendar_series");
  const seriesById = useMemo(() => {
    const m = {};
    for (const s of seriesDocs || []) m[s.id] = s;
    return m;
  }, [seriesDocs]);

  // Reverse index: lowercased title -> [{ agendaId, agendaTitle, storedTitle }].
  // storedTitle is the EXACT string in the agenda's array (needed for an exact
  // arrayRemove, since matching is case-insensitive but removal is not).
  const agendasByTitleLc = useMemo(() => {
    const idx = {};
    for (const a of agendas || []) {
      for (const stored of a.firefliesTitles || []) {
        const lc = (stored || "").toLowerCase().trim();
        if (!lc) continue;
        (idx[lc] ||= []).push({ agendaId: a.id, agendaTitle: a.title || "(untitled)", storedTitle: stored });
      }
    }
    return idx;
  }, [agendas]);

  // Group recordings by unique title.
  const titleGroups = useMemo(() => {
    const map = {};
    for (const m of listData?.transcripts || []) {
      const key = m.title || "Untitled";
      if (!map[key]) map[key] = { title: key, recordings: [] };
      map[key].recordings.push(m);
    }
    return Object.values(map)
      .map((g) => {
        g.recordings.sort((a, b) => new Date(b.date) - new Date(a.date));
        const dates = g.recordings.map((r) => r.date).filter(Boolean);
        return {
          title: g.title,
          count: g.recordings.length,
          latestId: g.recordings[0]?.id || null,
          earliest: dates.length ? Math.min(...dates) : null,
          latest: dates.length ? Math.max(...dates) : null,
        };
      })
      .sort((a, b) => (b.latest || 0) - (a.latest || 0));
  }, [listData]);

  // Active agendas only: a non-empty title + a resolvable series that isn't
  // archived or cancelled (orphaned agendas whose series was deleted are also
  // dropped). Deduped per meeting (title + org) so recurring base/_R doubles
  // collapse to one option. Junk test agendas should be deleted at the source;
  // this just keeps the picker usable.
  const agendaOptions = useMemo(() => {
    const byMeeting = new Map();
    for (const a of agendas || []) {
      const label = (a.title || "").trim();
      if (!label) continue;
      const s = seriesById[a.calendarSeriesId || a.id];
      if (!s) continue; // orphaned (series deleted) → not an active meeting
      if (s.archived || s.status === "cancelled") continue;
      const key = `${label.toLowerCase()}|${a.organizationId || s.organizationId || ""}`;
      if (!byMeeting.has(key)) {
        byMeeting.set(key, { id: a.id, label, organizationId: a.organizationId || s.organizationId || null });
      }
    }
    return [...byMeeting.values()].sort((x, y) => x.label.localeCompare(y.label));
  }, [agendas, seriesById]);

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim();
    return titleGroups.filter((g) => {
      const mapped = agendasByTitleLc[g.title.toLowerCase().trim()] || [];
      if (unmappedOnly && mapped.length > 0) return false;
      if (q && !g.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [titleGroups, agendasByTitleLc, search, unmappedOnly]);

  const mapTitle = async (agendaId, title) => {
    setWriteError(null);
    try {
      await updateDoc(doc(db, "agendas", agendaId), {
        firefliesTitles: arrayUnion(title),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      });
    } catch (e) {
      setWriteError(e.message || "Failed to map title");
    }
    setMappingTitle(null);
  };

  const unmapTitle = async (agendaId, storedTitle) => {
    setWriteError(null);
    try {
      await updateDoc(doc(db, "agendas", agendaId), {
        firefliesTitles: arrayRemove(storedTitle),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      });
    } catch (e) {
      setWriteError(e.message || "Failed to unmap title");
    }
  };

  const fmtRange = (earliest, latest) => {
    if (!earliest && !latest) return "—";
    const e = earliest ? format(new Date(earliest), "MMM d, yyyy") : "?";
    const l = latest ? format(new Date(latest), "MMM d, yyyy") : "?";
    return e === l ? e : `${e} – ${l}`;
  };

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto", px: 4, py: 4 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, mb: 0.5 }}>
        <Typography sx={{ fontFamily: t.serif, fontSize: 28, color: t.ink }}>
          Fireflies Meetings
        </Typography>
        {titleGroups.length > 0 && (
          <Typography sx={{ fontSize: 13, color: t.ink3 }}>
            {titleGroups.length} unique title{titleGroups.length !== 1 ? "s" : ""}
          </Typography>
        )}
      </Box>
      <Typography sx={{ fontSize: 13, color: t.ink3, mb: 2.5 }}>
        Link each Fireflies recording title to a Meeting Agenda. Mapped titles surface as Past Meetings on that agenda.
      </Typography>

      {/* Controls */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2, flexWrap: "wrap" }}>
        <TextField
          size="small"
          placeholder="Search titles..."
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
            minWidth: 280,
            "& .MuiInputBase-root": { fontSize: 13, borderRadius: "8px", background: t.cream },
            "& .MuiOutlinedInput-notchedOutline": { borderColor: t.cream3 },
            "& .Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: t.copper },
          }}
        />
        <FormControlLabel
          control={<Switch size="small" checked={unmappedOnly} onChange={(e) => setUnmappedOnly(e.target.checked)} />}
          label={<Typography sx={{ fontSize: 13, color: t.ink2 }}>Unmapped only</Typography>}
        />
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh from Fireflies">
          <span>
            <IconButton size="small" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <CircularProgress size={16} /> : <Refresh sx={{ fontSize: 18 }} />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {writeError && (
        <Typography sx={{ fontSize: 12, color: t.red, mb: 1.5 }}>{writeError}</Typography>
      )}

      {/* Column header */}
      <Box sx={{ display: { xs: "none", md: "grid" }, gridTemplateColumns: "1fr 70px 200px 1.4fr", gap: 2, px: 2, pb: 1 }}>
        {["Fireflies title", "Recs", "Date range", "Mapped to"].map((h) => (
          <Typography key={h} sx={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: t.ink3 }}>
            {h}
          </Typography>
        ))}
      </Box>
      <Divider />

      {/* Rows */}
      {rows.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: t.ink3, fontStyle: "italic", py: 4, textAlign: "center" }}>
          {isFetching ? "Loading recordings…" : unmappedOnly ? "No unmapped titles 🎉" : "No Fireflies recordings found."}
        </Typography>
      ) : (
        rows.map((g) => {
          const mapped = agendasByTitleLc[g.title.toLowerCase().trim()] || [];
          return (
            <Box
              key={g.title}
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "1fr 70px 200px 1.4fr" },
                gap: 2,
                alignItems: "center",
                px: 2,
                py: 1.5,
                borderBottom: `1px solid ${t.cream2}`,
                "&:hover": { background: t.copperFaint },
              }}
            >
              {/* Title (click → preview latest recording) */}
              <Box
                onClick={() => g.latestId && setSelectedId(g.latestId)}
                sx={{ cursor: g.latestId ? "pointer" : "default", minWidth: 0 }}
              >
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: t.ink, "&:hover": { color: g.latestId ? t.copper : t.ink } }}>
                  {g.title}
                </Typography>
              </Box>

              <Typography sx={{ fontSize: 12, color: t.ink3 }}>{g.count}</Typography>
              <Typography sx={{ fontSize: 12, color: t.ink3 }}>{fmtRange(g.earliest, g.latest)}</Typography>

              {/* Mapped-to chips + map control */}
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center" }}>
                {mapped.map((m) => (
                  <Chip
                    key={m.agendaId + m.storedTitle}
                    size="small"
                    label={m.agendaTitle}
                    onDelete={() => unmapTitle(m.agendaId, m.storedTitle)}
                    sx={{
                      height: 22,
                      fontSize: 11,
                      background: t.copperFaint,
                      color: t.copper,
                      "& .MuiChip-deleteIcon": { fontSize: 14, color: t.copper },
                    }}
                  />
                ))}
                {mapped.length === 0 && mappingTitle !== g.title && (
                  <Typography sx={{ fontSize: 11, color: t.ink3, fontStyle: "italic", mr: 0.5 }}>unmapped</Typography>
                )}
                {mappingTitle === g.title ? (
                  <Autocomplete
                    size="small"
                    options={agendaOptions}
                    autoHighlight
                    openOnFocus
                    sx={{ minWidth: 220 }}
                    onChange={(_e, opt) => { if (opt) mapTitle(opt.id, g.title); }}
                    onBlur={() => setMappingTitle(null)}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        autoFocus
                        placeholder="Map to agenda…"
                        variant="standard"
                        sx={{ "& .MuiInputBase-root": { fontSize: 12 } }}
                      />
                    )}
                  />
                ) : (
                  <Button
                    size="small"
                    startIcon={<Add sx={{ fontSize: 14 }} />}
                    onClick={() => setMappingTitle(g.title)}
                    sx={{ fontSize: 11, color: t.copper, textTransform: "none", minWidth: 0, px: 0.75 }}
                  >
                    Map
                  </Button>
                )}
              </Box>
            </Box>
          );
        })
      )}

      {/* Load more */}
      {listData?.transcripts?.length >= limit && (
        <Box sx={{ textAlign: "center", mt: 2 }}>
          <Button
            size="small"
            onClick={() => setLimit((l) => l + PAGE_SIZE)}
            disabled={isFetching}
            sx={{ fontSize: 12, color: t.ink2, textTransform: "none" }}
          >
            {isFetching ? "Loading…" : `Load older recordings (+${PAGE_SIZE})`}
          </Button>
        </Box>
      )}

      {selectedId && (
        <MeetingDetailModal transcriptId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </Box>
  );
}
