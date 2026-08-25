import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import RegisterSchool from "./pages/RegisterSchool";
import VerifyEmail from "./pages/VerifyEmail";
import Dashboard from "./pages/Dashboard";
import Students from "./pages/Students";
import Finance from "./pages/Finance";
import AuditLog from "./pages/AuditLog";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<RegisterSchool />} />
        <Route path="/verify" element={<VerifyEmail />} />
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
        <Route path="/audit-log" element={
          <ProtectedRoute roles={["owner"]}>
            <Layout><AuditLog /></Layout>
          </ProtectedRoute>
        } />
      </Routes>
    </AuthProvider>
  );
}
