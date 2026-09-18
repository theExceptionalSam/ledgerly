import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, roles, requireKyc = true }) {
  const { user, initializing } = useAuth();

  if (initializing) return <div className="page-loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  // Redirect to dashboard (not landing page) when the user's role doesn't match
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  // Gate: if KYC is required and not completed, redirect to the KYC form
  if (requireKyc && user.kycCompleted === false) return <Navigate to="/school-kyc" replace />;

  return children;
}
