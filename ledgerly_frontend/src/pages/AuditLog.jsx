import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";

// Maps each audit entry to a human-readable title + structured details.
function describe(entry) {
  const { action, entity_type, metadata } = entry;
  const m = metadata || {};
  const key = `${action}/${entity_type}`;

  let title;
  switch (key) {
    case "create/user":
      title = `Invited ${m.userName || "a user"} as ${m.role || "staff"}`;
      break;
    case "update/user":
      if (m.action === "changed_password") title = `${m.userName || "User"} changed their password`;
      else if (m.oldRole && m.newRole) title = `Changed ${m.userName || "user"}'s role from ${m.oldRole} to ${m.newRole}`;
      else if (m.status) title = `${m.status === "disabled" ? "Disabled" : "Enabled"} ${m.userName || "user"}'s account`;
      else title = "Updated a user profile";
      break;
    case "delete/user":
      title = `Removed ${m.userName || "user"}${m.email ? ` (${m.email})` : ""} from the school`;
      break;
    case "create/student": title = "Created student record"; break;
    case "delete/student": title = "Archived a student"; break;
    case "delete/student_bulk": title = `Archived ${m.archived ?? 0} student(s)`; break;
    case "create/student_bulk": title = `Bulk imported ${m.imported ?? 0} student(s)`; break;
    case "create/payment":
      title = m.studentName
        ? `Recorded ${naira(m.amount)} ${m.feeHeadName || ''} payment for ${m.studentName}`
        : (m.amount != null ? `Recorded a ${naira(m.amount)} payment` : "Recorded a payment");
      break;
    case "update/payment": title = m.reversed ? `Reversed a payment${m.reason ? " — " + m.reason : ""}` : "Updated a payment"; break;
    case "create/fee_assignment": title = m.expectedAmount != null ? `Assigned a fee of ${naira(m.expectedAmount)} to a student` : "Assigned a fee to a student"; break;
    case "update/discount": title = m.discountAmount != null ? `Approved a ${naira(m.discountAmount)} discount${m.discountReason ? " (" + m.discountReason + ")" : ""}` : "Approved a discount on a fee"; break;
    case "create/bulk_fee_assignment": title = m.class ? `Bulk-assigned a fee head to ${m.assigned ?? 0} student(s) in ${m.class}` : "Bulk-assigned a fee head to a class"; break;
    case "create/fee_head": title = m.name ? `Created fee head "${m.name}"` : "Created a fee head"; break;
    case "delete/fee_head": title = "Deactivated a fee head"; break;
    case "create/term": title = m.name ? `Created term "${m.name}"` : "Created an academic term"; break;
    case "update/term": title = m.setCurrent ? "Switched the current term" : "Updated an academic term"; break;
    case "delete/term": title = "Deleted a term"; break;
    case "create/session": title = m.name ? `Created session "${m.name}"` : "Created a session"; break;
    case "update/session": title = m.setCurrent ? "Switched the current session" : (m.name ? "Renamed a session" : "Updated a session"); break;
    case "delete/session": title = "Deleted a session"; break;
    case "create/transaction":
      title = m.type && m.category
        ? `Added ${m.type === 'income' ? 'income' : 'expenditure'}: ${m.category}${m.amount != null ? ` (${naira(m.amount)})` : ''}`
        : "Added an income or expenditure entry";
      break;
    case "delete/transaction":
      title = m.type && m.category
        ? `Reversed ${m.type === 'income' ? 'income' : 'expenditure'}: ${m.category}${m.amount != null ? ` (${naira(m.amount)})` : ''}`
        : "Reversed an income or expenditure entry";
      break;
    case "create/receipt": title = m.receiptNumber ? `Issued receipt ${m.receiptNumber}` : "Issued a receipt"; break;
    case "create/tenant": title = "Registered the school account"; break;
    case "login/user": title = "Signed in"; break;
    case "login_failed/user": title = "Failed a sign-in attempt (wrong password)"; break;
    case "delete/audit_log": title = `Deleted ${m.deleted ?? 0} audit log entries`; break;
    default: title = `${action} ${entity_type}`;
  }

  const details = [];
  if (m.imported != null) details.push(["Imported", m.imported]);
  if (m.failed != null && m.failed > 0) details.push(["Skipped", m.failed]);
  if (m.archived != null) details.push(["Archived", m.archived]);
  if (m.assigned != null) details.push(["Assigned", m.assigned]);
  if (m.skipped != null) details.push(["Skipped", m.skipped]);
  if (m.deleted != null) details.push(["Entries", m.deleted]);
  if (m.amount != null) details.push(["Amount", naira(m.amount)]);
  if (m.expectedAmount != null) details.push(["Expected", naira(m.expectedAmount)]);
  if (m.discountAmount != null) details.push(["Discount", naira(m.discountAmount)]);
  if (m.discountReason) details.push(["Reason", m.discountReason]);
  if (m.receiptNumber) details.push(["Receipt #", m.receiptNumber]);
  if (m.class) details.push(["Class", m.class]);

  return { title, details };
}

const actionColor = {
  create: "#1B7A43", update: "#C77D22", delete: "#B3261E",
  access: "#5B5B54", login: "#14213D", login_failed: "#B3261E",
};

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  const load = (newLimit) => {
    setLoading(true); setError("");
    api.get(`/audit-logs?limit=${newLimit}`).then((d) => {
      setLogs(d.logs); setLimit(newLimit); setSelected(new Set());
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  useEffect(() => { load(100); }, []);
  const loadMore = () => load(limit + 200);

  const toggleSelect = (id) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (logs.every((l) => prev.has(l.id))) return new Set();
      const n = new Set(prev); logs.forEach((l) => n.add(l.id)); return n;
    });
  };

  const deleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} audit log entr${ids.length === 1 ? "y" : "ies"}? This cannot be undone.`)) return;
    setDeleting(true); setError("");
    try {
      const result = await api.post("/audit-logs/bulk-delete", { ids });
      setNotice(`Deleted ${result?.deleted ?? 0} entr${(result?.deleted ?? 0) === 1 ? "y" : "ies"}.`);
      load(100);
    } catch (e) { setError(e.message); }
    finally { setDeleting(false); }
  };

  const clearOldEntries = async () => {
    if (!window.confirm("Delete all audit log entries older than 30 days?")) return;
    setClearing(true); setError(""); setNotice("");
    try {
      const before = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const result = await api.post("/audit-logs/bulk-delete", { before });
      setNotice(`Deleted ${result?.deleted ?? 0} entr${(result?.deleted ?? 0) === 1 ? "y" : "ies"} older than 30 days.`);
      load(100);
    } catch (e) { setError(e.message); }
    finally { setClearing(false); }
  };

  return (
    <div>
      <p className="page-intro">
        Every action taken on financial and student records. Each entry shows what was done, who did it, and the relevant details.
      </p>
      {error && <div className="form-error">{error}</div>}
      {notice && <div className="form-error" style={{ background: "#E7F3EC", color: "#1B7A43", borderColor: "#C5E0CF" }}>{notice}</div>}

      <div className="toolbar audit-toolbar">
        <label className="select-all-chip">
          <input type="checkbox" checked={logs.length > 0 && logs.every((l) => selected.has(l.id))} onChange={toggleSelectAll} />
          Select all
        </label>
        <div className="audit-toolbar-actions">
          {selected.size > 0 && (
            <button className="btn-danger-ghost" onClick={deleteSelected} disabled={deleting}>
              {deleting ? "Deleting..." : `Delete ${selected.size} selected`}
            </button>
          )}
          <button className="btn-danger-ghost" onClick={clearOldEntries} disabled={clearing || loading}>
            {clearing ? "Clearing..." : "Clear old entries"}
          </button>
        </div>
      </div>

      {logs.length === 0 && <div className="empty-state">No activity recorded yet.</div>}

      <div className="list">
        {logs.map((l) => {
          const { title, details } = describe(l);
          const color = actionColor[l.action] || "#5B5B54";
          const isSelected = selected.has(l.id);
          return (
            <div key={l.id} className={"audit-entry" + (isSelected ? " selected" : "")}>
              <div className="audit-entry-top">
                <input type="checkbox" className="row-checkbox" checked={isSelected} onChange={() => toggleSelect(l.id)} />
                <div className="audit-entry-content">
                  <div className="audit-entry-header">
                    <span className="audit-dot" style={{ background: color }} />
                    <span className="audit-title">{title}</span>
                    {l.actor_name && <span className="audit-actor">by {l.actor_name}</span>}
                  </div>
                  {details.length > 0 && (
                    <div className="audit-details">
                      {details.map(([k, v], i) => (
                        <span key={i} className="audit-detail-pill">
                          <span className="audit-detail-label">{k}</span>
                          <span className="audit-detail-value">{String(v)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="audit-meta">{formatDate(l.created_at)}{l.ip_address ? ` · ${l.ip_address}` : ""}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {logs.length >= limit && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button className="btn-primary" onClick={loadMore} disabled={loading}>
            {loading ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
