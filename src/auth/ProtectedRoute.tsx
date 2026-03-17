import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import type { DemoUserRole } from "./demoAuth";

export function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles?: DemoUserRole[];
}) {
  const { isAuthed, hasRole } = useAuth();
  const loc = useLocation();

  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }

  if (allowedRoles && allowedRoles.length > 0 && !hasRole(...allowedRoles)) {
    return <Navigate to="/ad-orders" replace />;
  }

  return children;
}
