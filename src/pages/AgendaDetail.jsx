// V2.2.1 — Agenda detail page (Overview view first).
// V2.2.2c — Working view chrome: Action Bar + ContentGrid + Sidebar shells.
//
// Per docs/AGENDA_DETAIL_PAGE_REFERENCE.md §10 port order. Working view body
// (AgendaTopicCard with KPI strip + Mini Project Board) ships in V2.2.2d/e.
// V2.2.2c renders the layout shell + a fully wired Attendees sidebar + a
// placeholder Meeting Focus KPI grid + a working Join Meeting button.
//
// Data: useDoc("agendas/:agendaId") + useDoc("calendar_series/:seriesId")
// + useCollection("agendas/:agendaId/topics") + per-topic talkingPoints
// subscription + useCollection("agendas/:agendaId/openFloor"). All
// writes go straight to Firestore — no API/Graph mutation in this slice.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link as RouterLink } from "react-router-dom";
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  ArrowBack,
  ArrowDropDown,
  Check,
  Close,
  PersonAdd,
  Schedule as ScheduleIcon,
} from "@mui/icons-material";

import MemberAvatar from "../components/MemberAvatar.jsx";
import { format, parseISO } from "date-fns";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "../firebase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useCollection } from "../hooks/useCollection.js";
import { useDoc } from "../hooks/useDoc.js";
import { visibleAttendees } from "../lib/meetingHelpers.js";

// Design tokens (mirror of Calendar.jsx). V2.2.2 cleanup will hoist to a
// shared module.
const t = {
  ink: "#1a1a2e",
  ink2: "#3d3d5c",
  ink3: "#6b6b8a",
  cream: "#faf8f5",
  cream2: "#f0ede8",
  cream3: "#e8e4dd",
  copper: "#b87333",
  copperFaint: "rgba(184,115,51,0.08)",
  purple: "#5e35b1",
  blue: "#376fd0",
  serif: "'Playfair Display', Georgia, serif",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const inputBase = {
  border: "none",
  borderBottom: "1.5px solid transparent",
  outline: "none",
  background: "transparent",
  width: "100%",
  cursor: "text",
  fontFamily: "inherit",
  fontSize: "inherit",
  color: "inherit",
  transition: "border-color 0.12s",
  "&:focus": { borderBottomColor: t.copper },
};

// ─── Hero ──────────────────────────────────────────────────────────────

function ViewToggle({ value, onChange }) {
  const cell = (v, label) => (
    <Box
      onClick={() => onChange(v)}
      sx={{
        px: 2,
        py: 0.6,
        fontSize: 12,
        fontWeight: value === v ? 600 : 500,
        color: value === v ? t.ink : t.ink3,
        background: value === v ? "white" : "transparent",
        boxShadow: value === v ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
        borderRadius: 1.5,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {label}
    </Box>
  );
  return (
    <Box sx={{ display: "inline-flex", gap: 0.5, p: 0.5, background: t.cream3, borderRadius: 2 }}>
      {cell("working", "Working")}
      {cell("overview", "Overview")}
    </Box>
  );
}

function AgendaHero({ agenda, agendaId, calendarSeries, viewMode, setViewMode }) {
  const { user } = useAuth();
  const [titleDraft, setTitleDraft] = useState(agenda?.title || "");

  useEffect(() => {
    setTitleDraft(agenda?.title || "");
  }, [agenda?.title]);

  const persistTitle = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === agenda?.title) return;
    await updateDoc(doc(db, "agendas", agendaId), {
      title: trimmed,
      updatedAt: serverTimestamp(),
      updatedByUid: user?.uid || null,
    });
  };

  const meetingDt = agenda?.meetingDatetime?.toDate
    ? agenda.meetingDatetime.toDate()
    : null;
  const recurrenceLabel = calendarSeries?.recurrence
    ? calendarSeries.recurrence === "recurring"
      ? "Recurring meeting"
      : calendarSeries.recurrence
    : null;

  return (
    <Box sx={{ position: "relative", py: 5, px: 4, textAlign: "center" }}>
      <Box sx={{ position: "absolute", top: 24, right: 32 }}>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </Box>

      <TextField
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={persistTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        variant="standard"
        placeholder="Untitled Meeting"
        InputProps={{ disableUnderline: true, sx: { fontFamily: t.serif, fontSize: { xs: 24, sm: 28 }, fontWeight: 500, color: t.ink, textAlign: "center" } }}
        inputProps={{ style: { textAlign: "center" } }}
        sx={{ maxWidth: 720, mx: "auto", display: "block" }}
      />

      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 1, mt: 1.5, color: t.ink3 }}>
        <ScheduleIcon sx={{ fontSize: 16 }} />
        <Typography sx={{ fontSize: 14, color: t.ink3 }}>
          {meetingDt ? format(meetingDt, "EEEE, MMMM d 'at' h:mm a") : "Date not set"}
        </Typography>
        {recurrenceLabel && (
          <Typography sx={{ fontSize: 12, color: t.ink3, opacity: 0.7, ml: 1 }}>
            · {recurrenceLabel}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

// ─── Inline-editable bullet rows ───────────────────────────────────────

function TalkingPointRow({ topicId, agendaId, point, onAfterEnter, autoFocus }) {
  const [value, setValue] = useState(point.text || "");
  const inputRef = useRef(null);
  useEffect(() => {
    setValue(point.text || "");
  }, [point.text]);
  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  const ref = doc(db, "agendas", agendaId, "topics", topicId, "talkingPoints", point.id);
  const handleBlur = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      await deleteDoc(ref).catch(() => {});
      return;
    }
    if (trimmed === point.text) return;
    await updateDoc(ref, { text: trimmed, updatedAt: serverTimestamp() });
  };
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
      onAfterEnter?.(point.sortOrder);
    }
  };

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.4, "&:hover .row-x": { opacity: 1 } }}>
      <Box sx={{ width: 5, height: 5, borderRadius: "50%", background: t.copper, flexShrink: 0 }} />
      <Box
        component="input"
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder="…"
        sx={{ ...inputBase, fontSize: 13, py: "2px", color: t.ink }}
      />
      <IconButton
        size="small"
        className="row-x"
        onClick={() => deleteDoc(ref).catch(() => {})}
        sx={{ opacity: 0, transition: "opacity 0.15s", color: t.ink3, p: 0.3 }}
        aria-label="Delete bullet"
      >
        <Close sx={{ fontSize: 14 }} />
      </IconButton>
    </Box>
  );
}

function AddTalkingPoint({ topicId, agendaId, lastSortOrder }) {
  const { user } = useAuth();
  const [value, setValue] = useState("");
  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setValue("");
    await addDoc(collection(db, "agendas", agendaId, "topics", topicId, "talkingPoints"), {
      text: trimmed,
      sortOrder: (lastSortOrder ?? 0) + 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: user?.uid || null,
    });
  };
  return (
    <Box
      component="input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      }}
      placeholder="+ Add a talking point…"
      sx={{
        ...inputBase,
        fontSize: 12,
        py: "4px",
        color: t.ink3,
        borderBottom: "1px dashed transparent",
        "&:focus": { borderBottomColor: t.copper, color: t.ink },
        ml: 1.5,
      }}
    />
  );
}

// ─── Overview topic ────────────────────────────────────────────────────

function OverviewTopic({ topic, agendaId }) {
  const { user } = useAuth();
  const [name, setName] = useState(topic.name || "");
  const [focusOnNext, setFocusOnNext] = useState(null);

  useEffect(() => setName(topic.name || ""), [topic.name]);

  const persistName = async () => {
    const trimmed = name.trim() || "New Topic";
    if (trimmed === topic.name) return;
    await updateDoc(doc(db, "agendas", agendaId, "topics", topic.id), {
      name: trimmed,
      updatedAt: serverTimestamp(),
      updatedByUid: user?.uid || null,
    });
  };

  // Sort the talking points client-side.
  const constraints = useMemo(() => [orderBy("sortOrder", "asc")], []);
  const { data: pointsRaw } = useCollection(`agendas/${agendaId}/topics/${topic.id}/talkingPoints`, constraints);
  const points = pointsRaw || [];
  const lastSort = points.length ? points[points.length - 1].sortOrder ?? 0 : 0;

  // Enter-insert: when user hits Enter on a row, insert a new bullet with
  // sortOrder = current + 0.5 and focus it on next render.
  const insertAfter = async (currentSort) => {
    const newDoc = await addDoc(
      collection(db, "agendas", agendaId, "topics", topic.id, "talkingPoints"),
      {
        text: "",
        sortOrder: (currentSort ?? 0) + 0.5,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: user?.uid || null,
      }
    );
    setFocusOnNext(newDoc.id);
  };

  return (
    <Box sx={{ mb: 3 }}>
      <Box
        component="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={persistName}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        placeholder="New Topic"
        sx={{
          ...inputBase,
          fontFamily: t.serif,
          fontSize: 15,
          fontWeight: 700,
          color: t.ink,
          borderBottom: `1.5px solid ${t.copper}`,
          "&:focus": { borderBottomColor: t.copper },
          py: "2px",
          mb: 0.8,
        }}
      />
      <Box sx={{ pl: 1 }}>
        {points.map((p) => (
          <TalkingPointRow
            key={p.id}
            topicId={topic.id}
            agendaId={agendaId}
            point={p}
            onAfterEnter={insertAfter}
            autoFocus={focusOnNext === p.id}
          />
        ))}
        <AddTalkingPoint topicId={topic.id} agendaId={agendaId} lastSortOrder={lastSort} />
      </Box>
    </Box>
  );
}

// ─── Open Floor ────────────────────────────────────────────────────────

function OpenFloorRow({ agendaId, item }) {
  const [value, setValue] = useState(item.text || "");
  useEffect(() => setValue(item.text || ""), [item.text]);

  const ref = doc(db, "agendas", agendaId, "openFloor", item.id);
  const handleBlur = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      await deleteDoc(ref).catch(() => {});
      return;
    }
    if (trimmed === item.text) return;
    await updateDoc(ref, { text: trimmed, updatedAt: serverTimestamp() });
  };

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.4, "&:hover .row-x": { opacity: 1 } }}>
      <Box sx={{ width: 5, height: 5, borderRadius: "50%", background: t.copper, flexShrink: 0 }} />
      <Box
        component="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        placeholder="…"
        sx={{ ...inputBase, fontSize: 13, py: "2px", color: t.ink }}
      />
      <IconButton
        size="small"
        className="row-x"
        onClick={() => deleteDoc(ref).catch(() => {})}
        sx={{ opacity: 0, transition: "opacity 0.15s", color: t.ink3, p: 0.3 }}
        aria-label="Delete open-floor item"
      >
        <Close sx={{ fontSize: 14 }} />
      </IconButton>
    </Box>
  );
}

function OpenFloorSection({ agendaId }) {
  const { user } = useAuth();
  const constraints = useMemo(() => [orderBy("sortOrder", "asc")], []);
  const { data: items } = useCollection(`agendas/${agendaId}/openFloor`, constraints);
  const lastSort = items?.length ? items[items.length - 1].sortOrder ?? 0 : 0;

  const [draft, setDraft] = useState("");
  const submit = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setDraft("");
    await addDoc(collection(db, "agendas", agendaId, "openFloor"), {
      text: trimmed,
      sortOrder: lastSort + 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: user?.uid || null,
    });
  };

  return (
    <Box sx={{ mt: 4 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Box sx={{ width: 3, height: 16, borderRadius: 0.5, background: t.copper }} />
        <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.copper }}>
          Open Floor
        </Typography>
      </Box>
      <Box sx={{ pl: 1 }}>
        {(items || []).map((it) => (
          <OpenFloorRow key={it.id} agendaId={agendaId} item={it} />
        ))}
        <Box
          component="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="+ Add item"
          sx={{
            ...inputBase,
            fontSize: 12,
            py: "4px",
            color: t.ink3,
            borderBottom: "1px dashed transparent",
            "&:focus": { borderBottomColor: t.copper, color: t.ink },
            ml: 1.5,
          }}
        />
      </Box>
    </Box>
  );
}

// ─── Attendee chip strip (read-only in Overview) ───────────────────────

function AttendeeChipStrip({ attendees }) {
  const display = visibleAttendees(attendees);
  if (!display.length) {
    return <Typography sx={{ fontSize: 12, color: t.ink3, fontStyle: "italic", mb: 2 }}>No attendees yet.</Typography>;
  }
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.8, mb: 2 }}>
      {display.map((a, i) => (
        <Chip
          key={a.email || i}
          label={a.name || a.email}
          size="small"
          sx={{
            background: t.cream2,
            border: `1px solid ${t.cream3}`,
            fontSize: 11,
            color: t.ink2,
            "& .MuiChip-label": { px: 1.2 },
          }}
        />
      ))}
    </Box>
  );
}

// ─── Add Topic button ──────────────────────────────────────────────────

function AddTopicButton({ agendaId, lastSortOrder }) {
  const { user } = useAuth();
  const handleAdd = async () => {
    await addDoc(collection(db, "agendas", agendaId, "topics"), {
      name: "New Topic",
      sortOrder: (lastSortOrder ?? 0) + 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: user?.uid || null,
    });
  };
  return (
    <Box
      onClick={handleAdd}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        px: 2,
        py: 0.8,
        border: `1.5px dashed ${t.cream3}`,
        borderRadius: 1.5,
        cursor: "pointer",
        color: t.copper,
        fontSize: 12,
        fontWeight: 600,
        transition: "background 0.15s, border-color 0.15s",
        "&:hover": { background: t.copperFaint, borderColor: t.copper },
      }}
    >
      ＋ Add Topic
    </Box>
  );
}

// ─── Working view — Action Bar (§4.1) ──────────────────────────────────

function TeamsLogo({ size = 18 }) {
  return (
    <Box sx={{ width: size, height: size, borderRadius: "3px", background: "#5059C9", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <Typography sx={{ fontSize: size * 0.55, fontWeight: 700, color: "white", lineHeight: 1 }}>T</Typography>
    </Box>
  );
}

function ActionBar({ agenda, calendarSeries }) {
  const teamsUrl = agenda?.teamsUrl || calendarSeries?.teamsUrl || null;
  const [sendMenuEl, setSendMenuEl] = useState(null);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        py: 1.5,
        px: 4,
        borderTop: `1px solid ${t.cream3}`,
        borderBottom: `1px solid ${t.cream3}`,
        background: "white",
        mb: 2,
      }}
    >
      {teamsUrl && (
        <Box
          component="a"
          href={teamsUrl}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            py: 0.8,
            borderRadius: 1,
            border: `1px solid ${t.cream3}`,
            color: "#5059C9",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
            transition: "background 0.15s, border-color 0.15s",
            "&:hover": { background: "#f3f4fb", borderColor: "#5059C9" },
          }}
        >
          <TeamsLogo />
          Join Meeting
        </Box>
      )}

      <Box sx={{ flex: 1 }} />

      <Tooltip title="Send Meeting Invite — ships in V2.2.2b">
        <span>
          <Box
            component="button"
            disabled
            sx={{
              px: 1.6,
              py: 0.8,
              borderRadius: 1,
              border: `1px solid ${t.cream3}`,
              background: "transparent",
              color: t.ink3,
              fontSize: 12,
              fontWeight: 500,
              cursor: "not-allowed",
            }}
          >
            Send Meeting Invite
          </Box>
        </span>
      </Tooltip>

      <Box
        component="button"
        onClick={(e) => setSendMenuEl(e.currentTarget)}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.4,
          px: 1.6,
          py: 0.8,
          borderRadius: 1,
          border: `1px solid ${t.cream3}`,
          background: "transparent",
          color: t.ink2,
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
          transition: "background 0.15s, border-color 0.15s",
          "&:hover": { background: t.cream2, borderColor: t.ink3 },
        }}
      >
        Send <ArrowDropDown sx={{ fontSize: 16 }} />
      </Box>
      <Menu
        anchorEl={sendMenuEl}
        open={Boolean(sendMenuEl)}
        onClose={() => setSendMenuEl(null)}
        slotProps={{ paper: { sx: { mt: 0.5, minWidth: 220 } } }}
      >
        <MenuItem disabled sx={{ fontSize: 13 }}>Meeting Prep email · V2.2.2b</MenuItem>
        <MenuItem disabled sx={{ fontSize: 13 }}>Schedule notification · V2.2.2b</MenuItem>
      </Menu>

      <Tooltip title="Conclude — ships in V2.2.2b">
        <span>
          <Box
            component="button"
            disabled
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              px: 1.6,
              py: 0.8,
              borderRadius: 1,
              border: `1px solid ${t.cream3}`,
              background: "transparent",
              color: t.ink3,
              fontSize: 12,
              fontWeight: 500,
              cursor: "not-allowed",
            }}
          >
            <Check sx={{ fontSize: 14 }} /> Conclude
          </Box>
        </span>
      </Tooltip>
    </Box>
  );
}

// ─── Working view — Sidebar (§4.7-4.9) ─────────────────────────────────

const FOCUS_KEYS = [
  { key: "done", label: "Done", color: "#2e7d32" },
  { key: "review", label: "Review", color: "#9c6ade" },
  { key: "onHold", label: "On Hold", color: "#c62828" },
  { key: "overdue", label: "Overdue", color: "#c62828" },
];

function MeetingFocusPanel({ value, onChange }) {
  return (
    <Box sx={{ background: t.cream, borderRadius: 2, p: 2, mb: 2 }}>
      <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.copper, mb: 1 }}>
        Meeting Focus
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
        {FOCUS_KEYS.map(({ key, label, color }) => {
          const active = value === key;
          return (
            <Box
              key={key}
              onClick={() => onChange(active ? null : key)}
              sx={{
                p: 1,
                borderRadius: 1,
                background: "white",
                border: active ? `2px solid ${color}` : "1px solid transparent",
                cursor: "pointer",
                opacity: active ? 1 : 0.85,
                transition: "border-color 0.15s, opacity 0.15s",
                "&:hover": { opacity: 1 },
              }}
            >
              <Typography sx={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1.1 }}>—</Typography>
              <Typography sx={{ fontSize: 10, color: t.ink3, mt: 0.3, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</Typography>
            </Box>
          );
        })}
      </Box>
      <Typography sx={{ fontSize: 10, color: t.ink3, mt: 1.2, opacity: 0.7 }}>
        Counts populate when topic cards + Mini Project Board ship (V2.2.2d/e).
      </Typography>
    </Box>
  );
}

function AttendeesPanel({ attendees, userByEmail, value, onChange }) {
  const display = visibleAttendees(attendees);
  const [clients, vmTeam] = useMemo(() => {
    const c = [];
    const v = [];
    for (const a of display) {
      const isVm = (a.email || "").toLowerCase().endsWith("@vistamarconsulting.com");
      (isVm ? v : c).push(a);
    }
    const byName = (a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "");
    return [c.sort(byName), v.sort(byName)];
  }, [display]);

  const row = (a, i) => {
    const userRecord = a.email ? userByEmail[a.email.toLowerCase()] : null;
    const userForAvatar = userRecord || { displayName: a.name || a.email, email: a.email };
    const label = a.name || a.email;
    const active = value === label;
    return (
      <Box
        key={a.email || i}
        onClick={() => onChange(active ? null : label)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.6,
          borderRadius: 1,
          cursor: "pointer",
          background: active ? t.copperFaint : "transparent",
          border: active ? `1px solid ${t.copper}` : "1px solid transparent",
          transition: "background 0.15s, border-color 0.15s",
          "&:hover": { background: active ? t.copperFaint : t.cream2 },
        }}
      >
        <MemberAvatar user={userForAvatar} size={22} border={false} tooltip={false} />
        <Typography sx={{ flex: 1, fontSize: 12, fontWeight: active ? 600 : 500, color: t.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: 10, color: t.ink3, ml: 0.5 }}>—</Typography>
      </Box>
    );
  };

  return (
    <Box sx={{ background: t.cream, borderRadius: 2, p: 2, mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.copper }}>
          Attendees
        </Typography>
        <Tooltip title="Manage Guests — ships in V2.2.2b">
          <span>
            <Box
              component="button"
              disabled
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.4,
                px: 0.8,
                py: 0.3,
                borderRadius: 1,
                border: `1px dashed ${t.cream3}`,
                background: "transparent",
                color: t.ink3,
                fontSize: 10,
                fontWeight: 600,
                cursor: "not-allowed",
              }}
            >
              <PersonAdd sx={{ fontSize: 12 }} /> Manage
            </Box>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.3 }}>
        {clients.map(row)}
        {clients.length > 0 && vmTeam.length > 0 && (
          <Divider sx={{ my: 0.6, borderColor: t.cream3 }} />
        )}
        {vmTeam.map(row)}
      </Box>

      {display.length === 0 && (
        <Typography sx={{ fontSize: 11, color: t.ink3, fontStyle: "italic" }}>
          No attendees yet.
        </Typography>
      )}
    </Box>
  );
}

function PreparedByPanel() {
  return (
    <Box sx={{ background: t.cream, borderRadius: 2, p: 2 }}>
      <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.copper, mb: 0.5 }}>
        Prepared by
      </Typography>
      <Typography sx={{ fontSize: 13, fontWeight: 500, color: t.ink2 }}>Vistamar Consulting</Typography>
      <Typography sx={{ fontSize: 11, color: t.ink3 }}>{format(new Date(), "MMM d 'at' h:mm a")}</Typography>
    </Box>
  );
}

// ─── Working view — body placeholder for topic cards ───────────────────

function TopicCardsPlaceholder() {
  return (
    <Box
      sx={{
        py: 5,
        border: `1.5px dashed ${t.cream3}`,
        borderRadius: 2,
        textAlign: "center",
        color: t.ink3,
      }}
    >
      <Typography sx={{ fontFamily: t.serif, fontSize: 16, color: t.ink2, mb: 0.5 }}>
        Topic cards ship in V2.2.2d
      </Typography>
      <Typography sx={{ fontSize: 12 }}>
        Each card: header · KPI scorecards · Talking Points · Mini Project Board · Topic Notes
      </Typography>
      <Typography sx={{ fontSize: 11, mt: 1, opacity: 0.7 }}>
        Use Overview to edit topics + talking points — same data, same docs.
      </Typography>
    </Box>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────

export default function AgendaDetail() {
  const { agendaId } = useParams();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState("overview");
  // Working-view filters. Set from Meeting Focus / Attendees clicks; will
  // drive topic-card auto-expand + Mini Project Board row filtering once
  // those land. No-op for V2.2.2c — surfacing the state shape now so
  // V2.2.2d/e wire to the same context.
  const [meetingFocusFilter, setMeetingFocusFilter] = useState(null);
  const [attendeeFilter, setAttendeeFilter] = useState(null);

  const { data: agenda, loading: agendaLoading, error: agendaError } = useDoc(
    agendaId ? `agendas/${agendaId}` : null
  );
  const seriesPath = agenda?.calendarSeriesId ? `calendar_series/${agenda.calendarSeriesId}` : null;
  const { data: calendarSeries } = useDoc(seriesPath);

  const topicsConstraints = useMemo(() => [orderBy("sortOrder", "asc")], []);
  const { data: topics } = useCollection(
    agendaId ? `agendas/${agendaId}/topics` : null,
    topicsConstraints
  );

  // Looking up users by email for sidebar avatar coloring.
  const { data: users } = useCollection("users");
  const userByEmail = useMemo(() => {
    const m = {};
    for (const u of users || []) {
      if (u.email) m[u.email.toLowerCase()] = u;
    }
    return m;
  }, [users]);

  if (agendaLoading) {
    return (
      <Box sx={{ p: 6, textAlign: "center" }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (agendaError || !agenda) {
    return (
      <Box sx={{ p: 6, textAlign: "center" }}>
        <Typography sx={{ fontFamily: t.serif, fontSize: 18, color: t.ink, mb: 1 }}>
          Agenda not found
        </Typography>
        <Typography sx={{ fontSize: 13, color: t.ink3, mb: 2 }}>
          {agendaError?.message || `No agenda doc at agendas/${agendaId}`}
        </Typography>
        <Tooltip title="Back to Calendar">
          <IconButton onClick={() => navigate("/calendar")} aria-label="Back to Calendar">
            <ArrowBack />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  const lastTopicSort = topics?.length ? topics[topics.length - 1].sortOrder ?? 0 : 0;

  return (
    <Box sx={{ maxWidth: 1280, mx: "auto", pb: 8 }}>
      <Box sx={{ pt: 2, px: 4 }}>
        <Tooltip title="Back to Calendar">
          <IconButton
            component={RouterLink}
            to="/calendar"
            size="small"
            sx={{ color: t.ink3, ml: -1 }}
            aria-label="Back to Calendar"
          >
            <ArrowBack fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <AgendaHero
        agenda={agenda}
        agendaId={agendaId}
        calendarSeries={calendarSeries}
        viewMode={viewMode}
        setViewMode={setViewMode}
      />

      {viewMode === "overview" ? (
        <Box sx={{ px: 4 }}>
          <AttendeeChipStrip attendees={agenda.attendees} />
          {(topics || []).map((topic) => (
            <OverviewTopic key={topic.id} topic={topic} agendaId={agendaId} />
          ))}
          <AddTopicButton agendaId={agendaId} lastSortOrder={lastTopicSort} />
          <OpenFloorSection agendaId={agendaId} />
        </Box>
      ) : (
        <>
          <ActionBar agenda={agenda} calendarSeries={calendarSeries} />
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 320px" },
              gap: 4,
              px: 4,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <TopicCardsPlaceholder />
              <Box sx={{ mt: 3 }}>
                <AddTopicButton agendaId={agendaId} lastSortOrder={lastTopicSort} />
              </Box>
              <OpenFloorSection agendaId={agendaId} />
            </Box>
            <Box>
              <MeetingFocusPanel value={meetingFocusFilter} onChange={setMeetingFocusFilter} />
              <AttendeesPanel
                attendees={agenda.attendees}
                userByEmail={userByEmail}
                value={attendeeFilter}
                onChange={setAttendeeFilter}
              />
              <PreparedByPanel />
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
