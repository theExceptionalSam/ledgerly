import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "./AuthContext";

// TermContext shares the selected academic term across Dashboard, Students,
// and Finance. Every term-scoped API call reads ?termId= from here.
const TermContext = createContext(null);

export function TermProvider({ children }) {
  const { user } = useAuth();
  const [terms, setTerms] = useState([]);
  const [selectedTermId, setSelectedTermId] = useState(null);
  const [loading, setLoading] = useState(true);

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
    <TermContext.Provider value={{ terms, selectedTermId, setSelectedTermId, selectedTerm, loading }}>
      {children}
    </TermContext.Provider>
  );
}

export function useTerm() {
  return useContext(TermContext);
}
