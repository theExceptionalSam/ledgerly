import { useEffect, useState } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";
import { useTerm } from "../context/TermContext";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import TermSwitcher from "../components/TermSwitcher";

function StatCard({ label, value, accent, sub, icon }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{icon} {label}</div>
      <div className="stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ProgressBar({ label, value, max, color, unit = "₦" }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)" }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: color || "var(--navy)" }}>
          {unit === "₦" ? naira(value) : value}{unit !== "₦" ? unit : ""} ({pct}%)
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color || undefined }} />
      </div>
    </div>
  );
}

function QuickAction({ icon, label, onClick, accent }) {
  return (
    <button className="quick-action-btn" onClick={onClick} style={accent ? { borderColor: accent, color: accent } : undefined}>
      <span className="quick-action-icon">{icon}</span>
      <span className="quick-action-label">{label}</span>
    </button>
  );
}

function NeedsAttentionItem({ icon, message, action, actionLabel, severity }) {
  const colors = {
    high: { bg: "#FBEAE9", border: "#B3261E", text: "#B3261E" },
    medium: { bg: "#FBF0E2", border: "#C77D22", text: "#C77D22" },
    low: { bg: "#E4EFF4", border: "#14213D", text: "#14213D" },
  };
  const c = colors[severity] || colors.medium;
  return (
    <div className="needs-attention-item" style={{ background: c.bg, borderColor: c.border }}>
      <div className="needs-attention-icon" style={{ color: c.text }}>{icon}</div>
      <div className="needs-attention-body">
        <div className="needs-attention-msg" style={{ color: c.text }}>{message}</div>
        {action && actionLabel && (
          <button className="needs-attention-action" onClick={action} style={{ color: c.text }}>
            {actionLabel} →
          </button>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { selectedTermId, selectedTerm, terms } = useTerm();
  const [totals, setTotals] = useState(null);
  const [error, setError] = useState("");
  const [students, setStudents] = useState(null);
  const [feeHeads, setFeeHeads] = useState(null);

  const canEdit = ["owner", "bursar", "accountant"].includes(user?.role);
  const isOwner = user?.role === "owner";

  useEffect(() => {
    if (!selectedTermId) { setTotals(null); return; }
    setError("");
    api.get(`/dashboard?termId=${selectedTermId}`).then(setTotals).catch((e) => setError(e.message));
    // Also load student count + fee heads for "needs attention"
    api.get(`/students?pageSize=1`).then((d) => setStudents(d.total || 0)).catch(() => setStudents(0));
    api.get(`/fee-heads`).then((d) => setFeeHeads(d.feeHeads || [])).catch(() => setFeeHeads([]));
  }, [selectedTermId]);

  const collectionRate = totals && totals.expected > 0 ? Math.round((totals.collected / totals.expected) * 100) : 0;
  const onboardingDone = localStorage.getItem("ledgerly_onboarding_done");
  const needsOnboarding = !onboardingDone && students === 0;

  // Build "Needs Attention" items
  const attentionItems = [];
  if (needsOnboarding) {
    attentionItems.push({ severity: "high", icon: "🎯", message: "Welcome! Let's set up your school. Add your first student to get started.", action: () => navigate("/onboarding"), actionLabel: "Start onboarding" });
  }
  if (terms.length === 0) {
    attentionItems.push({ severity: "high", icon: "📅", message: "No terms created yet. Create a term to start tracking fees.", action: () => navigate("/sessions"), actionLabel: "Create a term" });
  }
  if (feeHeads && feeHeads.length === 0 && students > 0) {
    attentionItems.push({ severity: "medium", icon: "💰", message: "No fee heads set up. Create fee heads (tuition, feeding, etc.) to assign to students.", action: () => navigate("/fee-heads"), actionLabel: "Create fee heads" });
  }
  if (totals && totals.outstanding > 0 && collectionRate < 50) {
    attentionItems.push({ severity: "medium", icon: "⚠️", message: `${collectionRate}% collected — ${naira(totals.outstanding)} still outstanding. Send reminders to parents.`, action: () => navigate("/students"), actionLabel: "View outstanding" });
  }
  if (isOwner && totals && totals.collected > 0) {
    attentionItems.push({ severity: "low", icon: "📊", message: "Check your end-of-day reconciliation to verify today's collections.", action: () => navigate("/reconciliation"), actionLabel: "Run reconciliation" });
  }

  return (
    <div>
      <TermSwitcher />

      {error && <div className="form-error">{error}</div>}

      {!selectedTermId && (
        <div className="empty-state">
          <strong>No term selected.</strong><br />
          {terms.length === 0 ? "Create your first term to start tracking fees." : "Select a term from the dropdown above."}
        </div>
      )}

      {/* Needs Attention */}
      {attentionItems.length > 0 && (
        <div className="card needs-attention-card">
          <div className="card-title">📋 Needs Attention</div>
          <div className="needs-attention-list">
            {attentionItems.map((item, i) => (
              <NeedsAttentionItem key={i} {...item} />
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      {selectedTermId && canEdit && (
        <div className="card quick-actions-card">
          <div className="card-title">⚡ Quick Actions</div>
          <div className="quick-actions-grid">
            <QuickAction icon="👤" label="Add student" onClick={() => navigate("/students")} />
            <QuickAction icon="💳" label="Record payment" onClick={() => navigate("/students")} />
            <QuickAction icon="🧾" label="View receipts" onClick={() => navigate("/receipts")} accent="#1B7A43" />
            <QuickAction icon="📊" label="End-of-day" onClick={() => navigate("/reconciliation")} accent="#14213D" />
            {isOwner && <QuickAction icon="📈" label="Aged debtors" onClick={() => navigate("/aged-debtors")} accent="#C77D22" />}
            {isOwner && <QuickAction icon="🔄" label="Reversals" onClick={() => navigate("/reversals")} accent="#B3261E" />}
          </div>
        </div>
      )}

      {selectedTermId && !totals && !error && <div className="page-loading">Loading dashboard…</div>}

      {selectedTermId && totals && (
        <>
          {/* Collection progress bar */}
          <div className="card">
            <div className="progress-header">
              <span>Fee Collection Progress</span>
              <strong style={{ fontSize: 18 }}>{collectionRate}%</strong>
            </div>
            <div className="progress-track" style={{ height: 16 }}>
              <div className="progress-fill" style={{ width: `${collectionRate}%`, background: collectionRate >= 80 ? "#1B7A43" : collectionRate >= 50 ? "#C77D22" : "#B3261E" }} />
            </div>
            <div className="progress-footer">
              <span>✅ Collected {naira(totals.collected)}</span>
              <span>🎯 Expected {naira(totals.expected)}</span>
            </div>
          </div>

          {/* Key metrics */}
          <div className="stat-grid">
            <StatCard label="Collected" value={naira(totals.collected)} accent="#1B7A43" icon="✅" sub={`${collectionRate}% of expected`} />
            <StatCard label="Outstanding" value={naira(totals.outstanding)} accent="#B3261E" icon="⏳" sub="Fees yet to be paid" />
            <StatCard label="Students" value={totals.studentCount} icon="👥" sub={`${totals.fullyPaid} fully paid`} />
            <StatCard label="Net position" value={naira(totals.netPosition)} accent={totals.netPosition >= 0 ? "#1B7A43" : "#B3261E"} icon="💰" sub="Income minus expenditure" />
          </div>

          {/* Payment status breakdown */}
          <div className="card">
            <div className="card-title">Payment Status Breakdown</div>
            <ProgressBar label="Fully paid" value={totals.fullyPaid} max={totals.studentCount} color="#1B7A43" unit=" students" />
            <ProgressBar label="Partial payment" value={totals.partial} max={totals.studentCount} color="#C77D22" unit=" students" />
            <ProgressBar label="Outstanding (no payment)" value={totals.fullyOutstanding} max={totals.studentCount} color="#B3261E" unit=" students" />
          </div>

          {/* School finances */}
          <div className="card">
            <div className="card-title">School Finances</div>
            <div className="finance-row"><span>📊 Fees collected</span><span style={{ fontWeight: 700, color: "#1B7A43" }}>{naira(totals.collected)}</span></div>
            <div className="finance-row"><span>📈 Other income</span><span style={{ fontWeight: 700 }}>{naira(totals.otherIncome)}</span></div>
            <div className="finance-row"><span>📉 Expenditure</span><span style={{ fontWeight: 700, color: "#B3261E" }}>-{naira(totals.expenditure)}</span></div>
            <div className="divider" />
            <div className="finance-row"><span><strong>Net position</strong></span><span style={{ fontWeight: 800, color: totals.netPosition >= 0 ? "#1B7A43" : "#B3261E" }}>{naira(totals.netPosition)}</span></div>
          </div>
        </>
      )}
    </div>
  );
}
