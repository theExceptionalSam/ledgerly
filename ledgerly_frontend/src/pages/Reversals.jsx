import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";

export default function Reversals() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = () => {
    setLoading(true); setError("");
    api.get("/reversals")
      .then((d) => setRequests(d.requests || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const approve = async (id) => {
    if (!confirm("Approve this reversal? The payment will be reversed permanently.")) return;
    setBusy(id);
    try { await api.post(`/reversals/${id}/approve`); load(); } catch (e) { setError(e.message); } finally { setBusy(""); }
  };

  const reject = async (id) => {
    if (!confirm("Reject this reversal request?")) return;
    setBusy(id);
    try { await api.post(`/reversals/${id}/reject`); load(); } catch (e) { setError(e.message); } finally { setBusy(""); }
  };

  return (
    <div>
      <h1>Reversal Requests</h1>
      <p className="page-intro">Review and approve payment reversal requests from staff. Approved reversals are irreversible.</p>

      {error && <div className="form-error">{error}</div>}
      {loading && <div className="page-loading">Loading…</div>}

      {!loading && requests.length === 0 && <div className="empty-state">No pending reversal requests.</div>}

      {!loading && requests.length > 0 && (
        <div className="list">
          {requests.map((r) => (
            <div key={r.id} className="list-item">
              <div className="list-item-row">
                <div className="list-item-main">
                  <div className="list-item-title">{r.student_name} — {naira(r.payment_amount)}</div>
                  <div className="list-item-sub">
                    {r.fee_head_name || "General"} · {r.paid_on} · Receipt: {r.receipt_number || "—"}
                  </div>
                  <div className="list-item-sub" style={{ marginTop: 4 }}>
                    <strong>Reason:</strong> {r.reason}
                  </div>
                  <div className="list-item-sub" style={{ marginTop: 4 }}>
                    Requested by {r.requested_by_name} on {new Date(r.created_at).toLocaleDateString("en-NG")}
                  </div>
                </div>
                <div className="reversal-actions">
                  <span className="badge" style={{ color: r.status === "approved" ? "#1B7A43" : r.status === "rejected" ? "#B3261E" : "#C77D22", background: r.status === "approved" ? "#E6F4EA" : r.status === "rejected" ? "#FBEAE9" : "#FBF0E2" }}>
                    {r.status}
                  </span>
                  {r.status === "pending" && (
                    <div className="reversal-actions-buttons">
                      <button className="btn-primary" disabled={busy === r.id} onClick={() => approve(r.id)}>
                        {busy === r.id ? "…" : "Approve"}
                      </button>
                      <button className="btn-danger-ghost" disabled={busy === r.id} onClick={() => reject(r.id)}>
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
