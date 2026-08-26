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
      // Fetch the school name right after login
      try {
        const me = await api.get("/auth/me");
        setSchoolName(me.tenant?.name || "");
      } catch {}
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

  // Registration no longer returns a session — the school email must be
  // verified with an OTP first. verifyOtp issues the first session.
  const registerSchool = async (fields) => {
    const { confirmPassword, ...payload } = fields;
    return api.post("/auth/register-school", payload);
  };

  const verifyOtp = async (email, code) => {
    const data = await api.post("/auth/verify-otp", { email, code });
    setAccessToken(data.accessToken);
    setUser(data.user);
    // Fetch the school name after first verification
    try {
      const me = await api.get("/auth/me");
      setSchoolName(me.tenant?.name || "");
    } catch {}
    return data.user;
  };

  const resendOtp = async (email) => {
    return api.post("/auth/resend-otp", { email });
  };

  const logout = async () => {
    await api.post("/auth/logout");
    clearSession();
  };

  return (
    <AuthContext.Provider value={{ user, setUser, schoolName, initializing, login, registerSchool, verifyOtp, resendOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
