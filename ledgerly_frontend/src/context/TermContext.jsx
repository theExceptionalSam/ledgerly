import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../api/client";
import { useAuth } from "./AuthContext";

// TermContext shares the selected academic term across Dashboard, Students,
// and Finance. Every term-scoped API call reads ?termId= from here.
// When the backend's "current term" changes (via the Terms page), calling
// reload() re-fetches the term list and updates the selection.
const TermContext = createContext(null);

export function TermProvider({ children }) {
  const { user } = useAuth();
  const [terms, setTerms] = useState([]);
  const [selectedTermId, setSelectedTermId] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    if (!user) return;
    setLoading(true);
    api.get("/terms")
      .then((data) => {
        setTerms(data.terms);
        // If the current selection is no longer valid, or the backend's
        // current term changed, update the selection to the current term.
        const current = data.terms.find((t) => t.is_current);
        const stillExists = data.terms.some((t) => t.id === selectedTermId);
        if (!stillExists || (current && current.id !== selectedTermId)) {
          setSelectedTermId(current ? current.id : (data.terms[0]?.id || null));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, selectedTermId]);

  useEffect(() => {
    if (!user) {
      setTerms([]);
      setSelectedTermId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api.get("/terms")
      .then((data) => {
        setTerms(data.terms);
        const current = data.terms.find((t) => t.is_current);
        setSelectedTermId(current ? current.id : (data.terms[0]?.id || null));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const selectedTerm = terms.find((t) => t.id === selectedTermId) || null;

  return (
    <TermContext.Provider value={{ terms, selectedTermId, setSelectedTermId, selectedTerm, loading, reload }}>
      {children}
    </TermContext.Provider>
  );
}

export function useTerm() {
  return useContext(TermContext);
}
