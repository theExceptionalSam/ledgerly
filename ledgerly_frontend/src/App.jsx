import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { TermProvider } from "./context/TermContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import Login from "./pages/Login";

// Sentry (optional, env-gated)
if (import.meta.env.VITE_SENTRY_DSN) {
  import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
    });
  });
}

// Lazy-load all pages except Login (the entry point) — reduces initial bundle
const RegisterSchool = lazy(() => import("./pages/RegisterSchool"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Students = lazy(() => import("./pages/Students"));
const Finance = lazy(() => import("./pages/Finance"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Terms = lazy(() => import("./pages/Terms"));
const FeeHeads = lazy(() => import("./pages/FeeHeads"));
const Users = lazy(() => import("./pages/Users"));

function PageLoader() {
  return <div className="page-loading">Loading…</div>;
}

export default function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <TermProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<RegisterSchool />} />
              <Route path="/verify" element={<VerifyEmail />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Layout><Dashboard /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/students" element={
                <ProtectedRoute>
                  <Layout><Students /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/finance" element={
                <ProtectedRoute>
                  <Layout><Finance /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/fee-heads" element={
                <ProtectedRoute roles={["owner", "bursar"]}>
                  <Layout><FeeHeads /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/terms" element={
                <ProtectedRoute>
                  <Layout><Terms /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/users" element={
                <ProtectedRoute roles={["owner"]}>
                  <Layout><Users /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/audit-log" element={
                <ProtectedRoute roles={["owner"]}>
                  <Layout><AuditLog /></Layout>
                </ProtectedRoute>
              } />
            </Routes>
          </Suspense>
        </TermProvider>
      </ErrorBoundary>
    </AuthProvider>
  );
}
