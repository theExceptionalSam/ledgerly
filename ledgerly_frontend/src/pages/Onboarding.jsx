import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useTerm } from "../context/TermContext";

// Onboarding wizard — shown when a new school has 0 students.
//
// The backend auto-creates a session, three terms, and seven fee heads at
// registration (see auth.controller.js registerSchool). This wizard walks the
// owner through the first 30 seconds of using Ledgerly: confirms those seeded
// records, then captures the first student + first fee assignment, and ends
// with quick links to the rest of the app.
//
// Completion is tracked in localStorage so we don't re-show the wizard after
// the owner dismisses it. Re-showing is possible by clearing that key.

const CLASS_LIST = [
  "Creche", "Nursery 1", "Nursery 2",
  "Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6",
  "JSS 1", "JSS 2", "JSS 3",
  "SS 1", "SS 2", "SS 3",
];

const DONE_KEY = "ledgerly_onboarding_done";

export default function Onboarding() {
  const navigate = useNavigate();
  const { terms, selectedTermId, reload: reloadTerms } = useTerm();
  const [step, setStep] = useState(1);
  const [feeHeads, setFeeHeads] = useState([]);
  const [studentCount, setStudentCount] = useState(null);
  const [newStudent, setNewStudent] = useState(null); // { id, name, class } after step 3
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);

  // Gate: only show the wizard to schools with 0 students AND no localStorage completion flag.
  useEffect(() => {
    if (localStorage.getItem(DONE_KEY)) {
      navigate("/", { replace: true });
      return;
    }
    api.get("/students?pageSize=1")
      .then((d) => {
        const count = d.total ?? d.students?.length ?? 0;
        setStudentCount(count);
        if (count > 0) {
          // Already has students — no need for onboarding.
          localStorage.setItem(DONE_KEY, "1");
          navigate("/", { replace: true });
        }
      })
      .catch(() => { /* stay on page — let owner proceed */ })
      .finally(() => setChecking(false));
    api.get("/fee-heads").then((d) => setFeeHeads(d.feeHeads || [])).catch(() => {});
    reloadTerms();
  }, [navigate, reloadTerms]);

  const finish = useCallback(() => {
    localStorage.setItem(DONE_KEY, "1");
    navigate("/", { replace: true });
  }, [navigate]);

  const skip = () => {
    // Skip advances but doesn't mark as done — unless we're on the last step.
    if (step >= 5) finish();
    else setStep(step + 1);
  };

  if (checking) return <div className="page-loading">Loading onboarding…</div>;

  const currentTerm = terms.find((t) => t.is_current) || terms[0] || null;

  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        <ProgressBar step={step} />

        <div className="onboarding-step-header">
          <div className="onboarding-step-count">Step {step} of 5</div>
          <button className="link-btn" onClick={skip}>
            {step >= 5 ? "Finish" : "Skip"} →
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        {step === 1 && (
          <Step1Term term={currentTerm} onNext={() => setStep(2)} />
        )}
        {step === 2 && (
          <Step2FeeHeads feeHeads={feeHeads} onNext={() => setStep(3)} onBack={() => setStep(1)} />
        )}
        {step === 3 && (
          <Step3AddStudent
            termId={selectedTermId || currentTerm?.id}
            onCreated={(s) => { setNewStudent(s); setStep(4); }}
            onBack={() => setStep(2)}
            onError={setError}
          />
        )}
        {step === 4 && (
          <Step4AssignFees
            student={newStudent}
            feeHeads={feeHeads}
            termId={selectedTermId || currentTerm?.id}
            onNext={() => setStep(5)}
            onBack={() => setStep(3)}
            onError={setError}
          />
        )}
        {step === 5 && <Step5Done onFinish={finish} />}
      </div>
    </div>
  );
}

function ProgressBar({ step }) {
  const pct = (step / 5) * 100;
  return (
    <div className="progress-header" style={{ marginBottom: 4 }}>
      <span>Onboarding</span>
      <strong>{pct}%</strong>
    </div>
  );
}

/* --------------------------- Step 1: Term --------------------------- */

function Step1Term({ term, onNext }) {
  return (
    <div>
      <h1>Your term is ready 🎉</h1>
      <p className="page-intro">
        We've created your first academic session and three terms automatically. You're currently
        billing against the term below — switch any time from the term selector at the top of the
        Dashboard, Students, and Finance pages.
      </p>
      <div className="card" style={{ background: "#F0F4FA", borderColor: "#D5DDE8" }}>
        <div className="finance-row"><span>Session</span><span>{term?.session_name || "First Session"}</span></div>
        <div className="finance-row"><span>Current term</span><span>{term?.name || "First Term"}</span></div>
        <div className="finance-row"><span>Terms available</span><span>First Term · Second Term · Third Term</span></div>
      </div>
      <button className="btn-primary btn-full" onClick={onNext}>Continue →</button>
    </div>
  );
}

/* ------------------------- Step 2: Fee heads ------------------------- */

function Step2FeeHeads({ feeHeads, onNext, onBack }) {
  return (
    <div>
      <h1>Your fee heads</h1>
      <p className="page-intro">
        Fee heads are the chargeable items on a student's bill — we've pre-loaded the seven most
        common ones for Nigerian schools. Add or remove any of them later from the Fee Heads page.
      </p>
      <div className="list">
        {feeHeads.length === 0 && <div className="empty-state" style={{ padding: 16 }}>Loading fee heads…</div>}
        {feeHeads.map((h) => (
          <div key={h.id} className="list-item">
            <div className="list-item-row">
              <div className="list-item-main">
                <div className="list-item-title">{h.name}</div>
              </div>
              <span className="badge" style={{ color: "#1B7A43", background: "#E7F4EC" }}>Ready</span>
            </div>
          </div>
        ))}
      </div>
      <div className="action-row">
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn-primary" style={{ flex: 1 }} onClick={onNext}>Continue →</button>
      </div>
    </div>
  );
}

/* ----------------------- Step 3: Add student ----------------------- */

function Step3AddStudent({ termId, onCreated, onBack, onError }) {
  const [name, setName] = useState("");
  const [klass, setKlass] = useState(CLASS_LIST[3]); // Primary 1
  const [admissionNo, setAdmissionNo] = useState("");
  const [guardianContact, setGuardianContact] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); onError("");
    try {
      const data = await api.post("/students", {
        name: name.trim(),
        class: klass,
        admissionNo: admissionNo.trim(),
        guardianContact: guardianContact.trim(),
      });
      onCreated({ id: data.id, name: name.trim(), class: klass });
    } catch (err) {
      onError(err.details ? err.details.map((d) => d.message).join(" · ") : err.message);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <h1>Add your first student</h1>
      <p className="page-intro">
        Let's add a student so we can show you how fees work. You can bulk-upload the rest of your
        school from the Students page later.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="onboarding-student-name">Full name</label>
        <input id="onboarding-student-name" name="studentName" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amaka Johnson" autoFocus autoComplete="name" />
        <label htmlFor="onboarding-student-class">Class</label>
        <select id="onboarding-student-class" name="class" value={klass} onChange={(e) => setKlass(e.target.value)}>
          {CLASS_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label htmlFor="onboarding-student-admission-no">Admission number (optional)</label>
        <input id="onboarding-student-admission-no" name="admissionNo" value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} autoComplete="off" />
        <label htmlFor="onboarding-student-guardian-contact">Parent phone (optional)</label>
        <input id="onboarding-student-guardian-contact" name="guardianContact" value={guardianContact} onChange={(e) => setGuardianContact(e.target.value)} placeholder="e.g. 0803 123 4567" inputMode="tel" autoComplete="tel" />
        <div className="action-row">
          <button type="button" className="btn-ghost" onClick={onBack}>← Back</button>
          <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={busy || !name.trim()}>
            {busy ? "Adding..." : "Add student →"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------------- Step 4: Assign fees ---------------------- */

function Step4AssignFees({ student, feeHeads, termId, onNext, onBack, onError }) {
  const [assignments, setAssignments] = useState(() => {
    // Default: Tuition pre-filled with a placeholder amount, others blank.
    const initial = {};
    feeHeads.forEach((h) => { initial[h.id] = ""; });
    return initial;
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const toAssign = feeHeads
      .filter((h) => assignments[h.id] && Number(assignments[h.id]) > 0)
      .map((h) => ({ feeHeadId: h.id, amount: Number(assignments[h.id]) }));
    if (toAssign.length === 0) {
      // Allow skipping fee assignment — just move on.
      onNext();
      return;
    }
    setBusy(true); onError("");
    try {
      for (const a of toAssign) {
        await api.post(`/students/${student.id}/fees`, {
          feeHeadId: a.feeHeadId,
          termId,
          expectedAmount: a.amount,
        });
      }
      onNext();
    } catch (err) {
      onError(err.message);
    } finally { setBusy(false); }
  };

  if (!student) {
    return (
      <div>
        <h1>Assign fees</h1>
        <div className="empty-state">No student to assign fees to. Go back and add one.</div>
        <button className="btn-ghost" onClick={onBack}>← Back</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Assign fees to {student.name}</h1>
      <p className="page-intro">
        Enter the expected amount for each fee head you want to bill this term. Leave blank any that
        don't apply. You can change these any time from the student's record.
      </p>
      <div className="table-wrapper">
      <table className="fee-table">
        <thead>
          <tr><th>Fee head</th><th className="num">Expected amount (₦)</th></tr>
        </thead>
        <tbody>
          {feeHeads.map((h) => (
            <tr key={h.id}>
              <td>{h.name}</td>
              <td className="num">
                <input
                  id={`onboarding-fee-${h.id}`}
                  name={`feeAmount-${h.id}`}
                  value={assignments[h.id]}
                  onChange={(e) => setAssignments((a) => ({ ...a, [h.id]: e.target.value.replace(/[^0-9.]/g, "") }))}
                  placeholder="0"
                  inputMode="decimal"
                  style={{ width: 140, textAlign: "right" }}
                  autoComplete="off"
                  aria-label={`Expected amount for ${h.name}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div className="action-row">
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn-primary" style={{ flex: 1 }} disabled={busy} onClick={submit}>
          {busy ? "Saving..." : "Save and continue →"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------- Step 5: Done ------------------------- */

function Step5Done({ onFinish }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 8 }}>✓</div>
      <h1>You're all set!</h1>
      <p className="page-intro">
        Your school is ready to start collecting fees. Here's where to go next:
      </p>
      <div className="stat-grid stat-grid-3" style={{ marginTop: 20 }}>
        <Link to="/" className="stat-card" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="stat-label">Dashboard</div>
          <div className="stat-value" style={{ fontSize: 18 }}>View collection summary</div>
        </Link>
        <Link to="/students" className="stat-card" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="stat-label">Students</div>
          <div className="stat-value" style={{ fontSize: 18 }}>Add more & record payments</div>
        </Link>
        <Link to="/reports" className="stat-card" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="stat-label">Reports</div>
          <div className="stat-value" style={{ fontSize: 18 }}>Generate term reports</div>
        </Link>
      </div>
      <button className="btn-primary btn-full" style={{ marginTop: 24 }} onClick={onFinish}>
        Go to dashboard →
      </button>
    </div>
  );
}
