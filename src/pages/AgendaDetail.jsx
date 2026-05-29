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
  ExpandMore,
  MoreVert,
  PersonAdd,
  Schedule as ScheduleIcon,
} from "@mui/icons-material";

import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";

import CancelMeetingDialog from "../components/CancelMeetingDialog.jsx";
import ManageGuestsDialog from "../components/ManageGuestsDialog.jsx";
import MemberAvatar from "../components/MemberAvatar.jsx";
import MiniProjectBoard from "../components/MiniProjectBoard.jsx";
import OrgAssignDialog from "../components/OrgAssignDialog.jsx";
import RescheduleDialog from "../components/RescheduleDialog.jsx";
import ScheduleCreateDialog from "../components/ScheduleCreateDialog.jsx";
import SendInviteDialog from "../components/SendInviteDialog.jsx";
import TopicEditDialog from "../components/TopicEditDialog.jsx";
import { useItems } from "../hooks/useItems.js";
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
import { sendMeetingPrep, sendScheduleEmail } from "../lib/meetingsApi.js";

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

function AgendaHero({ agenda, agendaId, calendarSeries, orgs, viewMode, setViewMode }) {
  const { user } = useAuth();
  const [titleDraft, setTitleDraft] = useState(agenda?.title || "");
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [scheduleCreateOpen, setScheduleCreateOpen] = useState(false);

  // Build a "meeting" object in the same shape RescheduleDialog expects
  // (originally consumed the Calendar popover's API rows). The dialog reads
  // event_id / series_id / m365EventId / date / end_date / type / org_id and
  // (V2.1.1) dual-writes the new meetingDatetime to the agenda doc after the
  // API succeeds — `agenda` prop passes through for the Firestore write.
  const rescheduleMeeting = useMemo(() => {
    if (!agenda) return null;
    const dt = agenda.meetingDatetime?.toDate ? agenda.meetingDatetime.toDate() : null;
    const endDt = dt && agenda.durationMinutes
      ? new Date(dt.getTime() + agenda.durationMinutes * 60000)
      : null;
    return {
      event_id: agenda.googleEventId || null,
      series_id: calendarSeries?.googleSeriesEventId || null,
      m365EventId: agenda.graphEventId || calendarSeries?.graphEventId || null,
      iCalUID: agenda.iCalUID || null,
      date: dt ? dt.toISOString() : null,
      end_date: endDt ? endDt.toISOString() : null,
      type: calendarSeries?.recurrence ? "recurring" : "single",
      title: agenda.title || calendarSeries?.title || "",
      teams_url: agenda.teamsUrl || calendarSeries?.teamsUrl || null,
      attendees: agenda.attendees || [],
      org_id: agenda.organizationId || calendarSeries?.organizationId || "unspecified",
    };
  }, [agenda, calendarSeries]);

  const canReschedule = !!(rescheduleMeeting?.m365EventId && rescheduleMeeting?.date);
  // Unbound agenda — no Graph binding yet — clicking the schedule row should
  // open the create flow instead of the reschedule flow.
  const canScheduleCreate = !canReschedule;

  useEffect(() => {
    setTitleDraft(agenda?.title || "");
  }, [agenda?.title]);

  // Read precedence: calendar_series (canonical for bound agendas) →
  // agenda doc (covers unbound agendas where the user assigned an org
  // before scheduling). The picker still writes to calendar_series for
  // bound agendas, but for unbound it writes to agenda (no series doc
  // exists yet — ScheduleCreateDialog mints it on first save).
  const seriesOrgId = calendarSeries?.organizationId || agenda?.organizationId || null;
  const seriesId = calendarSeries?.id || agenda?.calendarSeriesId || agendaId;
  const orgName = useMemo(() => {
    if (!seriesOrgId) return null;
    return (orgs || []).find((o) => o.id === seriesOrgId)?.name || seriesOrgId;
  }, [orgs, seriesOrgId]);
  const orgAccent = useMemo(() => {
    if (!seriesOrgId) return null;
    return (orgs || []).find((o) => o.id === seriesOrgId)?.accentColor || null;
  }, [orgs, seriesOrgId]);

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

      <Tooltip title={canReschedule ? "Click to reschedule" : canScheduleCreate ? "Click to schedule this meeting" : ""}>
        <Box
          onClick={
            canReschedule
              ? () => setRescheduleOpen(true)
              : canScheduleCreate
                ? () => setScheduleCreateOpen(true)
                : undefined
          }
          sx={{
            display: "inline-flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 1,
            mt: 1.5,
            mx: "auto",
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            color: t.ink3,
            cursor: canReschedule || canScheduleCreate ? "pointer" : "default",
            transition: "background 0.15s, border-color 0.15s",
            border: canScheduleCreate ? `1px dashed ${t.copper}` : "1px solid transparent",
            background: canScheduleCreate ? t.copperFaint : "transparent",
            "&:hover":
              canReschedule
                ? { background: t.cream2, borderColor: t.cream3 }
                : canScheduleCreate
                  ? { background: "rgba(184,115,51,0.15)", borderColor: t.copper }
                  : {},
          }}
        >
          <ScheduleIcon sx={{ fontSize: 16, color: canScheduleCreate ? t.copper : "inherit" }} />
          <Typography sx={{ fontSize: 14, color: canScheduleCreate ? t.copper : t.ink3, fontWeight: canScheduleCreate ? 600 : 400 }}>
            {meetingDt
              ? format(meetingDt, "EEEE, MMMM d 'at' h:mm a")
              : canScheduleCreate
                ? "Schedule this meeting"
                : "Date not set"}
          </Typography>
          {recurrenceLabel && (
            <Typography sx={{ fontSize: 12, color: t.ink3, opacity: 0.7, ml: 1 }}>
              · {recurrenceLabel}
            </Typography>
          )}
        </Box>
      </Tooltip>

      {/* Organization row — distinct from the attendee chips below. Label +
          chip layout so it's obvious what to click. Without an assigned org
          the embedded MiniProjectBoard renders nothing even when categories
          are set, so this control needs to be discoverable. */}
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 1, mt: 2 }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.ink3 }}>
          Organization
        </Typography>
        <Chip
          onClick={() => setOrgPickerOpen(true)}
          size="small"
          label={seriesOrgId ? orgName : "Unassigned — click to assign"}
          sx={{
            bgcolor: seriesOrgId ? (orgAccent || "primary.main") : "rgba(239,108,0,0.12)",
            color: seriesOrgId ? "#fff" : "#ef6c00",
            fontWeight: 600,
            fontSize: 12,
            height: 26,
            px: 0.5,
            cursor: "pointer",
            border: seriesOrgId ? "none" : "1.5px dashed #ef6c00",
            "&:hover": { opacity: 0.85, boxShadow: "0 2px 6px rgba(0,0,0,0.08)" },
          }}
        />
      </Box>

      {orgPickerOpen && seriesId && (
        <OrgAssignDialog
          seriesId={seriesId}
          currentOrgId={seriesOrgId}
          orgs={orgs}
          onClose={() => setOrgPickerOpen(false)}
        />
      )}

      {rescheduleOpen && rescheduleMeeting && (
        <RescheduleDialog
          meeting={rescheduleMeeting}
          agenda={{ id: agendaId, ...agenda }}
          onClose={() => setRescheduleOpen(false)}
          onSuccess={() => setRescheduleOpen(false)}
        />
      )}

      {scheduleCreateOpen && (
        <ScheduleCreateDialog
          agenda={agenda}
          agendaId={agendaId}
          calendarSeries={calendarSeries}
          orgs={orgs}
          onClose={() => setScheduleCreateOpen(false)}
        />
      )}
    </Box>
  );
}

// ─── Inline-editable bullet rows ───────────────────────────────────────
//
// Generic component shared by Talking Points (copper) and Topic Notes
// (blue). Caller passes the subcollection segment under the topic and the
// accent color; everything else is the same UX:
//   - inline-edit row
//   - Enter inserts a new blank row at sortOrder + 0.5 (returned via onAfterEnter)
//   - blur with empty trimmed value → deleteDoc
//   - hover reveals X icon for explicit delete
//
// `extraSx` is optional, used by Topic Notes to enable multi-line behavior.

function BulletRow({
  topicId,
  agendaId,
  point,
  subcollection,
  accent,
  multiline,
  onAfterEnter,
  autoFocus,
}) {
  const [value, setValue] = useState(point.text || "");
  const inputRef = useRef(null);
  useEffect(() => setValue(point.text || ""), [point.text]);
  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  const ref = doc(db, "agendas", agendaId, "topics", topicId, subcollection, point.id);
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
    // Multi-line bullets: Shift+Enter inserts a newline, plain Enter blurs +
    // inserts a new row below (Console pattern for Topic Notes).
    if (e.key === "Enter" && (!multiline || !e.shiftKey)) {
      e.preventDefault();
      e.currentTarget.blur();
      onAfterEnter?.(point.sortOrder);
    }
  };

  const inputComponent = multiline ? "textarea" : "input";
  const extraInputSx = multiline ? { resize: "none", minHeight: 18 } : {};

  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, py: 0.4, "&:hover .row-x": { opacity: 1 } }}>
      <Box sx={{ width: 5, height: 5, borderRadius: "50%", background: accent, flexShrink: 0, mt: "8px" }} />
      <Box
        component={inputComponent}
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder="…"
        rows={multiline ? 1 : undefined}
        sx={{ ...inputBase, fontSize: 13, py: "2px", color: t.ink, "&:focus": { borderBottomColor: accent }, ...extraInputSx }}
      />
      <IconButton
        size="small"
        className="row-x"
        onClick={() => deleteDoc(ref).catch(() => {})}
        sx={{ opacity: 0, transition: "opacity 0.15s", color: t.ink3, p: 0.3, mt: "1px" }}
        aria-label="Delete bullet"
      >
        <Close sx={{ fontSize: 14 }} />
      </IconButton>
    </Box>
  );
}

function AddBullet({ topicId, agendaId, lastSortOrder, subcollection, accent, placeholder, multiline }) {
  const { user } = useAuth();
  const [value, setValue] = useState("");
  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setValue("");
    await addDoc(collection(db, "agendas", agendaId, "topics", topicId, subcollection), {
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
      placeholder={placeholder || "+ Add a bullet…"}
      sx={{
        ...inputBase,
        fontSize: 12,
        py: "4px",
        color: t.ink3,
        borderBottom: "1px dashed transparent",
        "&:focus": { borderBottomColor: accent, color: t.ink },
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
          <BulletRow
            key={p.id}
            topicId={topic.id}
            agendaId={agendaId}
            point={p}
            subcollection="talkingPoints"
            accent={t.copper}
            onAfterEnter={insertAfter}
            autoFocus={focusOnNext === p.id}
          />
        ))}
        <AddBullet
          topicId={topic.id}
          agendaId={agendaId}
          lastSortOrder={lastSort}
          subcollection="talkingPoints"
          accent={t.copper}
          placeholder="+ Add a talking point…"
        />
      </Box>
    </Box>
  );
}

// ─── Topic Notes (Working view, blue accent) ───────────────────────────
//
// Same UX as Talking Points but blue. Lives in
// agendas/{agendaId}/topics/{topicId}/notes subcollection.

function TopicNotesSection({ topic, agendaId }) {
  const { user } = useAuth();
  const constraints = useMemo(() => [orderBy("sortOrder", "asc")], []);
  const { data: notesRaw } = useCollection(
    `agendas/${agendaId}/topics/${topic.id}/notes`,
    constraints
  );
  const notes = notesRaw || [];
  const lastSort = notes.length ? notes[notes.length - 1].sortOrder ?? 0 : 0;

  const [focusOnNext, setFocusOnNext] = useState(null);
  const insertAfter = async (currentSort) => {
    const newDoc = await addDoc(
      collection(db, "agendas", agendaId, "topics", topic.id, "notes"),
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
    <Box sx={{ mt: 2 }}>
      <Typography sx={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.blue, mb: 0.5 }}>
        Topic Notes
      </Typography>
      <Box sx={{ pl: 0.5 }}>
        {notes.map((n) => (
          <BulletRow
            key={n.id}
            topicId={topic.id}
            agendaId={agendaId}
            point={n}
            subcollection="notes"
            accent={t.blue}
            multiline
            onAfterEnter={insertAfter}
            autoFocus={focusOnNext === n.id}
          />
        ))}
        <AddBullet
          topicId={topic.id}
          agendaId={agendaId}
          lastSortOrder={lastSort}
          subcollection="notes"
          accent={t.blue}
          placeholder="+ Add a note…"
          multiline
        />
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

function ActionBar({ agenda, agendaId, calendarSeries, topics, openFloorItems }) {
  const { user } = useAuth();
  const teamsUrl = agenda?.teamsUrl || calendarSeries?.teamsUrl || null;
  const [sendMenuEl, setSendMenuEl] = useState(null);
  const [busy, setBusy] = useState(null); // null | "concluding" | "sending-prep"
  const [feedback, setFeedback] = useState(null); // { kind: 'success' | 'error', msg: string }
  const [sendInviteOpen, setSendInviteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const isConcluded = agenda?.status === "concluded";
  const isCancelled = agenda?.status === "cancelled";
  const isBound = !!(agenda?.graphEventId || calendarSeries?.graphSeriesEventId);

  // Diff between current attendees and lastSentAttendees drives the
  // "Send Meeting Invite" button's primary/secondary styling. Diff is
  // computed on visible attendees only — silent proxies are always equal
  // so they never trigger a phantom diff.
  //
  // Legacy agendas (reconciled in before V2.2.2b.4) have no
  // lastSentAttendees field. Treating undefined as [] would mark every
  // existing attendee as "to invite" and re-fan an .ics blast on first
  // click — explicitly against the staged-invite contract. Gate the diff
  // on lastSentAttendees being present; until the user makes the first
  // edit (which now seeds it via ScheduleCreate or the Send action), the
  // button stays cold.
  const inviteDiff = useMemo(() => {
    if (agenda?.lastSentAttendees === undefined) {
      return { added: 0, removed: 0, hasDiff: false, missingBaseline: true };
    }
    const cur = visibleAttendees(agenda?.attendees);
    const last = visibleAttendees(agenda?.lastSentAttendees);
    const lastSet = new Set(last.map((a) => a.email?.toLowerCase()));
    const curSet = new Set(cur.map((a) => a.email?.toLowerCase()));
    let added = 0, removed = 0;
    for (const e of curSet) if (!lastSet.has(e)) added += 1;
    for (const e of lastSet) if (!curSet.has(e)) removed += 1;
    return { added, removed, hasDiff: added + removed > 0, missingBaseline: false };
  }, [agenda?.attendees, agenda?.lastSentAttendees]);

  const handleConclude = async () => {
    if (isConcluded) return;
    if (!window.confirm("Conclude this agenda? Topics and notes stay visible but the agenda's status flips to read-only.")) return;
    setBusy("concluding");
    try {
      await updateDoc(doc(db, "agendas", agendaId), {
        status: "concluded",
        concludedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      });
      setFeedback({ kind: "success", msg: "Agenda concluded." });
    } catch (err) {
      setFeedback({ kind: "error", msg: err.message || "Conclude failed." });
    } finally {
      setBusy(null);
    }
  };

  const formattedDate = () => {
    const dt = agenda?.meetingDatetime?.toDate ? agenda.meetingDatetime.toDate() : null;
    return dt ? format(dt, "EEEE, MMMM d 'at' h:mm a") : "Date TBD";
  };

  const handleSendSchedule = async () => {
    setSendMenuEl(null);
    setBusy("sending-schedule");
    try {
      const result = await sendScheduleEmail({
        title: agenda?.title || "(untitled)",
        dateFormatted: formattedDate(),
        teamsUrl: teamsUrl || null,
        isReschedule: false,
        attendees: visibleAttendees(agenda?.attendees).map((a) => ({
          email: a.email,
          name: a.name || a.email,
        })),
      });
      setFeedback({
        kind: result?.failed > 0 ? "error" : "success",
        msg: `Schedule notification sent — ${result?.sent ?? 0} sent, ${result?.failed ?? 0} failed.`,
      });
    } catch (err) {
      setFeedback({ kind: "error", msg: err.message || "Send Schedule notification failed." });
    } finally {
      setBusy(null);
    }
  };

  const handleSendPrep = async () => {
    setSendMenuEl(null);
    setBusy("sending-prep");
    try {
      const dt = agenda?.meetingDatetime?.toDate
        ? agenda.meetingDatetime.toDate()
        : null;
      const result = await sendMeetingPrep({
        title: agenda?.title || "(untitled)",
        dateFormatted: dt ? format(dt, "EEEE, MMMM d 'at' h:mm a") : "Date TBD",
        topics: (topics || []).map((tp) => ({ Topic_Name: tp.name })),
        openFloor: (openFloorItems || []).map((it) => ({ Discussion_Item: it.text })),
        attendees: visibleAttendees(agenda?.attendees).map((a) => ({
          email: a.email,
          name: a.name || a.email,
          tasks: [],
        })),
        lastMeetingOverview: null,
      });
      setFeedback({
        kind: result?.failed > 0 ? "error" : "success",
        msg: `Meeting Prep emails sent — ${result?.sent ?? 0} sent, ${result?.failed ?? 0} failed.`,
      });
    } catch (err) {
      setFeedback({ kind: "error", msg: err.message || "Send Meeting Prep failed." });
    } finally {
      setBusy(null);
    }
  };

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

      <Tooltip
        title={
          !isBound
            ? "Schedule the meeting first — invites need a calendar event to attach to."
            : inviteDiff.missingBaseline
              ? "Legacy meeting — Graph already has the canonical attendee list. Edit guests via Manage Guests to start tracking changes."
              : inviteDiff.hasDiff
                ? `${inviteDiff.added} to invite, ${inviteDiff.removed} to cancel — click to send.`
                : "Attendees already match the last invite. Use Manage Guests to add or remove people."
        }
      >
        <span>
          <Box
            component="button"
            onClick={() => isBound && inviteDiff.hasDiff && setSendInviteOpen(true)}
            disabled={!isBound || !inviteDiff.hasDiff}
            sx={{
              px: 1.6,
              py: 0.8,
              borderRadius: 1,
              border: `1px solid ${inviteDiff.hasDiff && isBound ? t.copper : t.cream3}`,
              background: inviteDiff.hasDiff && isBound ? t.copper : "transparent",
              color: inviteDiff.hasDiff && isBound ? "#fff" : t.ink3,
              fontSize: 12,
              fontWeight: inviteDiff.hasDiff && isBound ? 600 : 500,
              cursor: inviteDiff.hasDiff && isBound ? "pointer" : "not-allowed",
              transition: "background 0.15s, border-color 0.15s",
              "&:hover": inviteDiff.hasDiff && isBound ? { background: "#a0612b", borderColor: "#a0612b" } : {},
            }}
          >
            Send Meeting Invite
            {inviteDiff.hasDiff && isBound && (
              <Box component="span" sx={{ ml: 0.6, fontSize: 10, opacity: 0.85 }}>
                ({inviteDiff.added + inviteDiff.removed})
              </Box>
            )}
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
        <MenuItem
          onClick={handleSendPrep}
          disabled={busy === "sending-prep"}
          sx={{ fontSize: 13 }}
        >
          {busy === "sending-prep" ? "Sending…" : "Meeting Prep email"}
        </MenuItem>
        <MenuItem
          onClick={handleSendSchedule}
          disabled={busy === "sending-schedule"}
          sx={{ fontSize: 13 }}
        >
          {busy === "sending-schedule" ? "Sending…" : "Schedule notification"}
        </MenuItem>
      </Menu>

      <Tooltip title={isCancelled ? "This meeting is cancelled." : "Cancel this meeting"}>
        <span>
          <Box
            component="button"
            onClick={() => setCancelOpen(true)}
            disabled={isCancelled || isConcluded}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              px: 1.6,
              py: 0.8,
              borderRadius: 1,
              border: `1px solid ${isCancelled || isConcluded ? "#cfcfcf" : "#c62828"}`,
              background: isCancelled ? "#f4f4f4" : "transparent",
              color: isCancelled || isConcluded ? "#9e9e9e" : "#c62828",
              fontSize: 12,
              fontWeight: 600,
              cursor: isCancelled || isConcluded ? "not-allowed" : "pointer",
              transition: "background 0.15s",
              "&:hover": isCancelled || isConcluded ? {} : { background: "rgba(198,40,40,0.08)" },
            }}
          >
            {isCancelled ? "Cancelled" : "Cancel meeting"}
          </Box>
        </span>
      </Tooltip>

      <Tooltip title={isConcluded ? "This agenda is concluded." : "Conclude this agenda"}>
        <span>
          <Box
            component="button"
            onClick={handleConclude}
            disabled={isConcluded || busy === "concluding"}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              px: 1.6,
              py: 0.8,
              borderRadius: 1,
              border: `1px solid ${isConcluded ? "#cfcfcf" : "#2e7d32"}`,
              background: isConcluded ? "#f4f4f4" : "transparent",
              color: isConcluded ? "#9e9e9e" : "#2e7d32",
              fontSize: 12,
              fontWeight: 600,
              cursor: isConcluded || busy === "concluding" ? "not-allowed" : "pointer",
              transition: "background 0.15s",
              "&:hover": isConcluded || busy === "concluding" ? {} : { background: "rgba(46,125,50,0.08)" },
            }}
          >
            <Check sx={{ fontSize: 14 }} />
            {busy === "concluding" ? "Concluding…" : isConcluded ? "Concluded" : "Conclude"}
          </Box>
        </span>
      </Tooltip>

      {feedback && (
        <Box
          onClick={() => setFeedback(null)}
          sx={{
            ml: 1,
            px: 1.2,
            py: 0.4,
            borderRadius: 0.8,
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
            background: feedback.kind === "success" ? "#e8f5e9" : "#ffebee",
            color: feedback.kind === "success" ? "#2e7d32" : "#c62828",
            maxWidth: 280,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {feedback.msg}
        </Box>
      )}

      {sendInviteOpen && (
        <SendInviteDialog
          agenda={agenda}
          agendaId={agendaId}
          calendarSeries={calendarSeries}
          onClose={() => setSendInviteOpen(false)}
        />
      )}

      {cancelOpen && (
        <CancelMeetingDialog
          agenda={agenda}
          agendaId={agendaId}
          calendarSeries={calendarSeries}
          onClose={() => setCancelOpen(false)}
        />
      )}
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

function MeetingFocusPanel({ counts, value, onChange }) {
  return (
    <Box sx={{ background: t.cream, borderRadius: 2, p: 2, mb: 2 }}>
      <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.copper, mb: 1 }}>
        Meeting Focus
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
        {FOCUS_KEYS.map(({ key, label, color }) => {
          const active = value === key;
          const count = counts?.[key] ?? 0;
          const isZero = count === 0;
          return (
            <Box
              key={key}
              onClick={isZero ? undefined : () => onChange(active ? null : key)}
              sx={{
                p: 1,
                borderRadius: 1,
                background: "white",
                border: active ? `2px solid ${color}` : "1px solid transparent",
                cursor: isZero ? "default" : "pointer",
                opacity: isZero ? 0.4 : active ? 1 : 0.85,
                transition: "border-color 0.15s, opacity 0.15s",
                "&:hover": isZero ? {} : { opacity: 1 },
              }}
            >
              <Typography sx={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1.1 }}>
                {isZero ? "—" : count}
              </Typography>
              <Typography sx={{ fontSize: 10, color: t.ink3, mt: 0.3, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function AttendeesPanel({ attendees, userByEmail, taskCounts, value, onChange, onManageGuests }) {
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
    const emailKey = a.email?.toLowerCase() || null;
    const active = value === emailKey;
    return (
      <Box
        key={a.email || i}
        onClick={() => onChange(active ? null : emailKey)}
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
        <Typography sx={{ fontSize: 10, color: t.ink3, ml: 0.5, fontWeight: 600 }}>
          {(taskCounts?.[a.email?.toLowerCase()] ?? 0) || "—"}
        </Typography>
      </Box>
    );
  };

  return (
    <Box sx={{ background: t.cream, borderRadius: 2, p: 2, mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.copper }}>
          Attendees
        </Typography>
        <Box
          component="button"
          onClick={onManageGuests}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.4,
            px: 0.8,
            py: 0.3,
            borderRadius: 1,
            border: `1px dashed ${t.cream3}`,
            background: "transparent",
            color: t.copper,
            fontSize: 10,
            fontWeight: 600,
            cursor: "pointer",
            transition: "background 0.15s, border-color 0.15s",
            "&:hover": { background: t.copperFaint, borderColor: t.copper },
          }}
        >
          <PersonAdd sx={{ fontSize: 12 }} /> Manage
        </Box>
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

// ─── Working view — Topic KPI scorecard strip (§4.3 item 1) ────────────
//
// 7-cell horizontal strip — Assigned · In Progress · Review · On Hold ·
// Done · Overdue · Due This Wk. Each cell clickable to filter the
// embedded MiniProjectBoard's items. Counts wire to real item data when
// V2.2.2e ports the MiniProjectBoard; until then every cell is "—" and
// non-clickable (opacity 0.4).

const KPI_CELLS = [
  { key: "assigned", label: "Assigned", color: "#376fd0" },
  { key: "inProgress", label: "In Progress", color: "#b87333" },
  { key: "review", label: "Review", color: "#9c6ade" },
  { key: "onHold", label: "On Hold", color: "#c62828" },
  { key: "done", label: "Done", color: "#2e7d32" },
  { key: "overdue", label: "Overdue", color: "#c62828" },
  { key: "dueThisWeek", label: "Due This Wk", color: "#ef6c00" },
];

function TopicKpiStrip({ counts, value, onChange }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: 0.5,
        py: 1,
        mb: 1.5,
        borderBottom: `1px solid ${t.cream2}`,
      }}
    >
      {KPI_CELLS.map(({ key, label, color }) => {
        const active = value === key;
        const count = counts?.[key] ?? 0;
        const isZero = count === 0;
        return (
          <Box
            key={key}
            onClick={isZero ? undefined : () => onChange(active ? null : key)}
            sx={{
              textAlign: "center",
              py: 0.5,
              px: 0.5,
              borderRadius: 0.5,
              borderBottom: active ? `2px solid ${color}` : "2px solid transparent",
              background: active ? t.copperFaint : "transparent",
              cursor: isZero ? "default" : "pointer",
              opacity: isZero ? 0.4 : 1,
              transition: "background 0.15s",
            }}
          >
            <Typography sx={{ fontSize: 16, fontWeight: 700, color, lineHeight: 1.1 }}>
              {isZero ? "—" : count}
            </Typography>
            <Typography sx={{ fontSize: 8.5, color: t.ink3, mt: 0.2, textTransform: "uppercase", letterSpacing: 0.6 }}>
              {label}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── MiniProjectBoard placeholder ──────────────────────────────────────

function MiniProjectBoardPlaceholder() {
  return (
    <Box
      sx={{
        py: 3,
        my: 1,
        border: `1px dashed ${t.cream3}`,
        borderRadius: 1,
        textAlign: "center",
        color: t.ink3,
      }}
    >
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: t.ink2, mb: 0.3 }}>
        Project Board ships in V2.2.2e
      </Typography>
      <Typography sx={{ fontSize: 10.5 }}>
        Active · Completed · Archive groups, reused from the main Task Board surface
      </Typography>
    </Box>
  );
}

// ─── AgendaTopicCard (§4.3) ────────────────────────────────────────────

function AgendaTopicCard({
  topic,
  agendaId,
  organizationId,
  items,
  users,
  userByEmail,
  categories,
  tags,
  focusFilter,
  attendeeFilter,
  onOpenComments,
  onOpenFiles,
  getCommentCount,
  getFileCount,
}) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  // V2.2.2e.2: when a sidebar filter (Meeting Focus or Attendees) is active,
  // overrides `expanded` based on whether this card has matching items.
  // Null = no override (user's manual choice wins).
  const [filterOverride, setFilterOverride] = useState(null);
  const [menuEl, setMenuEl] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(topic.name || "");
  // Per-topic KPI filter — drives Mini Project Board row filtering. Separate
  // from page-level meetingFocusFilter (the sidebar's Meeting Focus panel).
  const [topicKpiFilter, setTopicKpiFilter] = useState(null);

  // Compute the matched items for this topic so the KPI strip + the
  // MiniProjectBoard render off the same filter. Must match the org filter
  // used in MiniProjectBoard (same shape) so the counts and the visible
  // rows can't diverge.
  const matchedItems = useMemo(() => {
    if (!organizationId) return [];
    const cats = topic.categoryIds || [];
    const tgs = topic.tagIds || [];
    if (cats.length === 0 && tgs.length === 0) return [];
    const catSet = new Set(cats);
    const tagSet = new Set(tgs);
    return (items || []).filter((it) => {
      if (it.organizationId !== organizationId) return false;
      if (it.parentId) return false;
      if (it.categoryId && catSet.has(it.categoryId)) return true;
      if (Array.isArray(it.tagIds) && it.tagIds.some((t) => tagSet.has(t))) return true;
      return false;
    });
  }, [items, organizationId, topic.categoryIds, topic.tagIds]);

  // V2.2.2e.2 filter coupling. Decide whether this card has any items that
  // match the active page-level filter (Meeting Focus from sidebar or
  // Attendees from sidebar). Used to auto-expand/collapse on filter change.
  const hasMatchingForFilter = useMemo(() => {
    if (!focusFilter && !attendeeFilter) return null;
    const now = new Date();
    let attendeeUid = null;
    if (attendeeFilter && userByEmail) {
      const u = userByEmail[attendeeFilter.toLowerCase?.() || ""];
      if (u) attendeeUid = u.id;
    }
    for (const it of matchedItems) {
      // attendeeFilter requires the item's assigneeIds to include the filter's uid.
      if (attendeeFilter && attendeeUid && !(Array.isArray(it.assigneeIds) && it.assigneeIds.includes(attendeeUid))) {
        continue;
      }
      if (!focusFilter) return true;
      if (focusFilter === "done" && it.statusId === 5) return true;
      if (focusFilter === "review" && it.statusId === 4) return true;
      if (focusFilter === "onHold" && it.onHold) return true;
      if (focusFilter === "overdue" || focusFilter === "dueThisWeek") {
        if (!it.dueDate || it.statusId === 5 || it.statusId === 7) continue;
        const dd = it.dueDate?.toDate ? it.dueDate.toDate() : new Date(it.dueDate);
        if (focusFilter === "overdue" && dd && dd < now) return true;
        if (focusFilter === "dueThisWeek" && dd && (dd - now) / 86400000 <= 7) return true;
      }
    }
    return false;
  }, [matchedItems, focusFilter, attendeeFilter, userByEmail]);

  useEffect(() => {
    if (focusFilter || attendeeFilter) {
      setFilterOverride(hasMatchingForFilter);
    } else {
      setFilterOverride(null);
    }
  }, [focusFilter, attendeeFilter, hasMatchingForFilter]);

  const effectiveExpanded = filterOverride !== null ? filterOverride : expanded;

  // Real KPI counts. "Due This Wk" matches the existing TaskBoard
  // Mon-Fri business-week logic loosely (within next 7 days).
  const kpiCounts = useMemo(() => {
    const now = new Date();
    const counts = { assigned: 0, inProgress: 0, review: 0, onHold: 0, done: 0, overdue: 0, dueThisWeek: 0 };
    for (const it of matchedItems) {
      if (it.onHold) counts.onHold += 1;
      if (it.statusId === 1) counts.assigned += 1;
      else if (it.statusId === 2) counts.inProgress += 1;
      else if (it.statusId === 4) counts.review += 1;
      else if (it.statusId === 5) counts.done += 1;
      if (it.dueDate && !(it.statusId === 5 || it.statusId === 7)) {
        const dd = it.dueDate?.toDate ? it.dueDate.toDate() : new Date(it.dueDate);
        if (dd && dd < now) counts.overdue += 1;
        else if (dd && (dd - now) / 86400000 <= 7) counts.dueThisWeek += 1;
      }
    }
    return counts;
  }, [matchedItems]);

  useEffect(() => setNameDraft(topic.name || ""), [topic.name]);

  const persistName = async () => {
    const trimmed = nameDraft.trim() || "New Topic";
    if (trimmed === topic.name) return;
    await updateDoc(doc(db, "agendas", agendaId, "topics", topic.id), {
      name: trimmed,
      updatedAt: serverTimestamp(),
      updatedByUid: user?.uid || null,
    });
  };

  const handleDelete = async () => {
    setMenuEl(null);
    if (!window.confirm(`Delete topic "${topic.name || "Untitled"}"? Talking points + notes go with it.`)) return;
    // For V2.2.2d we delete just the topic doc; orphaned talkingPoints/notes
    // subcollection docs become unreachable but don't violate rules. A
    // proper cascading delete via writeBatch lands when V2.2.2e ports
    // useItemMutations or when V2.2 enables a cancel-cascade Cloud Function.
    await deleteDoc(doc(db, "agendas", agendaId, "topics", topic.id)).catch(() => {});
  };

  // Talking points
  const tpConstraints = useMemo(() => [orderBy("sortOrder", "asc")], []);
  const { data: tpRaw } = useCollection(
    `agendas/${agendaId}/topics/${topic.id}/talkingPoints`,
    tpConstraints
  );
  const talkingPoints = tpRaw || [];
  const lastTpSort = talkingPoints.length ? talkingPoints[talkingPoints.length - 1].sortOrder ?? 0 : 0;
  const [focusOnNextTp, setFocusOnNextTp] = useState(null);
  const insertTpAfter = async (currentSort) => {
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
    setFocusOnNextTp(newDoc.id);
  };

  return (
    <Box
      sx={{
        background: "white",
        borderRadius: 1.5,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        borderLeft: `4px solid ${t.copper}`,
        mb: 2,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 1.2,
          borderBottom: effectiveExpanded ? `1px solid ${t.cream2}` : "none",
          cursor: "pointer",
        }}
        onClick={() => {
          setExpanded((v) => !v);
          setFilterOverride(null);
        }}
      >
        <ExpandMore
          sx={{
            fontSize: 20,
            color: t.ink3,
            transition: "transform 0.15s",
            transform: effectiveExpanded ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        />
        <Box
          component="input"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={persistName}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          placeholder="New Topic"
          sx={{
            ...inputBase,
            fontFamily: t.serif,
            fontSize: 18,
            fontWeight: 500,
            color: t.ink,
            py: "2px",
            flex: 1,
          }}
        />
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            setMenuEl(e.currentTarget);
          }}
          sx={{ color: t.ink3 }}
          aria-label="Topic menu"
        >
          <MoreVert sx={{ fontSize: 18 }} />
        </IconButton>
        <Menu
          anchorEl={menuEl}
          open={Boolean(menuEl)}
          onClose={() => setMenuEl(null)}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem
            onClick={() => {
              setMenuEl(null);
              setEditOpen(true);
            }}
            sx={{ fontSize: 13 }}
          >
            Edit categories &amp; tags
          </MenuItem>
          <MenuItem onClick={handleDelete} sx={{ fontSize: 13, color: "#c62828" }}>
            Delete topic
          </MenuItem>
        </Menu>
      </Box>

      {effectiveExpanded && (
        <Box sx={{ p: 1.8 }}>
          <TopicKpiStrip
            counts={kpiCounts}
            value={topicKpiFilter}
            onChange={setTopicKpiFilter}
          />

          {/* Talking Points */}
          <Box sx={{ mb: 2 }}>
            <Typography sx={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: t.copper, mb: 0.5 }}>
              Talking Points
            </Typography>
            <Box sx={{ pl: 0.5 }}>
              {talkingPoints.map((p) => (
                <BulletRow
                  key={p.id}
                  topicId={topic.id}
                  agendaId={agendaId}
                  point={p}
                  subcollection="talkingPoints"
                  accent={t.copper}
                  onAfterEnter={insertTpAfter}
                  autoFocus={focusOnNextTp === p.id}
                />
              ))}
              <AddBullet
                topicId={topic.id}
                agendaId={agendaId}
                lastSortOrder={lastTpSort}
                subcollection="talkingPoints"
                accent={t.copper}
                placeholder="+ Add a talking point…"
              />
            </Box>
          </Box>

          <MiniProjectBoard
            topic={topic}
            agendaId={agendaId}
            organizationId={organizationId}
            items={items}
            users={users}
            categories={categories}
            tags={tags}
            onOpenComments={onOpenComments}
            onOpenFiles={onOpenFiles}
            getCommentCount={getCommentCount}
            getFileCount={getFileCount}
          />

          <TopicNotesSection topic={topic} agendaId={agendaId} />
        </Box>
      )}

      {editOpen && (
        <TopicEditDialog
          topic={topic}
          agendaId={agendaId}
          categories={categories}
          tags={tags}
          onClose={() => setEditOpen(false)}
        />
      )}
    </Box>
  );
}

// (ManageGuestsDialog opens from AttendeesPanel's "Manage" button; rendered
// from the top-level AgendaDetail component so it has access to the agenda
// + calendarSeries + users data hooks without prop drilling.)

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
  const [manageGuestsOpen, setManageGuestsOpen] = useState(false);

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

  // Looking up users by email for sidebar avatar coloring + orgs for the
  // hero's org badge + assignment picker.
  const { data: users } = useCollection("users");
  const { data: orgs } = useCollection("organizations");
  const userByEmail = useMemo(() => {
    const m = {};
    for (const u of users || []) {
      if (u.email) m[u.email.toLowerCase()] = u;
    }
    return m;
  }, [users]);

  // V2.2.2b: agenda-level openFloor subscription so the ActionBar's Meeting
  // Prep send can include the current discussion items in the payload.
  // OpenFloorSection still owns its own writes — this read just mirrors so
  // the parent has access for the Send menu.
  const openFloorConstraints = useMemo(() => [orderBy("sortOrder", "asc")], []);
  const { data: openFloorItems } = useCollection(
    agendaId ? `agendas/${agendaId}/openFloor` : null,
    openFloorConstraints
  );

  // V2.2.2e: data sources for the embedded MiniProjectBoard. Items,
  // categories, tags are read once at this level and threaded down to every
  // topic card; each card filters them locally by its categoryIds + tagIds.
  // V1 already wires the items collection for the main Task Board.
  const { data: allItems } = useItems();
  const { data: categories } = useCollection("categories");
  const { data: tags } = useCollection("tags");
  // organizationId for "+ New Item" — read from the calendar_series doc since
  // that's where reconciliation stamps the resolved Management slug.
  const organizationId = calendarSeries?.organizationId || agenda?.organizationId || null;

  // V2.2.2e.2: aggregate matched items across every topic's category/tag
  // filter, deduplicated. Drives the sidebar Meeting Focus + Attendees
  // counts that were placeholder dashes through V2.2.2e.
  const allMatchedItems = useMemo(() => {
    if (!organizationId || !allItems || !topics) return [];
    const orgScoped = allItems.filter(
      (it) => it.organizationId === organizationId && !it.parentId
    );
    const seen = new Set();
    const out = [];
    for (const topic of topics) {
      const catSet = new Set(topic.categoryIds || []);
      const tagSet = new Set(topic.tagIds || []);
      if (catSet.size === 0 && tagSet.size === 0) continue;
      for (const it of orgScoped) {
        if (seen.has(it.id)) continue;
        const matchCat = it.categoryId && catSet.has(it.categoryId);
        const matchTag = Array.isArray(it.tagIds) && it.tagIds.some((t) => tagSet.has(t));
        if (matchCat || matchTag) {
          seen.add(it.id);
          out.push(it);
        }
      }
    }
    return out;
  }, [allItems, organizationId, topics]);

  // Meeting Focus sidebar counts. "Due This Wk" approximates with a
  // 7-day-from-now window; full Mon-Fri parity ships when we centralize
  // the helper.
  const meetingFocusCounts = useMemo(() => {
    const now = new Date();
    const counts = { done: 0, review: 0, onHold: 0, overdue: 0, dueThisWeek: 0 };
    for (const it of allMatchedItems) {
      if (it.onHold) counts.onHold += 1;
      if (it.statusId === 5) counts.done += 1;
      if (it.statusId === 4) counts.review += 1;
      if (it.dueDate && it.statusId !== 5 && it.statusId !== 7) {
        const dd = it.dueDate?.toDate ? it.dueDate.toDate() : new Date(it.dueDate);
        if (dd && dd < now) counts.overdue += 1;
        else if (dd && (dd - now) / 86400000 <= 7) counts.dueThisWeek += 1;
      }
    }
    return counts;
  }, [allMatchedItems]);

  // Per-attendee task counts. Resolves attendee.email → user.uid → matched
  // items where uid ∈ assigneeIds. Unresolved emails (external attendees not
  // in the users collection) get 0.
  const attendeeTaskCounts = useMemo(() => {
    const out = {};
    for (const a of visibleAttendees(agenda?.attendees)) {
      const key = a.email?.toLowerCase();
      if (!key) continue;
      const userRecord = userByEmail[key];
      if (!userRecord) {
        out[key] = 0;
        continue;
      }
      let n = 0;
      for (const it of allMatchedItems) {
        if (Array.isArray(it.assigneeIds) && it.assigneeIds.includes(userRecord.id)) n += 1;
      }
      out[key] = n;
    }
    return out;
  }, [allMatchedItems, agenda?.attendees, userByEmail]);

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

  // Drag-reorder topics. Uses simple numeric midpoint sort orders to match
  // the existing Enter-insert +0.5 pattern from V2.2.1. The Firestore
  // subscription re-orders the list after the write lands.
  const handleTopicDragEnd = async (result) => {
    if (!result?.destination) return;
    const srcIdx = result.source.index;
    const dstIdx = result.destination.index;
    if (srcIdx === dstIdx || !topics) return;
    const moved = topics[srcIdx];
    if (!moved) return;
    const reordered = [...topics];
    reordered.splice(srcIdx, 1);
    reordered.splice(dstIdx, 0, moved);
    const prev = reordered[dstIdx - 1]?.sortOrder;
    const next = reordered[dstIdx + 1]?.sortOrder;
    let newSort;
    if (prev == null && next == null) newSort = 1;
    else if (prev == null) newSort = next - 1;
    else if (next == null) newSort = prev + 1;
    else newSort = (prev + next) / 2;
    await updateDoc(doc(db, "agendas", agendaId, "topics", moved.id), {
      sortOrder: newSort,
      updatedAt: serverTimestamp(),
      updatedByUid: user?.uid || null,
    });
  };

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
        orgs={orgs}
        viewMode={viewMode}
        setViewMode={setViewMode}
      />

      {viewMode === "overview" ? (
        <Box sx={{ px: 4 }}>
          <AttendeeChipStrip attendees={agenda.attendees} />
          <DragDropContext onDragEnd={handleTopicDragEnd}>
            <Droppable droppableId="overview-topics">
              {(droppableProvided) => (
                <Box ref={droppableProvided.innerRef} {...droppableProvided.droppableProps}>
                  {(topics || []).map((topic, idx) => (
                    <Draggable key={topic.id} draggableId={topic.id} index={idx}>
                      {(dragProvided, snapshot) => (
                        <Box
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          {...dragProvided.dragHandleProps}
                          sx={{
                            background: snapshot.isDragging ? "rgba(184,115,51,0.04)" : "transparent",
                            borderRadius: 1,
                          }}
                        >
                          <OverviewTopic topic={topic} agendaId={agendaId} />
                        </Box>
                      )}
                    </Draggable>
                  ))}
                  {droppableProvided.placeholder}
                </Box>
              )}
            </Droppable>
          </DragDropContext>
          <AddTopicButton agendaId={agendaId} lastSortOrder={lastTopicSort} />
          <OpenFloorSection agendaId={agendaId} />
        </Box>
      ) : (
        <>
          <ActionBar
            agenda={agenda}
            agendaId={agendaId}
            calendarSeries={calendarSeries}
            topics={topics}
            openFloorItems={openFloorItems}
          />
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 320px" },
              gap: 4,
              px: 4,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <DragDropContext onDragEnd={handleTopicDragEnd}>
                <Droppable droppableId="working-topics">
                  {(droppableProvided) => (
                    <Box ref={droppableProvided.innerRef} {...droppableProvided.droppableProps}>
                      {(topics || []).map((topic, idx) => (
                        <Draggable key={topic.id} draggableId={topic.id} index={idx}>
                          {(dragProvided, snapshot) => (
                            <Box
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              sx={{
                                background: snapshot.isDragging ? "rgba(184,115,51,0.04)" : "transparent",
                                borderRadius: 1.5,
                              }}
                            >
                              <AgendaTopicCard
                                topic={topic}
                                agendaId={agendaId}
                                organizationId={organizationId}
                                items={allItems}
                                users={users}
                                userByEmail={userByEmail}
                                categories={categories}
                                tags={tags}
                                focusFilter={meetingFocusFilter}
                                attendeeFilter={attendeeFilter}
                              />
                            </Box>
                          )}
                        </Draggable>
                      ))}
                      {droppableProvided.placeholder}
                    </Box>
                  )}
                </Droppable>
              </DragDropContext>
              <Box sx={{ mt: 2 }}>
                <AddTopicButton agendaId={agendaId} lastSortOrder={lastTopicSort} />
              </Box>
              <OpenFloorSection agendaId={agendaId} />
            </Box>
            <Box>
              <MeetingFocusPanel
                counts={meetingFocusCounts}
                value={meetingFocusFilter}
                onChange={setMeetingFocusFilter}
              />
              <AttendeesPanel
                attendees={agenda.attendees}
                userByEmail={userByEmail}
                taskCounts={attendeeTaskCounts}
                value={attendeeFilter}
                onChange={setAttendeeFilter}
                onManageGuests={() => setManageGuestsOpen(true)}
              />
              <PreparedByPanel />
            </Box>
          </Box>
        </>
      )}

      {manageGuestsOpen && (
        <ManageGuestsDialog
          agenda={agenda}
          agendaId={agendaId}
          calendarSeries={calendarSeries}
          users={users}
          onClose={() => setManageGuestsOpen(false)}
        />
      )}
    </Box>
  );
}
