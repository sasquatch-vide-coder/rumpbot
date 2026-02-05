import { Navigate } from "react-router-dom";
import { useAdminAuth } from "../hooks/useAdminAuth";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAdminAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-brutal-bg flex items-center justify-center">
        <div className="bg-brutal-yellow brutal-border brutal-shadow p-6">
          <span className="font-bold uppercase font-mono">Loading...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
}
