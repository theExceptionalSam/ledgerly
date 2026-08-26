import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { api, setAccessToken, setUnauthorizedHandler } from "../api/client";

const AuthContext = createContext(null);

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll"];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [schoolName, setSchoolName] = useState("");
  const [initializing, setInitializing] = useState(true);
  const lastActivityRef = useRef(Date.now());

  const clearSession = useCallback(() => {
    setUser(null);
    setSchoolName("");
    setAccessToken(null);
  }, []);

  // --- Session restore on page load ---
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
            lastActivityRef.current = Date.now();
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

  // --- 30-minute inactivity auto-logout ---
  useEffect(() => {
    if (!user) return;

    let timeoutId;

    const resetTimer = () => {
      lastActivityRef.current = Date.now();
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        // 30 minutes of inactivity — log out automatically
        try { await api.post("/auth/logout"); } catch {}
        clearSession();
        // Redirect to login
        if (window.location.pathname !== "/login") {
          window.location.href = "/login?reason=inactive";
        }
      }, INACTIVITY_TIMEOUT_MS);
    };

    // Reset on any user activity
    ACTIVITY_EVENTS.forEach((evt) => {
      window.addEventListener(evt, resetTimer, { passive: true });
    });

    // Start the initial timer
    resetTimer();

    return () => {
      clearTimeout(timeoutId);
      ACTIVITY_EVENTS.forEach((evt) => {
        window.removeEventListener(evt, resetTimer);
      });
    };
  }, [user, clearSession]);

  const login = async (email, password) => {
    try {
      const data = await api.post("/auth/login", { email, password });
      setAccessToken(data.accessToken);
      setUser(data.user);
      setSchoolName(data.schoolName || "");
      lastActivityRef.current = Date.now();
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
    lastActivityRef.current = Date.now();
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
