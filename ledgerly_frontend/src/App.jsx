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
const Sessions = lazy(() => import("./pages/Sessions")); // Sessions & Terms (academic) — renamed from Terms.jsx to free the /terms route
const Terms = lazy(() => import("./pages/Terms")); // Terms of Service (legal) — public at /terms
const FeeHeads = lazy(() => import("./pages/FeeHeads"));
const Users = lazy(() => import("./pages/Users"));
const Reports = lazy(() => import("./pages/Reports"));
const BrandingSettings = lazy(() => import("./pages/BrandingSettings"));
const PlatformAdmin = lazy(() => import("./pages/PlatformAdmin"));
const Pricing = lazy(() => import("./pages/Pricing"));
const ParentPortal = lazy(() => import("./pages/ParentPortal"));
const Security = lazy(() => import("./pages/Security"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const BankReconciliation = lazy(() => import("./pages/BankReconciliation"));
const FeeTemplates = lazy(() => import("./pages/FeeTemplates"));
const PaymentPlans = lazy(() => import("./pages/PaymentPlans"));
const Settings = lazy(() => import("./pages/Settings"));
const DataRequests = lazy(() => import("./pages/DataRequests"));
const Webhooks = lazy(() => import("./pages/Webhooks"));
const Receipts = lazy(() => import("./pages/Receipts"));

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
              {/* Public marketing / legal / parent routes */}
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/parent" element={<ParentPortal />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
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
              <Route path="/receipts" element={
                <ProtectedRoute roles={["owner", "accountant", "bursar"]}>
                  <Layout><Receipts /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/fee-heads" element={
                <ProtectedRoute roles={["owner", "bursar"]}>
                  <Layout><FeeHeads /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/sessions" element={
                <ProtectedRoute>
                  <Layout><Sessions /></Layout>
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
              <Route path="/reports" element={
                <ProtectedRoute roles={["owner"]}>
                  <Layout><Reports /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/branding" element={
                <ProtectedRoute roles={["owner"]}>
                  <Layout><BrandingSettings /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/security" element={
                <ProtectedRoute roles={["owner"]}>
                  <Layout><Security /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/onboarding" element={
                <ProtectedRoute>
                  <Layout><Onboarding /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/bank-reconciliation" element={
                <ProtectedRoute roles={["owner", "accountant"]}>
                  <Layout><BankReconciliation /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/fee-templates" element={
                <ProtectedRoute roles={["owner", "bursar"]}>
                  <Layout><FeeTemplates /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/payment-plans" element={
                <ProtectedRoute roles={["owner", "bursar"]}>
                  <Layout><PaymentPlans /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/settings" element={
                <ProtectedRoute roles={["owner"]}>
                  <Layout><Settings /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/data-requests" element={
                <ProtectedRoute roles={["owner"]}>
                  <Layout><DataRequests /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/webhooks" element={
                <ProtectedRoute roles={["owner"]}>
                  <Layout><Webhooks /></Layout>
                </ProtectedRoute>
              } />
              {/* Platform admin — separate auth (no ProtectedRoute) */}
              <Route path="/admin" element={<PlatformAdmin />} />
            </Routes>
          </Suspense>
        </TermProvider>
      </ErrorBoundary>
    </AuthProvider>
  );
}
