import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT",
  "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi",
  "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo",
  "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
];

const CLASS_LIST = [
  "Creche", "Nursery 1", "Nursery 2",
  "Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6",
  "JSS 1", "JSS 2", "JSS 3",
  "SS 1", "SS 2", "SS 3",
];

export default function SchoolKyc() {
  const navigate = useNavigate();
  const { completeKyc } = useAuth();
  const [form, setForm] = useState({
    school_type: "", education_level: "", year_established: "", school_motto: "",
    address: "", lga: "", state: "", school_email: "", school_website: "",
    registration_number: "", registration_type: "", tax_id: "",
    student_count_estimate: "", staff_count: "", calendar_type: "3-term",
    classes_offered: [],
    tos_accepted: false, privacy_accepted: false, signature: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (key) => (e) => {
    const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: val }));
  };

  const toggleClass = (cls) => {
    setForm((f) => {
      const arr = f.classes_offered.includes(cls)
        ? f.classes_offered.filter((c) => c !== cls)
        : [...f.classes_offered, cls];
      return { ...f, classes_offered: arr };
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.tos_accepted || !form.privacy_accepted) {
      setError("You must accept the Terms of Service and Privacy Policy to continue.");
      return;
    }
    if (form.classes_offered.length === 0) {
      setError("Please select at least one class your school offers.");
      return;
    }

    setBusy(true);
    try {
      await completeKyc({
        ...form,
        classes_offered: form.classes_offered.join(","),
        student_count_estimate: Number(form.student_count_estimate),
        staff_count: form.staff_count ? Number(form.staff_count) : null,
        tos_accepted: String(form.tos_accepted),
        privacy_accepted: String(form.privacy_accepted),
      });
      navigate("/dashboard");
    } catch (err) {
      setError(err.details ? err.details.map((d) => d.message).join(" · ") : err.message);
    } finally {
      setBusy(false);
    }
  };

  const inputCls = "form-input";
  const labelCls = "form-label";

  return (
    <div className="auth-page" role="main" style={{ alignItems: "flex-start", padding: "20px" }}>
      <form className="auth-card" onSubmit={submit} style={{ maxWidth: 640, width: "100%" }}>
        <div className="auth-logo-block">
          <img src="/ledgerly-logo-dark.jpg" alt="Ledgerly" className="auth-wordmark" width="180" height="52" fetchpriority="high" />
        </div>
        <h1>Complete Your School Registration</h1>
        <p className="auth-sub">This information is required before you can start using Ledgerly. It helps us verify your school and comply with Nigerian data protection regulations.</p>

        {error && <div className="form-error">{error}</div>}

        {/* Section 1: School Identity */}
        <div style={{ marginTop: 24, marginBottom: 8, fontWeight: 700, color: "var(--navy)", fontSize: 16, borderBottom: "2px solid var(--green)", paddingBottom: 6 }}>School Identity</div>

        <label className={labelCls} htmlFor="kyc-school-type">School type *</label>
        <select id="kyc-school-type" name="school_type" className={inputCls} value={form.school_type} onChange={update("school_type")} required>
          <option value="">— Select —</option>
          <option value="day">Day school</option>
          <option value="boarding">Boarding school</option>
          <option value="mixed">Mixed (Day + Boarding)</option>
        </select>

        <label className={labelCls} htmlFor="kyc-edu-level">Education level *</label>
        <select id="kyc-edu-level" name="education_level" className={inputCls} value={form.education_level} onChange={update("education_level")} required>
          <option value="">— Select —</option>
          <option value="nursery">Nursery / Creche</option>
          <option value="primary">Primary</option>
          <option value="secondary">Secondary</option>
          <option value="mixed">Mixed (Nursery + Primary + Secondary)</option>
        </select>

        <label className={labelCls} htmlFor="kyc-year">Year established *</label>
        <input id="kyc-year" name="year_established" className={inputCls} type="text" placeholder="e.g. 2005" maxLength={4} pattern="\d{4}" value={form.year_established} onChange={update("year_established")} required />

        <label className={labelCls} htmlFor="kyc-motto">School motto (optional)</label>
        <input id="kyc-motto" name="school_motto" className={inputCls} type="text" placeholder="e.g. Knowledge is Power" value={form.school_motto} onChange={update("school_motto")} />

        {/* Section 2: Location & Contact */}
        <div style={{ marginTop: 24, marginBottom: 8, fontWeight: 700, color: "var(--navy)", fontSize: 16, borderBottom: "2px solid var(--green)", paddingBottom: 6 }}>Location & Contact</div>

        <label className={labelCls} htmlFor="kyc-address">Full school address *</label>
        <textarea id="kyc-address" name="address" className={inputCls} placeholder="House number, street name, town/city" rows={2} value={form.address} onChange={update("address")} required />

        <label className={labelCls} htmlFor="kyc-lga">Local Government Area *</label>
        <input id="kyc-lga" name="lga" className={inputCls} type="text" placeholder="e.g. Surulere" value={form.lga} onChange={update("lga")} required />

        <label className={labelCls} htmlFor="kyc-state">State *</label>
        <select id="kyc-state" name="state" className={inputCls} value={form.state} onChange={update("state")} required>
          <option value="">— Select state —</option>
          {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <label className={labelCls} htmlFor="kyc-school-email">School email (optional)</label>
        <input id="kyc-school-email" name="school_email" className={inputCls} type="email" placeholder="info@yourschool.com" value={form.school_email} onChange={update("school_email")} />

        <label className={labelCls} htmlFor="kyc-website">School website (optional)</label>
        <input id="kyc-website" name="school_website" className={inputCls} type="url" placeholder="https://yourschool.com" value={form.school_website} onChange={update("school_website")} />

        {/* Section 3: Regulatory */}
        <div style={{ marginTop: 24, marginBottom: 8, fontWeight: 700, color: "var(--navy)", fontSize: 16, borderBottom: "2px solid var(--green)", paddingBottom: 6 }}>Regulatory & Verification</div>

        <label className={labelCls} htmlFor="kyc-reg-no">School registration number *</label>
        <input id="kyc-reg-no" name="registration_number" className={inputCls} type="text" placeholder="e.g. RC123456 or MOE/LG/2020/001" value={form.registration_number} onChange={update("registration_number")} required />
        <div className="field-hint">Your CAC, Ministry of Education, or LGEA registration number.</div>

        <label className={labelCls} htmlFor="kyc-reg-type">Registration type *</label>
        <select id="kyc-reg-type" name="registration_type" className={inputCls} value={form.registration_type} onChange={update("registration_type")} required>
          <option value="">— Select —</option>
          <option value="cac">CAC (Corporate Affairs Commission)</option>
          <option value="ministry">Ministry of Education</option>
          <option value="private">Private (unregistered)</option>
          <option value="mission">Mission / Faith-based</option>
          <option value="government">Government / Public</option>
        </select>

        <label className={labelCls} htmlFor="kyc-tax">Tax ID / TIN (optional)</label>
        <input id="kyc-tax" name="tax_id" className={inputCls} type="text" placeholder="e.g. 12345678-0001" value={form.tax_id} onChange={update("tax_id")} />

        {/* Section 4: Operational */}
        <div style={{ marginTop: 24, marginBottom: 8, fontWeight: 700, color: "var(--navy)", fontSize: 16, borderBottom: "2px solid var(--green)", paddingBottom: 6 }}>Operational Details</div>

        <label className={labelCls} htmlFor="kyc-student-count">Approximate student count *</label>
        <input id="kyc-student-count" name="student_count_estimate" className={inputCls} type="number" min="1" max="100000" placeholder="e.g. 200" value={form.student_count_estimate} onChange={update("student_count_estimate")} required />

        <label className={labelCls} htmlFor="kyc-staff-count">Number of staff (optional)</label>
        <input id="kyc-staff-count" name="staff_count" className={inputCls} type="number" min="0" placeholder="e.g. 15" value={form.staff_count} onChange={update("staff_count")} />

        <label className={labelCls} htmlFor="kyc-calendar">Academic calendar *</label>
        <select id="kyc-calendar" name="calendar_type" className={inputCls} value={form.calendar_type} onChange={update("calendar_type")} required>
          <option value="3-term">3-term (Nigerian standard)</option>
          <option value="semester">Semester system</option>
          <option value="other">Other</option>
        </select>

        <label className={labelCls}>Classes offered *</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {CLASS_LIST.map((cls) => (
            <label key={cls} className="checkbox-row" style={{ fontSize: 13, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>
              <input type="checkbox" checked={form.classes_offered.includes(cls)} onChange={() => toggleClass(cls)} />
              {cls}
            </label>
          ))}
        </div>

        {/* Section 5: Agreement */}
        <div style={{ marginTop: 24, marginBottom: 8, fontWeight: 700, color: "var(--navy)", fontSize: 16, borderBottom: "2px solid var(--green)", paddingBottom: 6 }}>Agreement</div>

        <label className="checkbox-row" style={{ marginBottom: 8 }}>
          <input type="checkbox" checked={form.tos_accepted} onChange={update("tos_accepted")} />
          I accept the <Link to="/terms" target="_blank" style={{ color: "var(--navy)", fontWeight: 600 }}>Terms of Service</Link>
        </label>

        <label className="checkbox-row" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={form.privacy_accepted} onChange={update("privacy_accepted")} />
          I accept the <Link to="/privacy" target="_blank" style={{ color: "var(--navy)", fontWeight: 600 }}>Privacy Policy</Link>
        </label>

        <label className={labelCls} htmlFor="kyc-signature">Type your full name as digital signature *</label>
        <input id="kyc-signature" name="signature" className={inputCls} type="text" placeholder="e.g. John Doe" value={form.signature} onChange={update("signature")} required />
        <div className="field-hint">By typing your name, you confirm that the information provided is accurate and complete.</div>

        <button type="submit" className="btn-primary btn-full" disabled={busy} style={{ marginTop: 20 }}>
          {busy ? "Saving..." : "Complete Registration →"}
        </button>
      </form>
    </div>
  );
}
