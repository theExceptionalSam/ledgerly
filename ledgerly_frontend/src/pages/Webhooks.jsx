import { useEffect, useState } from "react";
import { api } from "../api/client";

// Webhook endpoints — register a URL + list of events to be notified about.
// When an event fires in Ledgerly, the backend POSTs the payload to every
// matching endpoint, signed with HMAC-SHA256 using the endpoint's secret.
//
// Endpoints:
//   GET    /webhooks         → { endpoints: [{ id, url, events, active, created_at }] }
//   POST   /webhooks         { url, events: [...] } → { id, url, events, secret }
//   DELETE /webhooks/:id
//
// The secret is returned ONCE on creation. Store it securely — there is no
// way to retrieve it again. Use it to verify the X-Ledgerly-Signature header
// on incoming webhook deliveries.

const KNOWN_EVENTS = [
  { id: "payment.recorded", label: "Payment recorded" },
  { id: "student.created", label: "Student created" },
  { id: "term.closed", label: "Term closed" },
];

function fmtDate(s) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
  } catch { return s; }
}

export default function Webhooks() {
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newSecret, setNewSecret] = useState(null); // shown once after creation

  const load = () => {
    setLoading(true); setError("");
    api.get("/webhooks")
      .then((d) => setEndpoints(d.endpoints || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const remove = async (id, url) => {
    if (!confirm(`Delete webhook for ${url}? Future events will no longer be delivered there.`)) return;
    setError("");
    try {
      await api.del(`/webhooks/${id}`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const created = (data) => {
    setShowCreate(false);
    setNewSecret(data);
    load();
  };

  const copySecret = async () => {
    if (!newSecret?.secret) return;
    try {
      await navigator.clipboard.writeText(newSecret.secret);
    } catch {
      // Clipboard may be blocked — fall back to a select prompt
      window.prompt("Copy this secret now — it won't be shown again:", newSecret.secret);
    }
  };

  return (
    <div>
      <p className="page-intro">
        Webhooks let your server receive real-time events (payment recorded,
        student created, term closed) as signed HTTP POST requests. Verify the
        <code> X-Ledgerly-Signature </code> header using your endpoint's secret.
      </p>

      {error && <div className="form-error">{error}</div>}

      <div className="toolbar">
        <div></div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New endpoint</button>
      </div>

      {newSecret && (
        <div className="card" style={{ marginBottom: 18, borderColor: "#1B7A43", background: "#F3FAF5" }}>
          <div className="card-title" style={{ color: "#1B7A43" }}>Endpoint created — save your secret now</div>
          <div className="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
            The signing secret below is shown <strong>only once</strong>. Copy it
            somewhere safe — you'll need it to verify webhook signatures, and
            Ledgerly cannot retrieve it again.
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{
              flex: 1, minWidth: 280, background: "#fff", border: "1px solid #C5E0CF",
              borderRadius: 8, padding: "10px 12px", fontFamily: "monospace", fontSize: 13,
              wordBreak: "break-all",
            }}>
              {newSecret.secret}
            </code>
            <button className="btn-primary" onClick={copySecret} style={{ padding: "8px 14px", fontSize: 13 }}>
              Copy
            </button>
            <button className="btn-ghost" onClick={() => setNewSecret(null)} style={{ padding: "8px 14px", fontSize: 13 }}>
              Dismiss
            </button>
          </div>
          <div className="field-hint" style={{ marginTop: 8 }}>
            Endpoint: <strong>{newSecret.url}</strong> · events:{" "}
            {(newSecret.events || []).join(", ") || "(none)"}
          </div>
        </div>
      )}

      {loading && <div className="page-loading">Loading endpoints…</div>}

      {!loading && endpoints.length === 0 && !newSecret && (
        <div className="empty-state">No webhook endpoints yet. Create one to start receiving events.</div>
      )}

      {!loading && endpoints.length > 0 && (
        <div className="list">
          {endpoints.map((ep) => (
            <div key={ep.id} className="list-item">
              <div className="list-item-row" style={{ cursor: "default" }}>
                <div className="list-item-main">
                  <div className="list-item-title" style={{ wordBreak: "break-all" }}>{ep.url}</div>
                  <div className="list-item-sub">
                    {(ep.events || []).join(", ") || "(no events)"}{" · "}
                    created {fmtDate(ep.created_at)}{" · "}
                    {ep.active ? (
                      <span className="badge" style={{ color: "#1B7A43", background: "#E7F4EC" }}>Active</span>
                    ) : (
                      <span className="badge" style={{ color: "#8A8A82", background: "#EDECE6" }}>Inactive</span>
                    )}
                  </div>
                </div>
                <div className="action-row" style={{ marginTop: 0 }}>
                  <button className="btn-danger-ghost" onClick={() => remove(ep.id, ep.url)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateWebhookModal onClose={() => setShowCreate(false)} onDone={created} />
      )}
    </div>
  );
}

function CreateWebhookModal({ onClose, onDone }) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState(new Set(["payment.recorded"]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (id) => {
    setEvents((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setError("");
    if (!url.trim()) { setError("Enter a URL."); return; }
    if (events.size === 0) { setError("Pick at least one event."); return; }
    setBusy(true);
    try {
      const res = await api.post("/webhooks", { url: url.trim(), events: [...events] });
      onDone(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div className="modal-title">New webhook endpoint</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <label>Endpoint URL (HTTPS recommended)</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-server.com/ledgerly-webhook"
          autoFocus
        />
        <div className="field-hint">Must be a valid http(s) URL. Ledgerly will POST event payloads here.</div>

        <label>Events to subscribe to</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {KNOWN_EVENTS.map((e) => (
            <label key={e.id} className="checkbox-row" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={events.has(e.id)}
                onChange={() => toggle(e.id)}
              />
              <span><strong>{e.id}</strong> — {e.label}</span>
            </label>
          ))}
        </div>

        <button className="btn-primary btn-full" disabled={busy} onClick={submit}>
          {busy ? "Creating…" : "Create endpoint"}
        </button>
        <div className="field-hint" style={{ marginTop: 10 }}>
          The signing secret will be shown once after creation. Copy it
          immediately — Ledgerly cannot retrieve it again.
        </div>
      </div>
    </div>
  );
}
