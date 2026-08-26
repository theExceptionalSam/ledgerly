import { useEffect, useState } from "react";
import { api } from "../api/client";

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/audit-logs").then((d) => setLogs(d.logs)).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <p className="page-intro">Every action taken on financial and student records, in order. Only visible to the school owner.</p>
      {error && <div className="form-error">{error}</div>}
      <div className="list">
        {logs.map((l) => (
          <div key={l.id} className="audit-row">
            <div>
              <span className="audit-action">{l.action}</span> {l.entity_type}
              {l.actor_name && <span className="audit-actor"> · by {l.actor_name}</span>}
            </div>
            <div className="audit-meta">{l.created_at} · {l.ip_address}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
