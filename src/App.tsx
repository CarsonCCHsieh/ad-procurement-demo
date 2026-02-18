import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { LoginPage } from "./pages/Login";
import { AdOrdersPage } from "./pages/AdOrders";
import { AdPerformancePage } from "./pages/AdPerformance";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/ad-orders" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/ad-orders"
        element={
          <ProtectedRoute>
            <AdOrdersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ad-performance"
        element={
          <ProtectedRoute>
            <AdPerformancePage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/ad-orders" replace />} />
    </Routes>
  );
}

