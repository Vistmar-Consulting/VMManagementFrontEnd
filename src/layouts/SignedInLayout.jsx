import { Outlet } from "react-router-dom";
import { Box } from "@mui/material";

import AppTopBar from "../components/AppTopBar.jsx";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function SignedInLayout() {
  const { isAdmin } = useAuth();

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      <Sidebar isAdmin={isAdmin} />
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <AppTopBar />
        {/* overflow MUST stay "visible": this column isn't height-constrained,
            so the window does the scrolling. An "auto"/"hidden" here creates a
            scroll-context that scopes (and kills) position:sticky in descendants
            — e.g. the Agenda Overview's sticky formatting toolbar. */}
        <Box component="main" sx={{ flex: 1, p: 6, overflow: "visible" }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
