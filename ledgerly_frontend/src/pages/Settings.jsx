import { useEffect, useState } from "react";
import { api } from "../api/client";

// Tenant settings — currency, language, white-label customization (primary
// color, parent company). Custom domain is read-only (set via a separate DNS
// verification flow not yet implemented).
//
// Endpoints:
//   GET  /settings   → { settings: { currency, language, custom_domain, primary_color, parent_company } }
//   PUT  /settings   { currency, language, primary_color, parent_company }

const CURRENCIES = [
  { code: "NGN", label: "₦ Nigerian Naira (NGN)" },
  { code: "GHS", label: "₲ Ghanaian Cedi (GHS)" },
  { code: "KES", label: "K Kenyan Shilling (KES)" },
  { code: "ZAR", label: "R South African Rand (ZAR)" },
  { code: "USD", label: "$ US Dollar (USD)" },
];

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "yo", label: "Yoruba" },
  { code: "ig", label: "Igbo" },
  { code: "ha", label: "Hausa" },
  { code: "fr", label: "French" },
];

const DEFAULT_COLOR = "#14213D";

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [currency, setCurrency] = useState("NGN");
  const [language, setLanguage] = useState("en");
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_COLOR);
  const [parentCompany, setParentCompany] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = () => {
    setError("");
    api.get("/settings")
      .then((d) => {
        const s = d.settings || {};
        setSettings(s);
        setCurrency(s.currency || "NGN");
        setLanguage(s.language || "en");
        setPrimaryColor(s.primary_color || DEFAULT_COLOR);
        setParentCompany(s.parent_company || "");
        setCustomDomain(s.custom_domain || "");
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      await api.put("/settings", {
        currency,
        language,
        primary_color: primaryColor,
        parent_company: parentCompany,
      });
      setNotice("Settings saved.");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="page-intro">
        Customise regional defaults and white-label branding for your school.
        Currency affects how amounts are displayed across Ledgerly.
      </p>

      {error && <div className="form-error">{error}</div>}
      {notice && (
        <div className="form-error" style={{ background: "#E7F3EC", color: "#1B7A43", borderColor: "#C5E0CF" }}>
          {notice}
        </div>
      )}

      {!settings && !error && <div className="page-loading">Loading settings…</div>}

      {settings && (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-title">Regional defaults</div>

            <label htmlFor="settings-currency">Currency</label>
            <select id="settings-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
            <div className="field-hint">Display currency for amounts throughout the app.</div>

            <label htmlFor="settings-language">Language</label>
            <select id="settings-language" name="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <div className="field-hint">UI language preference (English is fully translated; others are partial).</div>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-title">White-label branding</div>

            <label htmlFor="settings-primary-color">Primary color</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input
                id="settings-primary-color"
                name="primaryColor"
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                style={{ width: 56, height: 44, padding: 4, cursor: "pointer" }}
                aria-label="Primary color picker"
              />
              <input
                id="settings-primary-color-hex"
                name="primaryColorHex"
                value={primaryColor}
                onChange={(e) => {
                  let v = e.target.value;
                  if (v && !v.startsWith("#")) v = "#" + v;
                  setPrimaryColor(v.toUpperCase());
                }}
                style={{ flex: 1, maxWidth: 200, fontFamily: "monospace" }}
                placeholder="#14213D"
                maxLength={7}
                autoComplete="off"
                aria-label="Primary color hex value"
              />
              <button
                className="btn-ghost"
                onClick={() => setPrimaryColor(DEFAULT_COLOR)}
                style={{ padding: "8px 12px", fontSize: 13 }}
              >
                Reset
              </button>
            </div>
            <div className="field-hint">Used on receipts and the parent portal header. Hex format #RRGGBB.</div>

            <label htmlFor="settings-parent-company">Parent company</label>
            <input
              id="settings-parent-company"
              name="parentCompany"
              value={parentCompany}
              onChange={(e) => setParentCompany(e.target.value)}
              placeholder="e.g. Acme Education Holdings"
              maxLength={200}
              autoComplete="organization"
            />
            <div className="field-hint">Optional. Shown as the operating company on receipts and invoices.</div>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-title">Custom domain</div>
            <label htmlFor="settings-domain">Domain</label>
            <input
              id="settings-domain"
              name="customDomain"
              value={customDomain}
              readOnly
              placeholder="Not configured"
              style={{ background: "#FBFBF9", color: "#5B5B54" }}
              autoComplete="off"
            />
            <div className="field-hint">
              Read-only. Custom domains are configured via DNS verification —
              contact support to set one up.
            </div>
          </div>

          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </button>
        </>
      )}
    </div>
  );
}
