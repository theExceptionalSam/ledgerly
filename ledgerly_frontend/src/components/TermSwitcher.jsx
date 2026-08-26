import { useTerm } from "../context/TermContext";

// Reusable term selector shown at the top of Dashboard, Students, and Finance.
// Reads from / writes to TermContext so all three pages share the same selection.
export default function TermSwitcher() {
  const { terms, selectedTermId, setSelectedTermId, loading } = useTerm();

  if (loading) return <div className="term-switcher-loading">Loading terms…</div>;

  return (
    <div className="term-switcher">
      <label htmlFor="term-select">Term</label>
      <select
        id="term-select"
        value={selectedTermId || ""}
        onChange={(e) => setSelectedTermId(e.target.value)}
      >
        {terms.length === 0 && <option value="">No terms</option>}
        {terms.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}{t.is_current ? " (current)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
