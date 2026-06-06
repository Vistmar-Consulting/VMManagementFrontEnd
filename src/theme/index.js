import { createTheme as createMuiTheme } from "@mui/material/styles";

import breakpoints from "./breakpoints.js";
import components from "./components.js";
import palette from "./palette.js";
import shadows from "./shadows.js";
import typography from "./typography.js";

const theme = createMuiTheme({
  spacing: 4,
  breakpoints,
  components,
  typography,
  shadows,
  palette,
});

theme.sidebar = {
  width: 240,
  collapsedWidth: 52,
  color: "#cfd8dc",
  background: "#233044",
  active: "#2f3e54",
  header: {
    background: "#1e2a3a",
    color: "#FFFFFF",
    brand: "#7ea8e5",
  },
};

theme.appBar = {
  height: 56,
  background: "#FFFFFF",
  color: "#475569",
};

export default theme;
