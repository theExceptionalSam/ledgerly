import { useEffect, useState } from "react";
import { api } from "../api/client";

// NDPR (Nigeria Data Protection Regulation) data subject rights — export and
// deletion. Both flow through the `data_requests` table.
//
// Endpoints:
//   POST   /data-requests/export    {} → { id, status }
//   POST   /data-requests/deletion  {} → { id, scheduledFor, gracePeriodDays }
//   POST   /data-requests/:id/cancel              → { ok: true }   (deletion only, while pending)
//   GET    /data-requests/:id/download            → CSV file stream (export only, when completed)
//   GET    /data-requests           → { requests: [{ id, type, status, processed_at, created_at }] }
//
// Export: queues a full CSV export of every tenant-owned row. The backend
// builds the file synchronously and marks the request completed.
//
// Deletion: queues a 30-day grace-period deletion. Only one pending deletion
// at a time — the backend 409s if there's already one queued. A pending
// deletion can be cancelled any time before the grace period elapses.

function fmtDate(s) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
  } catch { return s; }
}

const TYPE_META = {
  export: { label: "Export", color: "#14213D", bg: "#EDEFF4" },
  deletion: { label: "Deletion", color: "#B3261E", bg: "#FBEAE9" },
};

const STATUS_META = {
  pending: { label: "Pending", color: "#C77D22", bg: "#FBF0E2" },
  processing: { label: "Processing", color: "#14213D", bg: "#EDEFF4" },
  completed: { label: "Completed", color: "#1B7A43", bg: "#E7F4EC" },
  cancelled: { label: "Cancelled", color: "#8A8A82", bg: "#EDECE6" },
  failed: { label: "Failed", color: "#B3261E", bg: "#FBEAE9" },
};

const CONFIRM_PHRASE = "DELETE MY SCHOOL";

export default function DataRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [cancellingId, setCancellingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  // Deletion confirm flow
  const [showDelete, setShowDelete] = useState(false);

  const load = () => {
    setLoading(true); setError("");
    api.get("/data-requests")
      .then((d) => setRequests(d.requests || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const exportData = async () => {
    if (!confirm("Queue a full data export? You'll get a notification when it's ready.")) return;
    setBusy("export"); setError(""); setNotice("");
    try {
      await api.post("/data-requests/export", {});
      setNotice("Export queued. You'll be notified when it's ready.");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const cancelDeletion = async (r) => {
    if (!confirm("Cancel this deletion request? Your data will not be deleted.")) return;
    setCancellingId(r.id); setError(""); setNotice("");
    try {
      await api.post(`/data-requests/${r.id}/cancel`, {});
      setNotice("Deletion request cancelled.");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setCancellingId(null);
    }
  };

  const downloadExport = async (r) => {
    setDownloadingId(r.id); setError("");
    try {
      await api.download(`/data-requests/${r.id}/download`, `ledgerly-export-${r.id}.csv`);
    } catch (e) {
      setError(e.message || "Could not download the export.");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div>
      <p className="page-intro">
        Your data, your rights. Under the Nigeria Data Protection Regulation
        (NDPR) you can export every row Ledgerly holds about your school, or
        request permanent deletion. Deletions have a 30-day grace period so you
        can cancel if you change your mind.
      </p>

      {error && <div className="form-error">{error}</div>}
      {notice && (
        <div className="form-error" style={{ background: "#E7F3EC", color: "#1B7A43", borderColor: "#C5E0CF" }}>
          {notice}
        </div>
      )}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total requests</div>
          <div className="stat-value">{requests.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Exports</div>
          <div className="stat-value">{requests.filter((r) => r.type === "export").length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Deletions</div>
          <div className="stat-value" style={{ color: "#B3261E" }}>{requests.filter((r) => r.type === "deletion").length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending</div>
          <div className="stat-value" style={{ color: "#C77D22" }}>{requests.filter((r) => r.status === "pending" || r.status === "processing").length}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">Export your data</div>
        <div className="field-hint" style={{ marginTop: 0, marginBottom: 14 }}>
          Generates a CSV archive of every student, payment, transaction, fee
          assignment, user, and audit-log row tied to your school. Ready in a
          few minutes — you'll be notified.
        </div>
        <button className="btn-primary" onClick={exportData} disabled={busy === "export"}>
          {busy === "export" ? "Queuing…" : "Export all data"}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 18, borderColor: "#F2D9B8" }}>
        <div className="card-title" style={{ color: "#B3261E" }}>Delete account &amp; all data</div>
        <div className="field-hint" style={{ marginTop: 0, marginBottom: 14 }}>
          Schedules a permanent deletion of your school's data after a 30-day
          grace period. This cannot be undone once the grace period elapses.
        </div>
        <button className="btn-danger-ghost" onClick={() => setShowDelete(true)}>
          Request deletion
        </button>
      </div>

      <div className="card">
        <div className="card-title">Request history</div>
        {loading && <div className="page-loading">Loading…</div>}
        {!loading && requests.length === 0 && <div className="empty-state">No data requests yet.</div>}
        {!loading && requests.length > 0 && (
          <div className="table-wrapper">
            <table className="fee-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Processed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const tmeta = TYPE_META[r.type] || { label: r.type, color: "#5B5B54", bg: "#EDECE6" };
                  const smeta = STATUS_META[r.status] || { label: r.status, color: "#5B5B54", bg: "#EDECE6" };
                  const canCancel = r.type === "deletion" && r.status === "pending";
                  const canDownload = r.type === "export" && r.status === "completed";
                  return (
                    <tr key={r.id}>
                      <td><span className="badge" style={{ color: tmeta.color, background: tmeta.bg }}>{tmeta.label}</span></td>
                      <td><span className="badge" style={{ color: smeta.color, background: smeta.bg }}>{smeta.label}</span></td>
                      <td>{fmtDate(r.created_at)}</td>
                      <td>{fmtDate(r.processed_at)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {canCancel && (
                            <button
                              className="btn-danger-ghost"
                              disabled={cancellingId === r.id}
                              onClick={() => cancelDeletion(r)}
                              style={{ padding: "5px 10px", fontSize: 12 }}
                            >
                              {cancellingId === r.id ? "Cancelling…" : "Cancel"}
                            </button>
                          )}
                          {canDownload && (
                            <button
                              className="btn-primary"
                              disabled={downloadingId === r.id}
                              onClick={() => downloadExport(r)}
                              style={{ padding: "5px 12px", fontSize: 12 }}
                            >
                              {downloadingId === r.id ? "Preparing…" : "Download CSV"}
                            </button>
                          )}
                          {!canCancel && !canDownload && (
                            <span style={{ color: "#8A8A82", fontSize: 13 }}>—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showDelete && (
        <DeleteModal
          onClose={() => setShowDelete(false)}
          onDone={(msg) => { setShowDelete(false); setNotice(msg); load(); }}
          onError={(e) => setError(e)}
        />
      )}
    </div>
  );
}

function DeleteModal({ onClose, onDone, onError }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await api.post("/data-requests/deletion", {});
      onDone(`Deletion scheduled. All data will be permanently removed on ${fmtDate(res.scheduledFor)} (30-day grace period).`);
    } catch (e) {
      if (e.status === 409) {
        setError(e.message || "A deletion request is already pending.");
      } else {
        setError(e.message);
      }
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const matches = confirmText.trim() === CONFIRM_PHRASE;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div className="modal-title" style={{ color: "#B3261E" }}>Confirm deletion</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="form-error" style={{ background: "#FBEAE9", color: "#B3261E", borderColor: "#F2C9C5" }}>
          <strong>Warning:</strong> This schedules permanent deletion of every
          student, payment, transaction, fee, user, and audit record tied to
          your school. A 30-day grace period applies — after that, the data is
          gone forever. Receipts already issued to parents are not affected.
        </div>

        <label>Type <code>{CONFIRM_PHRASE}</code> to confirm</label>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
          autoFocus
          style={{ fontFamily: "monospace" }}
        />
        <div className="field-hint">This action cannot be undone after the grace period.</div>

        <button className="btn-danger-ghost btn-full" disabled={!matches || busy} onClick={submit}>
          {busy ? "Scheduling…" : "Schedule deletion"}
        </button>
      </div>
    </div>
  );
}
