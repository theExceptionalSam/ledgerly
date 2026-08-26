import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";

// Maps each audit entry to a human-readable title + structured details.
// The backend records (action, entity_type, metadata) — this function turns
// those raw fields into a plain-English description of what happened.
function describe(entry) {
  const { action, entity_type, metadata } = entry;
  const m = metadata || {};

  // --- Title: the main action, in plain English ---
  const titles = {
    "create/student_bulk": `Bulk imported ${m.imported ?? 0} student${(m.imported ?? 0) === 1 ? "" : "s"}`,
    "create/term": `Created academic term${m.name ? ` "${m.name}"` : ""}`,
    "update/term": m.setCurrent ? "Switched the current term" : "Updated an academic term",
    "create/student": "Created a new student record",
    "update/student": "Updated a student's details",
    "delete/student": "Archived a student (soft-deleted, history kept)",
    "access/student": "Viewed a student's details",
    "create/fee_assignment": m.expectedAmount != null ? `Assigned a fee of ${naira(m.expectedAmount)} to a student` : "Assigned a fee to a student",
    "update/discount": m.discountAmount != null ? `Approved a ${naira(m.discountAmount)} discount${m.discountReason ? ` (${m.discountReason})` : ""}` : "Approved a discount on a fee",
    "create/tenant": "Registered the school account",
    "update/user": m.emailVerified ? "Verified their email address" : "Updated their user profile",
    "login_failed/user": "Failed a sign-in attempt (wrong password)",
    "login/user": "Signed in",
    "access/audit_log": "Viewed the audit log",
    "create/receipt": m.receiptNumber ? `Issued receipt ${m.receiptNumber}` : "Issued a receipt",
    "create/fee_head": m.name ? `Created fee head "${m.name}"` : "Created a fee head",
    "delete/fee_head": "Deactivated a fee head (hidden from new billing)",
    "create/transaction": "Added an income or expenditure entry",
    "delete/transaction": "Reversed an income or expenditure entry",
    "create/payment": m.amount != null ? `Recorded a ${naira(m.amount)} payment` : "Recorded a payment",
    "update/payment": m.reversed ? `Reversed a payment${m.reason ? ` — ${m.reason}` : ""}` : "Updated a payment",
    "create/bulk_fee_assignment": m.class ? `Bulk-assigned a fee head to ${m.assigned ?? 0} student(s) in ${m.class}` : "Bulk-assigned a fee head to a class",
  };

  const title = titles[`${action}/${entity_type}`] || `${action} ${entity_type}`;

  // --- Details: extra context from metadata, as readable key-value pairs ---
  const details = [];
  if (m.imported != null) details.push(["Students imported", m.imported]);
  if (m.failed != null && m.failed > 0) details.push(["Rows skipped", m.failed]);
  if (m.amount != null) details.push(["Amount", naira(m.amount)]);
  if (m.expectedAmount != null) details.push(["Expected", naira(m.expectedAmount)]);
  if (m.discountAmount != null) details.push(["Discount", naira(m.discountAmount)]);
  if (m.discountReason) details.push(["Reason", m.discountReason]);
  if (m.receiptNumber) details.push(["Receipt #", m.receiptNumber]);
  if (m.name && entity_type !== "term") details.push(["Name", m.name]);
  if (m.class) details.push(["Class", m.class]);
  if (m.assigned != null) details.push(["Assigned", m.assigned]);
  if (m.skipped != null) details.push(["Skipped", m.skipped]);
  if (m.emailVerified) details.push(["Email verified", "Yes"]);
  if (m.reversed) details.push(["Reversed", "Yes"]);
  if (m.reason && !m.receiptNumber) details.push(["Reason", m.reason]);

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

const actionVerb = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  access: "Viewed",
  login: "Signed in",
  login_failed: "Failed",
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
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);

  const load = (newLimit) => {
    setLoading(true);
    api.get(`/audit-logs?limit=${newLimit}`).then((d) => {
      setLogs(d.logs);
      setLimit(newLimit);
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  useEffect(() => { load(100); }, []);

  const loadMore = () => load(limit + 200);

  return (
    <div>
      <p className="page-intro">
        Every action taken on financial and student records, in order. Only visible to the school owner.
        Each entry shows what was done, who did it, and the relevant details.
      </p>
      {error && <div className="form-error">{error}</div>}

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
