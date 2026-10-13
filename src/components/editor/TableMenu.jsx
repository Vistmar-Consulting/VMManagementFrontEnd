import { useState } from "react";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import TableChartOutlined from "@mui/icons-material/TableChartOutlined";
import { t } from "../../theme/tokens.js";

const GRID = 8;
const CELL = 16;

/**
 * Toolbar Table button. Outside a table it opens a Word-style size grid
 * (hover to size, click to insert). Inside a table it opens the row/column menu.
 *
 * Props:
 *   editor — TipTap Editor instance, or null (renders disabled)
 *   sx     — the toolbar's shared IconButton sx (colours, hover, disabled)
 */
export default function TableMenu({ editor, sx }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [hover, setHover] = useState({ rows: 0, cols: 0 });
  // Decided at click time so the popup doesn't swap under the user mid-use.
  const [inTable, setInTable] = useState(false);

  const close = () => {
    setAnchorEl(null);
    setHover({ rows: 0, cols: 0 });
  };

  const open = (e) => {
    setInTable(editor.isActive("table"));
    setAnchorEl(e.currentTarget);
  };

  const insert = (rows, cols) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    close();
  };

  const actions = [
    ["Insert row above", (c) => c.addRowBefore()],
    ["Insert row below", (c) => c.addRowAfter()],
    ["Insert column left", (c) => c.addColumnBefore()],
    ["Insert column right", (c) => c.addColumnAfter()],
    null,
    ["Delete row", (c) => c.deleteRow()],
    ["Delete column", (c) => c.deleteColumn()],
    null,
    ["Toggle header row", (c) => c.toggleHeaderRow()],
    null,
    ["Delete table", (c) => c.deleteTable()],
  ];

  return (
    <>
      <IconButton
        size="small"
        title="Table"
        disabled={!editor}
        onMouseDown={(e) => e.preventDefault()}
        onClick={open}
        sx={sx}
      >
        <TableChartOutlined fontSize="small" />
      </IconButton>

      <Popover
        open={Boolean(anchorEl) && !inTable}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ p: 1 }} onMouseLeave={() => setHover({ rows: 0, cols: 0 })}>
          <Box
            role="grid"
            aria-label="Table size"
            sx={{ display: "grid", gridTemplateColumns: `repeat(${GRID}, ${CELL}px)`, gap: "2px" }}
          >
            {Array.from({ length: GRID * GRID }, (_, i) => {
              const row = Math.floor(i / GRID) + 1;
              const col = (i % GRID) + 1;
              const lit = row <= hover.rows && col <= hover.cols;
              return (
                <Box
                  key={i}
                  role="gridcell"
                  aria-label={`${row} by ${col}`}
                  onMouseEnter={() => setHover({ rows: row, cols: col })}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(row, col)}
                  sx={{
                    width: CELL,
                    height: CELL,
                    cursor: "pointer",
                    border: `1px solid ${lit ? t.copper : t.cream3}`,
                    backgroundColor: lit ? t.copperFaint : "#fff",
                  }}
                />
              );
            })}
          </Box>
          <Box sx={{ mt: 0.75, fontSize: 12, color: t.ink3, textAlign: "center" }}>
            {hover.rows ? `${hover.cols} × ${hover.rows}` : "Insert table"}
          </Box>
        </Box>
      </Popover>

      <Menu
        open={Boolean(anchorEl) && inTable}
        anchorEl={anchorEl}
        onClose={close}
        MenuListProps={{ dense: true }}
      >
        {/* Built only while open: editor may be null when the toolbar is idle. */}
        {Boolean(anchorEl) && inTable && actions.map((a, i) =>
          a === null ? (
            <Divider key={i} />
          ) : (
            <MenuItem
              key={a[0]}
              disabled={!a[1](editor.can().chain()).run()}
              onClick={() => {
                a[1](editor.chain().focus()).run();
                close();
              }}
              sx={{ fontSize: 13 }}
            >
              {a[0]}
            </MenuItem>
          ),
        )}
      </Menu>
    </>
  );
}
