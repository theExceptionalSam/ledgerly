import { useTerm } from "../context/TermContext";

// Reusable term selector shown at the top of Dashboard, Students, and Finance.
// Groups terms by academic session using <optgroup>.
export default function TermSwitcher() {
  const { terms, selectedTermId, setSelectedTermId, loading } = useTerm();

  if (loading) return <div className="term-switcher-loading">Loading terms…</div>;

  // Group terms by session_name for the optgroups
  const groups = {};
  for (const t of terms) {
    const key = t.session_name || "No session";
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }

  // Show the session name of the currently selected term as a badge next to the
  // selector, so the user can see at a glance which academic session they're in
  // (the <select> already groups terms by session inside <optgroup>s, but the
  // selected option itself only shows the term name).
  const selectedTerm = terms.find((t) => t.id === selectedTermId);
  const sessionName = selectedTerm?.session_name;

  return (
    <div className="term-switcher">
      <label htmlFor="term-select">Term</label>
      <select
        id="term-select"
        name="termId"
        value={selectedTermId || ""}
        onChange={(e) => setSelectedTermId(e.target.value)}
      >
        {terms.length === 0 && <option value="">No terms</option>}
        {Object.entries(groups).map(([sessionNameKey, sessionTerms]) => (
          <optgroup key={sessionNameKey} label={sessionNameKey}>
            {sessionTerms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.is_current ? " (current)" : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {sessionName && (
        <span className="session-badge">{sessionName}</span>
      )}
    </div>
  );
}
