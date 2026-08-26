import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { TermProvider } from "./context/TermContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import Login from "./pages/Login";
import RegisterSchool from "./pages/RegisterSchool";
import VerifyEmail from "./pages/VerifyEmail";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Students from "./pages/Students";
import Finance from "./pages/Finance";
import AuditLog from "./pages/AuditLog";
import Terms from "./pages/Terms";
import FeeHeads from "./pages/FeeHeads";
import Users from "./pages/Users";

export default function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <TermProvider>
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
              <ProtectedRoute roles={["owner"]}>
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
        </TermProvider>
      </ErrorBoundary>
    </AuthProvider>
  );
}
