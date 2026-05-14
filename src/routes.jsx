import { Navigate, Route, Routes } from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute.jsx";
import SignedInLayout from "./layouts/SignedInLayout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Members from "./pages/Members.jsx";
import Organizations from "./pages/Organizations.jsx";
import Profile from "./pages/Profile.jsx";
import Settings from "./pages/Settings.jsx";
import SignIn from "./pages/SignIn.jsx";
import TaskBoard from "./pages/TaskBoard.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />

      <Route
        element={(
          <ProtectedRoute>
            <SignedInLayout />
          </ProtectedRoute>
        )}
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/board" element={<TaskBoard />} />
        <Route
          path="/members"
          element={(
            <ProtectedRoute requireAdmin>
              <Members />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/organizations"
          element={(
            <ProtectedRoute requireAdmin>
              <Organizations />
            </ProtectedRoute>
          )}
        />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
