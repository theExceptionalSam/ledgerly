import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";

// Maps each audit entry to a human-readable title + structured details.
// The backend controllers write specific metadata shapes per action; this
// function mirrors those shapes to produce plain-English titles.
function describe(entry) {
  const { action, entity_type, metadata } = entry;
  const m = metadata || {};
  const key = `${action}/${entity_type}`;

  let title;
  switch (key) {
    // --- User management ---
    case "create/user":
      title = `Invited ${m.userName || "a user"} as ${m.role || "staff"}`;
      break;
    case "update/user":
      if (m.action === "changed_password") {
        title = `${m.userName || "User"} changed their password`;
      } else if (m.oldRole && m.newRole) {
        title = `Changed ${m.userName || "user"}'s role from ${m.oldRole} to ${m.newRole}`;
      } else if (m.status) {
        title = `${m.status === "disabled" ? "Disabled" : "Enabled"} ${m.userName || "user"}'s account`;
      } else {
        title = "Updated a user profile";
      }
      break;
    case "delete/user":
      title = `Removed ${m.userName || "user"}${m.email ? ` (${m.email})` : ""} from the school`;
      break;

    // --- Students ---
    case "create/student":
      title = "Created student record";
      break;
    case "delete/student":
      title = "Archived a student";
      break;
    case "delete/student_bulk":
      title = `Archived ${m.archived ?? 0} student(s)`;
      break;
    case "create/student_bulk":
      title = `Bulk imported ${m.imported ?? 0} student(s)`;
      break;

    // --- Payments / fees / discounts ---
    case "create/payment":
      title = m.amount != null ? `Recorded a ${naira(m.amount)} payment` : "Recorded a payment";
      break;
    case "update/payment":
      title = m.reversed ? `Reversed a payment${m.reason ? " — " + m.reason : ""}` : "Updated a payment";
      break;
    case "create/fee_assignment":
      title = m.expectedAmount != null ? `Assigned a fee of ${naira(m.expectedAmount)} to a student` : "Assigned a fee to a student";
      break;
    case "update/discount":
      title = m.discountAmount != null
        ? `Approved a ${naira(m.discountAmount)} discount${m.discountReason ? " (" + m.discountReason + ")" : ""}`
        : "Approved a discount on a fee";
      break;
    case "create/bulk_fee_assignment":
      title = m.class
        ? `Bulk-assigned a fee head to ${m.assigned ?? 0} student(s) in ${m.class}`
        : "Bulk-assigned a fee head to a class";
      break;

    // --- Fee heads ---
    case "create/fee_head":
      title = m.name ? `Created fee head "${m.name}"` : "Created a fee head";
      break;
    case "delete/fee_head":
      title = "Deactivated a fee head";
      break;

    // --- Terms & sessions ---
    case "create/term":
      title = m.name ? `Created term "${m.name}"` : "Created an academic term";
      break;
    case "update/term":
      title = m.setCurrent ? "Switched the current term" : "Updated an academic term";
      break;
    case "delete/term":
      title = "Deleted a term";
      break;
    case "create/session":
      title = m.name ? `Created session "${m.name}"` : "Created a session";
      break;
    case "update/session":
      title = m.setCurrent ? "Switched the current session" : (m.name ? "Renamed a session" : "Updated a session");
      break;
    case "delete/session":
      title = "Deleted a session";
      break;

    // --- Transactions & receipts ---
    case "create/transaction":
      title = "Added an income or expenditure entry";
      break;
    case "delete/transaction":
      title = "Reversed an income or expenditure entry";
      break;
    case "create/receipt":
      title = m.receiptNumber ? `Issued receipt ${m.receiptNumber}` : "Issued a receipt";
      break;

    // --- Tenant / auth ---
    case "create/tenant":
      title = "Registered the school account";
      break;
    case "login/user":
      title = "Signed in";
      break;
    case "login_failed/user":
      title = "Failed a sign-in attempt (wrong password)";
      break;

    // --- Audit log maintenance ---
    case "delete/audit_log":
      title = `Deleted ${m.deleted ?? 0} audit log entries`;
      break;

    default:
      title = `${action} ${entity_type}`;
  }

  // --- Details: extra context from metadata, as readable key-value pairs ---
  // (Kept short — most context is already in the title.)
  const details = [];
  if (m.imported != null) details.push(["Imported", m.imported]);
  if (m.failed != null && m.failed > 0) details.push(["Rows skipped", m.failed]);
  if (m.archived != null) details.push(["Archived", m.archived]);
  if (m.assigned != null) details.push(["Assigned", m.assigned]);
  if (m.skipped != null) details.push(["Skipped", m.skipped]);
  if (m.deleted != null) details.push(["Entries deleted", m.deleted]);
  if (m.amount != null) details.push(["Amount", naira(m.amount)]);
  if (m.expectedAmount != null) details.push(["Expected", naira(m.expectedAmount)]);
  if (m.discountAmount != null) details.push(["Discount", naira(m.discountAmount)]);
  if (m.discountReason) details.push(["Reason", m.discountReason]);
  if (m.receiptNumber) details.push(["Receipt #", m.receiptNumber]);
  if (m.reason && !m.receiptNumber && !m.reversed) details.push(["Reason", m.reason]);
  if (m.class) details.push(["Class", m.class]);
  if (m.email && key !== "delete/user") details.push(["Email", m.email]);

  return { title, details };
}

// Color per action verb — makes the log scannable at a glance.
const actionColor = {
  create: "#1B7A43",
  update: "#C77D22",
  delete: "#B3261E",
  access: "#5B5B54",
  login: "#14213D",
  login_failed: "#B3261E",
};

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-NG", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = (newLimit) => {
    setLoading(true);
    setError("");
    api.get(`/audit-logs?limit=${newLimit}`).then((d) => {
      setLogs(d.logs);
      setLimit(newLimit);
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  useEffect(() => { load(100); }, []);

  const loadMore = () => load(limit + 200);

  // Delete all audit log entries older than 30 days, then reload the list.
  const clearOldEntries = async () => {
    if (!window.confirm("Delete all audit log entries older than 30 days?")) return;
    setClearing(true);
    setError("");
    setNotice("");
    try {
      const before = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const result = await api.post("/audit-logs/bulk-delete", { before });
      const deleted = result?.deleted ?? 0;
      setNotice(`Deleted ${deleted} audit log entr${deleted === 1 ? "y" : "ies"} older than 30 days.`);
      load(100);
    } catch (e) {
      setError(e.message);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div>
      <p className="page-intro">
        Every action taken on financial and student records, in order. Only visible to the school owner.
        Each entry shows what was done, who did it, and the relevant details.
      </p>
      {error && <div className="form-error">{error}</div>}
      {notice && (
        <div className="form-error" style={{ background: "#E7F3EC", color: "#1B7A43", borderColor: "#C5E0CF" }}>
          {notice}
        </div>
      )}

      <div className="toolbar">
        <div></div>
        <button
          className="btn-danger-ghost"
          onClick={clearOldEntries}
          disabled={clearing || loading}
          title="Delete every audit log entry older than 30 days"
        >
          {clearing ? "Clearing..." : "Clear old entries"}
        </button>
      </div>

      {logs.length === 0 && <div className="empty-state">No activity recorded yet.</div>}

      <div className="list">
        {logs.map((l) => {
          const { title, details } = describe(l);
          const color = actionColor[l.action] || "#5B5B54";
          return (
            <div key={l.id} className="audit-entry">
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
              <div className="audit-meta">
                {formatDate(l.created_at)}{l.ip_address ? ` · ${l.ip_address}` : ""}
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
