import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";

// Branding settings — owner-only page for tenant receipt branding.
//   GET    /branding           → { branding: { name, logo_path, receipt_footer } }
//   POST   /branding/logo      → multipart upload (field name "logo"), returns { logoPath }
//   PUT    /branding/footer    → { footer: string }
//
// The API base is the same Vite env var; logos are served from
// `${API_BASE}`-hosted static files (or relative paths). We use the
// api client's refresh-aware upload() and download-aware inline rendering.

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api/v1";

// Backend stores logo_path as a root-relative path like "/data/logos/<tenant>.png".
// Build an absolute URL we can use as an <img src>. If the API is on a different
// origin (dev mode), prepend it; otherwise the relative path resolves naturally.
function logoUrl(logoPath) {
  if (!logoPath) return "";
  if (/^https?:\/\//i.test(logoPath)) return logoPath;
  if (logoPath.startsWith("/")) {
    // Strip /api/v1 from the API base if present (logos are not under /api/v1)
    const origin = API_BASE.replace(/\/api\/v1\/?$/, "");
    return origin + logoPath;
  }
  return logoPath;
}

export default function BrandingSettings() {
  const [branding, setBranding] = useState(null);
  const [footer, setFooter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingFooter, setSavingFooter] = useState(false);
  const fileRef = useRef(null);

  const load = () => {
    setError("");
    api.get("/branding")
      .then((d) => {
        setBranding(d.branding || {});
        setFooter(d.branding?.receipt_footer || "");
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(); }, []);

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 2 MB limit matches the backend multer config
    if (file.size > 2 * 1024 * 1024) {
      setError("Logo must be under 2 MB.");
      return;
    }
    setUploading(true); setError(""); setNotice("");
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const res = await api.upload("/branding/logo", fd);
      setBranding((b) => ({ ...(b || {}), logo_path: res.logoPath }));
      setNotice("Logo uploaded.");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const saveFooter = async () => {
    setSavingFooter(true); setError(""); setNotice("");
    try {
      await api.put("/branding/footer", { footer });
      setBranding((b) => ({ ...(b || {}), receipt_footer: footer }));
      setNotice("Receipt footer saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingFooter(false);
    }
  };

  const currentLogo = branding?.logo_path ? logoUrl(branding.logo_path) : "";

  return (
    <div>
      <p className="page-intro">
        Customise your school's branding on printed and PDF receipts. Logo appears on the
        receipt header; footer text appears at the bottom of every receipt.
      </p>

      {error && <div className="form-error">{error}</div>}
      {notice && (
        <div className="form-error" style={{ background: "#E7F3EC", color: "#1B7A43", borderColor: "#C5E0CF" }}>
          {notice}
        </div>
      )}

      {!branding && !error && <div className="page-loading">Loading branding…</div>}

      {branding && (
        <>
          {/* Logo upload + preview */}
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-title">School logo</div>
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <div
                style={{
                  width: 96, height: 96, borderRadius: 12,
                  border: "1px solid #E3E2DC", background: "#FBFBF9",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden", flexShrink: 0,
                }}
              >
                {currentLogo ? (
                  <img src={currentLogo} alt="School logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: 12, color: "#8A8A82", textAlign: "center", padding: 8 }}>No logo</span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <input
                  ref={fileRef}
                  id="branding-logo-file"
                  name="logo"
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={handleLogoChange}
                  disabled={uploading}
                />
                <div className="field-hint">
                  PNG, JPG, GIF, or WebP. Max 2 MB. Square images look best on receipts.
                </div>
                {branding.name && (
                  <div className="field-hint" style={{ marginTop: 6 }}>
                    Current school: <strong>{branding.name}</strong>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Receipt footer text */}
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-title">Receipt footer text</div>
            <label htmlFor="branding-footer">Footer message (shown at the bottom of every receipt)</label>
            <textarea
              id="branding-footer"
              name="footer"
              rows={3}
              maxLength={200}
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
              placeholder="e.g. Thank you for your payment. For queries, contact the bursar's office."
            />
            <div className="field-hint">{footer.length}/200 characters</div>
            <button
              className="btn-primary"
              onClick={saveFooter}
              disabled={savingFooter}
              style={{ marginTop: 12 }}
            >
              {savingFooter ? "Saving…" : "Save footer"}
            </button>
          </div>

          {/* Receipt preview */}
          <div className="card">
            <div className="card-title">Receipt preview</div>
            <div
              style={{
                border: "1px dashed #E3E2DC", borderRadius: 12, padding: 20,
                background: "#FBFBF9", maxWidth: 420,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                {currentLogo && (
                  <img src={currentLogo} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} />
                )}
                <div>
                  <div style={{ fontWeight: 800, color: "#14213D", fontFamily: '"Newsreader", Georgia, serif' }}>
                    {branding.name || "Your school"}
                  </div>
                  <div style={{ fontSize: 12, color: "#5B5B54" }}>Official receipt</div>
                </div>
              </div>
              <div style={{ fontSize: 13, color: "#5B5B54", marginBottom: 12 }}>
                Payment of <strong style={{ color: "#14213D" }}>{naira(50000)}</strong> received with thanks.
              </div>
              <div style={{ borderTop: "1px solid #E3E2DC", paddingTop: 10, fontSize: 12, color: "#5B5B54", fontStyle: "italic" }}>
                {footer || "Footer text will appear here."}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
