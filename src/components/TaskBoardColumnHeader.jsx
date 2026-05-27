// Ported from _PM_Archive_From_Console_2026-05-12/src/pages/pages/TaskBoardColumnHeader.jsx
// Sortable + filterable column header cell. Opens a Popover with: search box,
// sort asc/desc, filter checkboxes (multi-select with select-all), per-row
// edit/delete icons (for Category/Tag columns), and "+ Add New" link.
//
// Translated from PascalCase callback names to camelCase. Drops the
// confirmation Dialog for delete (parent-owned now — pass `onDeleteItem`
// that handles its own confirmation if needed).

import { useState } from "react";
import {
  Box,
  Checkbox,
  Chip as MuiChip,
  Divider as MuiDivider,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Popover,
  TableCell,
  TextField as MuiTextField,
  Typography,
} from "@mui/material";
import {
  ArrowDownward as ArrowDownwardIcon,
  ArrowUpward as ArrowUpwardIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
} from "@mui/icons-material";

import { getPillBg, getTextColor } from "../theme/pillColors.js";

export default function TaskBoardColumnHeader({
  label,
  field,
  align,
  width,
  sortField,
  sortDirection,
  onSort,
  userSorted,
  filterValues,
  selectedFilters,
  onFilterChange,
  showAddNew,
  onAddNew,
  sortOnly,
  showSearch,
  onSearchChange,
  onEditItem,
  onDeleteItem,
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [searchText, setSearchText] = useState("");
  const open = Boolean(anchorEl);
  const isSorted = sortField === field;

  const handleOpen = (e) => {
    if (anchorEl) {
      setAnchorEl(null);
      setSearchText("");
    } else {
      setAnchorEl(e.currentTarget);
      setSearchText("");
    }
  };

  const handleClose = () => {
    setAnchorEl(null);
    setSearchText("");
    if (onSearchChange) onSearchChange("");
  };

  const handleSortAsc = () => onSort(field, "asc");
  const handleSortDesc = () => onSort(field, "desc");

  const handleToggleFilter = (value) => {
    const current = selectedFilters || [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFilterChange(field, next);
  };

  const handleSelectAll = () => {
    if (!filterValues) return;
    onFilterChange(field, filterValues.map((fv) => fv.value));
  };

  const handleDeselectAll = () => onFilterChange(field, []);

  const filteredValues = filterValues
    ? filterValues.filter((fv) =>
      fv.label.toLowerCase().includes(searchText.toLowerCase()))
    : [];

  const allSelected = filterValues
    && filterValues.length > 0
    && (selectedFilters || []).length === filterValues.length;

  return (
    <TableCell
      align={align}
      sx={{ width, whiteSpace: "nowrap", userSelect: "none" }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: align === "center" ? "center" : "flex-start",
          gap: 0.5,
          cursor: "pointer",
          "&:hover .col-header-text": { color: "primary.main" },
        }}
        onClick={handleOpen}
      >
        {userSorted && isSorted && (
          sortDirection === "asc"
            ? <ArrowUpwardIcon sx={{ fontSize: 14, color: "primary.main" }} />
            : <ArrowDownwardIcon sx={{ fontSize: 14, color: "primary.main" }} />
        )}
        <Typography
          variant="subtitle2"
          component="span"
          className="col-header-text"
          sx={{ fontWeight: 600 }}
        >
          {label}
        </Typography>
        <Typography component="span" sx={{ fontSize: "0.75rem", ml: 0.25 }}>&#9662;</Typography>

        <Popover
          open={open}
          anchorEl={anchorEl}
          onClose={handleClose}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
          onClick={(e) => e.stopPropagation()}
        >
          <Box sx={{ p: 1.5, minWidth: 200, maxHeight: 380, overflow: "auto" }}>
            {(showSearch || (!sortOnly && filterValues && filterValues.length > 0)) && (
              <MuiTextField
                size="small"
                placeholder="Search…"
                fullWidth
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  if (onSearchChange) onSearchChange(e.target.value);
                }}
                sx={{ mb: 1 }}
              />
            )}

            <MenuItem dense onClick={handleSortAsc}>
              <ListItemIcon sx={{ minWidth: 28 }}><ArrowUpwardIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Sort Ascending</ListItemText>
            </MenuItem>
            <MenuItem dense onClick={handleSortDesc}>
              <ListItemIcon sx={{ minWidth: 28 }}><ArrowDownwardIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Sort Descending</ListItemText>
            </MenuItem>

            {!sortOnly && filterValues && filterValues.length > 0 && (
              <>
                <MuiDivider sx={{ my: 1 }} />
                <MenuItem dense onClick={allSelected ? handleDeselectAll : handleSelectAll}>
                  <Typography variant="body2" color="primary" sx={{ fontWeight: 500 }}>
                    {allSelected ? "Deselect All" : "Select All"}
                  </Typography>
                </MenuItem>
                {filteredValues.map((fv) => {
                  const checked = (selectedFilters || []).includes(fv.value);
                  return (
                    <MenuItem
                      key={fv.value}
                      dense
                      onClick={() => handleToggleFilter(fv.value)}
                      sx={{ display: "flex", alignItems: "center" }}
                    >
                      <Checkbox size="small" checked={checked} sx={{ p: 0, mr: 1 }} />
                      <Box sx={{ flex: 1 }}>
                        {fv.color ? (
                          <MuiChip
                            label={fv.label}
                            size="small"
                            sx={{
                              backgroundColor: getPillBg(fv.color),
                              color: getTextColor(fv.color),
                              fontWeight: 600,
                              fontSize: "0.75rem",
                            }}
                          />
                        ) : <ListItemText>{fv.label}</ListItemText>}
                      </Box>
                      {(onEditItem || onDeleteItem) && (
                        <Box
                          sx={{
                            display: "flex",
                            gap: 0.25,
                            ml: 1,
                            opacity: 0,
                            ".MuiMenuItem-root:hover &": { opacity: 1 },
                          }}
                        >
                          {onEditItem && (
                            <EditIcon
                              sx={{
                                fontSize: 15,
                                color: "text.disabled",
                                cursor: "pointer",
                                "&:hover": { color: "primary.main" },
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleClose();
                                onEditItem(fv.value);
                              }}
                            />
                          )}
                          {onDeleteItem && (
                            <DeleteIcon
                              sx={{
                                fontSize: 15,
                                color: "text.disabled",
                                cursor: "pointer",
                                "&:hover": { color: "error.main" },
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleClose();
                                onDeleteItem(fv.value);
                              }}
                            />
                          )}
                        </Box>
                      )}
                    </MenuItem>
                  );
                })}

                {showAddNew && (
                  <MenuItem dense onClick={() => { handleClose(); onAddNew(); }}>
                    <Typography variant="body2" color="primary">+ Add New</Typography>
                  </MenuItem>
                )}
              </>
            )}
          </Box>
        </Popover>
      </Box>
    </TableCell>
  );
}
