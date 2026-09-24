import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";

const RISK_CATEGORIES = [
  { value: 'lower_fee_collection', label: 'Lower-than-expected fee collection' },
  { value: 'delayed_payments', label: 'Delayed fee payments' },
  { value: 'unexpected_repairs', label: 'Unexpected repairs' },
  { value: 'emergency_expenditure', label: 'Emergency expenditure' },
  { value: 'operating_cost_increase', label: 'Increase in operating costs' },
  { value: 'payroll_pressure', label: 'Payroll pressure' },
  { value: 'utility_cost_increase', label: 'Utility cost increases' },
  { value: 'supplier_price_increase', label: 'Supplier price increases' },
  { value: 'funding_shortfall', label: 'Funding shortfall' },
  { value: 'cashflow_shortage', label: 'Cash-flow shortage' },
  { value: 'unplanned_capex', label: 'Unplanned capital expenditure' },
  { value: 'other', label: 'Other' },
];

const SIGNAL_TYPES = [
  { value: 'collection_below_pct', label: 'Fee collection falls below %' },
  { value: 'cash_below_amount', label: 'Available cash falls below amount' },
  { value: 'outstanding_above_amount', label: 'Outstanding fees exceed amount' },
  { value: 'overdue_count', label: 'Number of overdue students exceeds' },
  { value: 'manual', label: 'Manual indicator (human evaluation)' },
];

const STATUS_META = {
  draft: { label: 'Draft', color: '#8A8A82', bg: '#EDECE6' },
  prepared: { label: 'Prepared', color: '#14213D', bg: '#E4EFF4' },
  monitoring: { label: 'Monitoring', color: '#C77D22', bg: '#FBF0E2' },
  triggered: { label: 'Triggered', color: '#B3261E', bg: '#FBEAE9' },
  active: { label: 'Active', color: '#B3261E', bg: '#FBEAE9' },
  under_review: { label: 'Under Review', color: '#C77D22', bg: '#FBF0E2' },
  resolved: { label: 'Resolved', color: '#1B7A43', bg: '#E6F4EA' },
  archived: { label: 'Archived', color: '#8A8A82', bg: '#EDECE6' },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.draft;
  return <span className="badge" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span>;
}

function PlanCard({ plan, onClick }) {
  const meta = STATUS_META[plan.status] || STATUS_META.draft;
  const exposure = plan.impact_estimate_max || plan.impact_estimate_min;
  return (
    <div className="list-item" onClick={onClick} style={{ cursor: 'pointer', borderLeft: `4px solid ${meta.color}` }}>
      <div className="list-item-row">
        <div className="list-item-main">
          <div className="list-item-title">{plan.title}</div>
          <div className="list-item-sub">
            <StatusBadge status={plan.status} />
            {' '}{RISK_CATEGORIES.find(c => c.value === plan.risk_category)?.label || plan.risk_category || 'Uncategorised'}
            {exposure && <span style={{ marginLeft: 8 }}>· Potential impact: {naira(exposure)}</span>}
          </div>
          {plan.review_date && (
            <div className="list-item-sub" style={{ marginTop: 2 }}>
              Review by: {plan.review_date}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          {plan.triggered_at && (
            <div className="list-item-sub" style={{ color: '#B3261E', fontWeight: 600 }}>
              Triggered {new Date(plan.triggered_at).toLocaleDateString('en-NG')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanForm({ plan, onSave, onCancel }) {
  const [form, setForm] = useState(plan || {
    title: '', risk_description: '', risk_category: '',
    impact_estimate_min: '', impact_estimate_max: '', impact_type: '', impact_duration_days: '',
    signal_type: '', signal_threshold_value: '', signal_description: '',
    trigger_type: '', trigger_value: '', trigger_description: '',
    response_actions: [], cost_adjustments: [], funding_sources: [],
    responsible_person: '', responsible_role: '', stakeholders: '', approval_authority: '',
    required_resources: {}, spending_limit: '', approval_threshold: '', spending_authority: '', escalation_point: '',
    expected_duration_days: '', start_date: '', review_date: '', max_sustainable_days: '',
    recovery_actions: [], recovery_target: '', recovery_responsible: '', recovery_review_date: '', recovery_conditions: '',
    status: 'draft',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionInput, setActionInput] = useState('');

  const update = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const addAction = () => {
    if (!actionInput.trim()) return;
    setForm(f => ({ ...f, response_actions: [...(f.response_actions || []), { action: actionInput.trim(), order: (f.response_actions || []).length + 1, done: false }] }));
    setActionInput('');
  };

  const removeAction = (i) => {
    setForm(f => ({ ...f, response_actions: f.response_actions.filter((_, idx) => idx !== i) }));
  };

  const addRecoveryAction = () => {
    if (!actionInput.trim()) return;
    setForm(f => ({ ...f, recovery_actions: [...(f.recovery_actions || []), actionInput.trim()] }));
    setActionInput('');
  };

  const submit = async () => {
    setError('');
    if (!form.title || form.title.length < 3) { setError('Title must be at least 3 characters.'); return; }
    if (!form.risk_description || form.risk_description.length < 10) { setError('Risk description must be at least 10 characters.'); return; }
    setBusy(true);
    try {
      await onSave(form);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const sectionStyle = { marginTop: 24, marginBottom: 8, fontWeight: 700, color: 'var(--navy)', fontSize: 16, borderBottom: '2px solid var(--green)', paddingBottom: 6 };

  return (
    <div className="card" style={{ maxWidth: 700 }}>
      {error && <div className="form-error">{error}</div>}

      <div style={sectionStyle}>1. Financial Risk — What could go wrong?</div>
      <label className="form-label" htmlFor="cp-title">Plan title *</label>
      <input id="cp-title" className="form-input" value={form.title} onChange={update('title')} placeholder="e.g. Fee collection drops below 60%" />
      <label className="form-label" htmlFor="cp-risk-desc">Risk description *</label>
      <textarea id="cp-risk-desc" className="form-input" rows={3} value={form.risk_description} onChange={update('risk_description')} placeholder="Describe the financial event that could negatively affect the school..." />
      <label className="form-label" htmlFor="cp-risk-cat">Risk category</label>
      <select id="cp-risk-cat" className="form-input" value={form.risk_category} onChange={update('risk_category')}>
        <option value="">— Select category —</option>
        {RISK_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>

      <div style={sectionStyle}>2. Financial Impact — How much could it affect the school?</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="form-label">Min estimate (₦)</label>
          <input className="form-input" type="number" value={form.impact_estimate_min} onChange={update('impact_estimate_min')} placeholder="e.g. 100000" inputMode="decimal" />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="form-label">Max estimate (₦)</label>
          <input className="form-input" type="number" value={form.impact_estimate_max} onChange={update('impact_estimate_max')} placeholder="e.g. 500000" inputMode="decimal" />
        </div>
      </div>
      <label className="form-label">Impact type</label>
      <select className="form-input" value={form.impact_type} onChange={update('impact_type')}>
        <option value="">— Select —</option>
        <option value="loss">Loss</option>
        <option value="additional_expense">Additional expense</option>
        <option value="delayed_income">Delayed income</option>
        <option value="cashflow_gap">Cash-flow gap</option>
      </select>
      <label className="form-label">Expected duration (days)</label>
      <input className="form-input" type="number" value={form.impact_duration_days} onChange={update('impact_duration_days')} placeholder="e.g. 30" />

      <div style={sectionStyle}>3. Warning Signal — How will we know there is a problem?</div>
      <label className="form-label">Signal type</label>
      <select className="form-input" value={form.signal_type} onChange={update('signal_type')}>
        <option value="">— Select —</option>
        {SIGNAL_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      {(form.signal_type && form.signal_type !== 'manual') && (
        <>
          <label className="form-label">Threshold value {form.signal_type.includes('pct') ? '(%)' : '(₦ or count)'}</label>
          <input className="form-input" type="number" value={form.signal_threshold_value} onChange={update('signal_threshold_value')} placeholder={form.signal_type.includes('pct') ? 'e.g. 60' : 'e.g. 2000000'} />
          <div className="field-hint">The system will auto-trigger this plan when the threshold is reached.</div>
        </>
      )}
      <label className="form-label">Signal description</label>
      <textarea className="form-input" rows={2} value={form.signal_description} onChange={update('signal_description')} placeholder="Describe the warning sign in plain language..." />

      <div style={sectionStyle}>4. Trigger Point — When should we activate the plan?</div>
      <label className="form-label">Trigger type</label>
      <select className="form-input" value={form.trigger_type} onChange={update('trigger_type')}>
        <option value="">— Select —</option>
        <option value="amount">Amount</option>
        <option value="percentage">Percentage</option>
        <option value="date">Date</option>
        <option value="deadline">Deadline</option>
        <option value="balance">Balance</option>
        <option value="overdue_count">Number of overdue payments</option>
        <option value="custom">Custom condition</option>
      </select>
      <label className="form-label">Trigger value</label>
      <input className="form-input" value={form.trigger_value} onChange={update('trigger_value')} placeholder="e.g. 2000000 or 2026-03-01 or 50" />
      <label className="form-label">Trigger description</label>
      <textarea className="form-input" rows={2} value={form.trigger_description} onChange={update('trigger_description')} placeholder="Describe the exact activation condition..." />

      <div style={sectionStyle}>5. Response — What will we do if it happens?</div>
      <div className="field-hint">Add each action the school will take when the trigger is reached.</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input className="form-input" value={actionInput} onChange={e => setActionInput(e.target.value)} placeholder="e.g. Freeze non-essential expenditure" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAction(); } }} />
        <button className="btn-primary" onClick={addAction} type="button">Add</button>
      </div>
      {(form.response_actions || []).map((a, i) => (
        <div key={i} className="payment-history-row" style={{ alignItems: 'center' }}>
          <span>{i + 1}. {a.action}</span>
          <button className="tx-remove" onClick={() => removeAction(i)}>✕</button>
        </div>
      ))}

      <div style={sectionStyle}>6. Responsibility — Who is responsible?</div>
      <label className="form-label">Responsible person</label>
      <input className="form-input" value={form.responsible_person} onChange={update('responsible_person')} placeholder="e.g. Mrs. Adeyemi" />
      <label className="form-label">Role / Department</label>
      <input className="form-input" value={form.responsible_role} onChange={update('responsible_role')} placeholder="e.g. Bursar" />
      <label className="form-label">Additional stakeholders</label>
      <input className="form-input" value={form.stakeholders} onChange={update('stakeholders')} placeholder="e.g. Proprietor, Accountant" />
      <label className="form-label">Approval authority</label>
      <input className="form-input" value={form.approval_authority} onChange={update('approval_authority')} placeholder="e.g. School Owner" />

      <div style={sectionStyle}>7. Spending Limit — What is the maximum we can commit?</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="form-label">Max contingency spend (₦)</label>
          <input className="form-input" type="number" value={form.spending_limit} onChange={update('spending_limit')} placeholder="e.g. 500000" />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="form-label">Approval threshold (₦)</label>
          <input className="form-input" type="number" value={form.approval_threshold} onChange={update('approval_threshold')} placeholder="e.g. 100000" />
        </div>
      </div>
      <label className="form-label">Spending authority</label>
      <input className="form-input" value={form.spending_authority} onChange={update('spending_authority')} placeholder="e.g. Bursar up to ₦100K, Owner above" />
      <label className="form-label">Escalation point</label>
      <input className="form-input" value={form.escalation_point} onChange={update('escalation_point')} placeholder="e.g. Proprietor if above ₦200K" />

      <div style={sectionStyle}>8. Duration — How long can this sustain the school?</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label className="form-label">Expected duration (days)</label>
          <input className="form-input" type="number" value={form.expected_duration_days} onChange={update('expected_duration_days')} placeholder="e.g. 30" />
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label className="form-label">Max sustainable (days)</label>
          <input className="form-input" type="number" value={form.max_sustainable_days} onChange={update('max_sustainable_days')} placeholder="e.g. 60" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label className="form-label">Start date</label>
          <input className="form-input" type="date" value={form.start_date} onChange={update('start_date')} />
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label className="form-label">Review date</label>
          <input className="form-input" type="date" value={form.review_date} onChange={update('review_date')} />
        </div>
      </div>

      <div style={sectionStyle}>9. Recovery — How will we return to normal?</div>
      <label className="form-label">Recovery target</label>
      <input className="form-input" value={form.recovery_target} onChange={update('recovery_target')} placeholder="e.g. Collection rate above 80%" />
      <label className="form-label">Recovery responsible person</label>
      <input className="form-input" value={form.recovery_responsible} onChange={update('recovery_responsible')} placeholder="e.g. Bursar" />
      <label className="form-label">Recovery review date</label>
      <input className="form-input" type="date" value={form.recovery_review_date} onChange={update('recovery_review_date')} />
      <label className="form-label">Conditions to deactivate</label>
      <textarea className="form-input" rows={2} value={form.recovery_conditions} onChange={update('recovery_conditions')} placeholder="e.g. Collection rate above 80% for 2 consecutive weeks" />

      <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Saving...' : 'Save plan'}</button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function PlanDetail({ plan, events, onBack, onStatusChange }) {
  const [statusNote, setStatusNote] = useState('');
  const meta = STATUS_META[plan.status] || STATUS_META.draft;

  return (
    <div>
      <button className="btn-ghost" onClick={onBack} style={{ marginBottom: 16 }}>← Back to plans</button>

      <div className="card" style={{ borderLeft: `4px solid ${meta.color}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{plan.title}</h1>
            <StatusBadge status={plan.status} />
            {' '}{RISK_CATEGORIES.find(c => c.value === plan.risk_category)?.label || ''}
          </div>
          {plan.triggered_at && (
            <div style={{ color: '#B3261E', fontWeight: 600, fontSize: 14 }}>
              ⚠ Triggered: {new Date(plan.triggered_at).toLocaleString('en-NG')}<br />
              By: {plan.triggered_by === 'system' ? 'System (auto)' : 'Manual'}
            </div>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="card-title">Risk Description</div>
          <p style={{ color: 'var(--ink-soft)', lineHeight: 1.6 }}>{plan.risk_description}</p>
        </div>

        {(plan.impact_estimate_min || plan.impact_estimate_max) && (
          <div style={{ marginTop: 16 }}>
            <div className="card-title">Financial Impact</div>
            <div className="finance-row"><span>Estimated range</span><span>{plan.impact_estimate_min ? naira(plan.impact_estimate_min) : '—'} – {plan.impact_estimate_max ? naira(plan.impact_estimate_max) : '—'}</span></div>
            {plan.impact_type && <div className="finance-row"><span>Impact type</span><span style={{ textTransform: 'capitalize' }}>{plan.impact_type.replace(/_/g, ' ')}</span></div>}
            {plan.impact_duration_days && <div className="finance-row"><span>Expected duration</span><span>{plan.impact_duration_days} days</span></div>}
          </div>
        )}

        {plan.signal_description && (
          <div style={{ marginTop: 16 }}>
            <div className="card-title">Warning Signal</div>
            <p style={{ color: 'var(--ink-soft)' }}>{plan.signal_description}</p>
            {plan.signal_type && plan.signal_type !== 'manual' && (
              <div className="finance-row"><span>Auto-trigger threshold</span><span style={{ fontWeight: 700, color: '#C77D22' }}>{plan.signal_type.includes('pct') ? `${plan.signal_threshold_value}%` : plan.signal_type === 'overdue_count' ? `${plan.signal_threshold_value} students` : naira(plan.signal_threshold_value)}</span></div>
            )}
          </div>
        )}

        {plan.trigger_description && (
          <div style={{ marginTop: 16 }}>
            <div className="card-title">Trigger Point</div>
            <p style={{ color: 'var(--ink-soft)' }}>{plan.trigger_description}</p>
            {plan.trigger_type && <div className="finance-row"><span>Trigger type</span><span style={{ textTransform: 'capitalize' }}>{plan.trigger_type.replace(/_/g, ' ')}</span></div>}
            {plan.trigger_value && <div className="finance-row"><span>Trigger value</span><span style={{ fontWeight: 700 }}>{plan.trigger_value}</span></div>}
          </div>
        )}

        {plan.response_actions && plan.response_actions.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="card-title">Response Actions</div>
            {plan.response_actions.map((a, i) => (
              <div key={i} className="payment-history-row">
                <span>{i + 1}. {a.action}</span>
                {a.done && <span className="badge" style={{ color: '#1B7A43', background: '#E6F4EA' }}>Done</span>}
              </div>
            ))}
          </div>
        )}

        {(plan.responsible_person || plan.responsible_role) && (
          <div style={{ marginTop: 16 }}>
            <div className="card-title">Responsibility</div>
            {plan.responsible_person && <div className="finance-row"><span>Responsible person</span><span>{plan.responsible_person}</span></div>}
            {plan.responsible_role && <div className="finance-row"><span>Role</span><span>{plan.responsible_role}</span></div>}
            {plan.approval_authority && <div className="finance-row"><span>Approval authority</span><span>{plan.approval_authority}</span></div>}
          </div>
        )}

        {(plan.spending_limit || plan.approval_threshold) && (
          <div style={{ marginTop: 16 }}>
            <div className="card-title">Spending Limit</div>
            {plan.spending_limit && <div className="finance-row"><span>Max contingency spend</span><span style={{ fontWeight: 700, color: '#B3261E' }}>{naira(plan.spending_limit)}</span></div>}
            {plan.approval_threshold && <div className="finance-row"><span>Approval threshold</span><span>{naira(plan.approval_threshold)}</span></div>}
          </div>
        )}

        {(plan.expected_duration_days || plan.review_date) && (
          <div style={{ marginTop: 16 }}>
            <div className="card-title">Duration & Review</div>
            {plan.expected_duration_days && <div className="finance-row"><span>Expected duration</span><span>{plan.expected_duration_days} days</span></div>}
            {plan.max_sustainable_days && <div className="finance-row"><span>Max sustainable</span><span>{plan.max_sustainable_days} days</span></div>}
            {plan.review_date && <div className="finance-row"><span>Review date</span><span style={{ fontWeight: 700, color: new Date(plan.review_date) <= new Date() ? '#B3261E' : 'var(--ink)' }}>{plan.review_date}</span></div>}
          </div>
        )}

        {(plan.recovery_target || plan.recovery_conditions) && (
          <div style={{ marginTop: 16 }}>
            <div className="card-title">Recovery Plan</div>
            {plan.recovery_target && <div className="finance-row"><span>Recovery target</span><span>{plan.recovery_target}</span></div>}
            {plan.recovery_responsible && <div className="finance-row"><span>Recovery responsible</span><span>{plan.recovery_responsible}</span></div>}
            {plan.recovery_conditions && <div className="finance-row"><span>Conditions to deactivate</span><span>{plan.recovery_conditions}</span></div>}
          </div>
        )}

        {/* Status change */}
        <div style={{ marginTop: 20, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <div className="card-title">Change Status</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="form-input" style={{ width: 'auto', maxWidth: 200 }} onChange={e => onStatusChange(plan.id, e.target.value, statusNote)} defaultValue="">
              <option value="" disabled>— Select new status —</option>
              {Object.entries(STATUS_META).map(([val, m]) => (
                <option key={val} value={val} disabled={val === plan.status}>{m.label}{val === plan.status ? ' (current)' : ''}</option>
              ))}
            </select>
            <input className="form-input" style={{ width: 'auto', flex: 1, minWidth: 150 }} placeholder="Note (optional)" value={statusNote} onChange={e => setStatusNote(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Event log (immutable audit trail) */}
      {events && events.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">Audit Trail</div>
          <div className="table-wrapper">
            <table className="fee-table">
              <thead><tr><th>Date</th><th>Event</th><th>Description</th><th>By</th></tr></thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleString('en-NG')}</td>
                    <td><span className="badge" style={{ color: '#14213D', background: '#E4EFF4', textTransform: 'capitalize' }}>{e.event_type.replace(/_/g, ' ')}</span></td>
                    <td>{e.event_description}</td>
                    <td>{e.actor_user_id ? 'User' : 'System'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ContingencyPlans() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isOwner = user?.role === 'owner';
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [detailData, setDetailData] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError('');
    api.get('/contingency')
      .then(d => setPlans(d.plans || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (formData) => {
    if (editingPlan) {
      await api.put(`/contingency/${editingPlan.id}`, formData);
    } else {
      await api.post('/contingency', formData);
    }
    setShowForm(false); setEditingPlan(null);
    load();
  };

  const openDetail = async (id) => {
    try {
      const d = await api.get(`/contingency/${id}`);
      setDetailData(d);
      setDetailId(id);
    } catch (e) { setError(e.message); }
  };

  const changeStatus = async (id, status, note) => {
    try {
      await api.post(`/contingency/${id}/status`, { status, note });
      openDetail(id); // refresh detail
      load(); // refresh list
    } catch (e) { alert(e.message); }
  };

  if (showForm) {
    return <PlanForm plan={editingPlan} onSave={save} onCancel={() => { setShowForm(false); setEditingPlan(null); }} />;
  }

  if (detailId && detailData) {
    return <PlanDetail plan={detailData.plan} events={detailData.events} onBack={() => { setDetailId(null); setDetailData(null); }} onStatusChange={changeStatus} />;
  }

  return (
    <div>
      <h1>Contingency Planning</h1>
      <p className="page-intro">Proactively identify financial risks, set trigger points, and prepare responses before a problem disrupts school operations.</p>

      {error && <div className="form-error">{error}</div>}
      {loading && <div className="page-loading">Loading…</div>}

      <div className="toolbar">
        <div className="card-title" style={{ margin: 0 }}>Plans ({plans.length})</div>
        {isOwner && <button className="btn-primary" onClick={() => { setEditingPlan(null); setShowForm(true); }}>+ New plan</button>}
      </div>

      {!loading && plans.length === 0 && (
        <div className="empty-state">
          No contingency plans yet. Click "+ New plan" to identify a financial risk and prepare a response.
        </div>
      )}

      <div className="list">
        {plans.map(p => (
          <PlanCard key={p.id} plan={p} onClick={() => openDetail(p.id)} />
        ))}
      </div>
    </div>
  );
}
