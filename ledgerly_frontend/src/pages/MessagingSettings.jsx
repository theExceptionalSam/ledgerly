import { useEffect, useState } from "react";
import { api } from "../api/client";

const DEFAULT_TEMPLATE = "Dear parent/guardian, {studentName} has an outstanding balance of NGN {outstanding} for {termName}. Kindly clear this at your earliest convenience. — {schoolName}";

export default function MessagingSettings() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get("/messaging-settings").then((d) => setSettings(d.settings)).catch((e) => setError(e.message));
  }, []);

  const save = async () => {
    setError(""); setSaved(false);
    try {
      await api.put("/messaging-settings", settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError(e.message); }
  };

  if (error) return <div className="form-error">{error}</div>;
  if (!settings) return <div className="page-loading">Loading...</div>;

  return (
    <div>
      <div className="page-intro">
        Parent-facing reminders are sent via SMS or WhatsApp through Termii. Reminders are <strong>off by default</strong> —
        turn them on here before any sending is possible. Every send is a manual click; nothing sends silently.
      </div>

      <div className="card">
        <div className="card-title">Reminders</div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={!!settings.reminders_enabled}
            onChange={(e) => setSettings({ ...settings, reminders_enabled: e.target.checked ? 1 : 0 })}
          />
          Enable reminders (required before any manual or bulk send)
        </label>

        <label>Default channel</label>
        <select
          value={settings.default_channel}
          onChange={(e) => setSettings({ ...settings, default_channel: e.target.value })}
        >
          <option value="sms">SMS</option>
          <option value="whatsapp">WhatsApp</option>
        </select>

        <label>Message template</label>
        <textarea
          rows={5}
          value={settings.message_template}
          onChange={(e) => setSettings({ ...settings, message_template: e.target.value })}
        />
        <div className="field-hint">
          Placeholders: <code>{"{studentName}"}</code>, <code>{"{outstanding}"}</code>, <code>{"{termName}"}</code>, <code>{"{schoolName}"}</code>.
          These are filled in automatically per student.
        </div>

        <button className="btn-primary btn-full" onClick={save}>Save settings</button>
        {saved && <div className="field-hint" style={{ color: "#1B7A43", fontWeight: 600 }}>Saved.</div>}
      </div>

      <div className="card">
        <div className="card-title">Provider</div>
        <div className="finance-row"><span>Provider</span><span>Termii (SMS / WhatsApp)</span></div>
        <div className="finance-row"><span>Status</span><span>{settings.reminders_enabled ? "Active" : "Disabled"}</span></div>
        <div className="field-hint">
          Configure <code>TERMII_API_KEY</code> and <code>TERMII_SENDER_ID</code> in the backend environment.
          Without a valid API key, sends will be recorded as "failed" but will not crash.
        </div>
      </div>
    </div>
  );
}
