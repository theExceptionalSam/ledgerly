import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setAccessToken, setUnauthorizedHandler } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [schoolName, setSchoolName] = useState("");
  const [initializing, setInitializing] = useState(true);

  const clearSession = useCallback(() => {
    setUser(null);
    setSchoolName("");
    setAccessToken(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    (async () => {
      try {
        const token = await api.refreshAccessToken();
        if (token) {
          try {
            const data = await api.get("/auth/me");
            setUser(data.user);
            setSchoolName(data.tenant?.name || "");
          } catch {
            clearSession();
          }
        }
      } catch {
        clearSession();
      }
      setInitializing(false);
    })();
  }, [clearSession]);

  const login = async (email, password) => {
    try {
      const data = await api.post("/auth/login", { email, password });
      setAccessToken(data.accessToken);
      setUser(data.user);
      // Backend now includes schoolName in the login response — no extra /me call needed.
      setSchoolName(data.schoolName || "");
      return data.user;
    } catch (err) {
      if (err.status === 403 && err.payload?.verificationRequired) {
        const e = new Error(err.message);
        e.verificationRequired = true;
        e.email = err.payload.email;
        throw e;
      }
      throw err;
    }
  };

  const registerSchool = async (fields) => {
    const { confirmPassword, ...payload } = fields;
    return api.post("/auth/register-school", payload);
  };

  const verifyOtp = async (email, code) => {
    const data = await api.post("/auth/verify-otp", { email, code });
    setAccessToken(data.accessToken);
    setUser(data.user);
    setSchoolName(data.schoolName || "");
    return data.user;
  };

  const resendOtp = async (email) => {
    return api.post("/auth/resend-otp", { email });
  };

  const forgotPassword = async (email) => {
    return api.post("/auth/forgot-password", { email });
  };

  const resetPassword = async (email, token, password) => {
    return api.post("/auth/reset-password", { email, token, password });
  };

  const logout = async () => {
    await api.post("/auth/logout");
    clearSession();
  };

  return (
    <AuthContext.Provider value={{ user, setUser, schoolName, initializing, login, registerSchool, verifyOtp, resendOtp, forgotPassword, resetPassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
