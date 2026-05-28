// V2.2.2e — Topic categoryIds + tagIds editor.
//
// Opens from the AgendaTopicCard ⋮ Edit menu. Multi-select chips for both
// categories and tags drive the embedded MiniProjectBoard's filter: an
// item lands in the topic if its categoryId is in topic.categoryIds OR if
// any of its tagIds intersects topic.tagIds (matches reference doc §4.3
// "Filter coupling" + §4.4 "Filtered by Category_Ids OR Tag_Ids").

import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { db } from "../firebase.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const ROW_LABEL_SX = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: "#6b6b8a",
  mb: 0.8,
};

export default function TopicEditDialog({ topic, agendaId, categories, tags, onClose }) {
  const { user } = useAuth();
  const [selectedCats, setSelectedCats] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [saving, setSaving] = useState(false);

  // Re-seed from topic on open + on topic reference change.
  useEffect(() => {
    setSelectedCats(topic?.categoryIds || []);
    setSelectedTags(topic?.tagIds || []);
  }, [topic?.id, topic?.categoryIds, topic?.tagIds]);

  const toggle = (set, setter, id) => {
    if (set.includes(id)) setter(set.filter((x) => x !== id));
    else setter([...set, id]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "agendas", agendaId, "topics", topic.id), {
        categoryIds: selectedCats,
        tagIds: selectedTags,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const sortedCats = [...(categories || [])].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const sortedTags = [...(tags || [])].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Edit "{topic?.name || "Untitled"}"
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: 12 }}>
          Items appear in this topic's project board when they match a selected category OR tag.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 1 }}>
          <Typography sx={ROW_LABEL_SX}>Categories</Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.7, mb: 2.5 }}>
            {sortedCats.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                No categories defined yet. Create them on the Task Board.
              </Typography>
            )}
            {sortedCats.map((c) => {
              const active = selectedCats.includes(c.id);
              return (
                <Chip
                  key={c.id}
                  label={c.name}
                  size="small"
                  onClick={() => toggle(selectedCats, setSelectedCats, c.id)}
                  sx={{
                    bgcolor: active ? c.color || "#b87333" : "#f5f3ee",
                    color: active ? "#fff" : "#3d3d5c",
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    "&:hover": { opacity: 0.85 },
                  }}
                />
              );
            })}
          </Box>

          <Typography sx={ROW_LABEL_SX}>Tags</Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.7 }}>
            {sortedTags.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                No tags defined yet. Create them on the Task Board.
              </Typography>
            )}
            {sortedTags.map((tg) => {
              const active = selectedTags.includes(tg.id);
              return (
                <Chip
                  key={tg.id}
                  label={tg.name}
                  size="small"
                  variant={active ? "filled" : "outlined"}
                  onClick={() => toggle(selectedTags, setSelectedTags, tg.id)}
                  sx={{
                    bgcolor: active ? tg.color || "#5e35b1" : "transparent",
                    color: active ? "#fff" : "#3d3d5c",
                    borderColor: tg.color || "#cfcfcf",
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    "&:hover": { opacity: 0.85 },
                  }}
                />
              );
            })}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
