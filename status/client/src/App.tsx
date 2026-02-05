import { Routes, Route } from "react-router-dom";
import { BotConfigProvider } from "./context/BotConfigContext";
import { AdminAuthProvider } from "./hooks/useAdminAuth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminLogin } from "./pages/AdminLogin";
import { AdminDashboard } from "./pages/AdminDashboard";
import { LandingPage } from "./components/LandingPage";

function App() {
  return (
    <BotConfigProvider>
      <AdminAuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/admin" element={<AdminLogin />} />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AdminAuthProvider>
    </BotConfigProvider>
  );
}

export default App;
