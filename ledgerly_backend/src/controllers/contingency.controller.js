const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');
const { createNotification } = require('./notifications.controller');

// Contingency Planning — financial risk early-warning and response system.
//
// Each plan follows the structured workflow:
//   Risk → Impact → Signal → Trigger → Response → Resources → Recovery
//
// The module integrates with existing financial data (payments, budgets,
// outstanding fees) for automated trigger detection.

const RISK_CATEGORIES = [
  'lower_fee_collection', 'delayed_payments', 'unexpected_repairs',
  'emergency_expenditure', 'operating_cost_increase', 'payroll_pressure',
  'utility_cost_increase', 'supplier_price_increase', 'funding_shortfall',
  'cashflow_shortage', 'unplanned_capex', 'other',
];

const VALID_STATUSES = ['draft','prepared','monitoring','triggered','active','under_review','resolved','archived'];

// Log an immutable event to contingency_events
async function logEvent(tenantId, planId, eventType, description, data, actorUserId) {
  await db.query(
    `INSERT INTO contingency_events (id, tenant_id, plan_id, event_type, event_description, event_data, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), tenantId, planId, eventType, description, data ? JSON.stringify(data) : null, actorUserId || null]
  );
}

// ---- List all plans for the tenant ----
async function listPlans(req, res) {
  const { tenantId } = req.user;
  const { status } = req.query;
  const params = [tenantId];
  let where = 'tenant_id = $1';
  if (status && VALID_STATUSES.includes(status)) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT * FROM contingency_plans WHERE ${where} ORDER BY
       CASE status
         WHEN 'triggered' THEN 1 WHEN 'active' THEN 2 WHEN 'monitoring' THEN 3
         WHEN 'prepared' THEN 4 WHEN 'under_review' THEN 5 WHEN 'draft' THEN 6
         WHEN 'resolved' THEN 7 WHEN 'archived' THEN 8
       END, updated_at DESC`,
    params
  );
  // Parse JSON fields
  const plans = rows.map(p => ({
    ...p,
    response_actions: p.response_actions ? JSON.parse(p.response_actions) : [],
    cost_adjustments: p.cost_adjustments ? JSON.parse(p.cost_adjustments) : [],
    funding_sources: p.funding_sources ? JSON.parse(p.funding_sources) : [],
    required_resources: p.required_resources ? JSON.parse(p.required_resources) : {},
    recovery_actions: p.recovery_actions ? JSON.parse(p.recovery_actions) : [],
  }));
  res.json({ plans });
}

// ---- Get a single plan with its event log ----
async function getPlan(req, res) {
  const { tenantId } = req.user;
  const { id } = req.params;
  const { rows: planRows } = await db.query(`SELECT * FROM contingency_plans WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const plan = planRows[0];
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  const { rows: events } = await db.query(
    `SELECT * FROM contingency_events WHERE plan_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  // Parse JSON fields
  plan.response_actions = plan.response_actions ? JSON.parse(plan.response_actions) : [];
  plan.cost_adjustments = plan.cost_adjustments ? JSON.parse(plan.cost_adjustments) : [];
  plan.funding_sources = plan.funding_sources ? JSON.parse(plan.funding_sources) : [];
  plan.required_resources = plan.required_resources ? JSON.parse(plan.required_resources) : {};
  plan.recovery_actions = plan.recovery_actions ? JSON.parse(plan.recovery_actions) : [];
  events.forEach(e => { try { e.event_data = e.event_data ? JSON.parse(e.event_data) : null; } catch {} });

  res.json({ plan, events });
}

// ---- Create a new plan ----
async function createPlan(req, res) {
  const { tenantId, id: userId } = req.user;
  const b = req.body;
  const id = randomUUID();

  await db.query(`
    INSERT INTO contingency_plans (
      id, tenant_id, title, risk_description, risk_category,
      impact_estimate_min, impact_estimate_max, impact_type, impact_currency, impact_duration_days,
      signal_type, signal_threshold_value, signal_description,
      trigger_type, trigger_value, trigger_description,
      response_actions, cost_adjustments, funding_sources,
      responsible_person, responsible_role, stakeholders, approval_authority,
      required_resources, spending_limit, approval_threshold, spending_authority, escalation_point,
      expected_duration_days, start_date, review_date, max_sustainable_days,
      recovery_actions, recovery_target, recovery_responsible, recovery_review_date, recovery_conditions,
      status, created_by
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13,
      $14, $15, $16,
      $17, $18, $19,
      $20, $21, $22, $23,
      $24, $25, $26, $27, $28,
      $29, $30, $31, $32,
      $33, $34, $35, $36, $37,
      $38, $39
    )
  `, [
    id, tenantId, b.title, b.risk_description, b.risk_category,
    b.impact_estimate_min || null, b.impact_estimate_max || null, b.impact_type || null, b.impact_currency || 'NGN', b.impact_duration_days || null,
    b.signal_type || null, b.signal_threshold_value || null, b.signal_description || null,
    b.trigger_type || null, b.trigger_value || null, b.trigger_description || null,
    b.response_actions ? JSON.stringify(b.response_actions) : null,
    b.cost_adjustments ? JSON.stringify(b.cost_adjustments) : null,
    b.funding_sources ? JSON.stringify(b.funding_sources) : null,
    b.responsible_person || null, b.responsible_role || null, b.stakeholders || null, b.approval_authority || null,
    b.required_resources ? JSON.stringify(b.required_resources) : null,
    b.spending_limit || null, b.approval_threshold || null, b.spending_authority || null, b.escalation_point || null,
    b.expected_duration_days || null, b.start_date || null, b.review_date || null, b.max_sustainable_days || null,
    b.recovery_actions ? JSON.stringify(b.recovery_actions) : null,
    b.recovery_target || null, b.recovery_responsible || null, b.recovery_review_date || null, b.recovery_conditions || null,
    b.status || 'draft', userId,
  ]);

  await logEvent(tenantId, id, 'created', `Plan "${b.title}" created`, null, userId);
  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'contingency_plan', entityId: id, ipAddress: req.ip, metadata: { title: b.title } });
  res.status(201).json({ id });
}

// ---- Update a plan ----
async function updatePlan(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;
  const b = req.body;

  const { rows: existing } = await db.query(`SELECT * FROM contingency_plans WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!existing[0]) return res.status(404).json({ error: 'Plan not found' });

  const changes = {};
  const fields = [
    'title', 'risk_description', 'risk_category',
    'impact_estimate_min', 'impact_estimate_max', 'impact_type', 'impact_currency', 'impact_duration_days',
    'signal_type', 'signal_threshold_value', 'signal_description',
    'trigger_type', 'trigger_value', 'trigger_description',
    'responsible_person', 'responsible_role', 'stakeholders', 'approval_authority',
    'spending_limit', 'approval_threshold', 'spending_authority', 'escalation_point',
    'expected_duration_days', 'start_date', 'review_date', 'max_sustainable_days',
    'recovery_target', 'recovery_responsible', 'recovery_review_date', 'recovery_conditions',
  ];

  const setClauses = [];
  const params = [];
  let idx = 1;

  for (const f of fields) {
    if (b[f] !== undefined) {
      setClauses.push(`${f} = $${idx}`);
      params.push(b[f]);
      idx++;
      changes[f] = { from: existing[0][f], to: b[f] };
    }
  }
  // JSON fields
  for (const f of ['response_actions', 'cost_adjustments', 'funding_sources', 'required_resources', 'recovery_actions']) {
    if (b[f] !== undefined) {
      setClauses.push(`${f} = $${idx}`);
      params.push(JSON.stringify(b[f]));
      idx++;
      changes[f] = 'updated';
    }
  }
  setClauses.push(`updated_at = now()`);

  if (setClauses.length > 1) {
    params.push(id, tenantId);
    await db.query(`UPDATE contingency_plans SET ${setClauses.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1}`, params);
    await logEvent(tenantId, id, 'modified', 'Plan details updated', changes, userId);
  }

  res.json({ ok: true });
}

// ---- Change plan status ----
async function changeStatus(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;
  const { status, note } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const { rows: existing } = await db.query(`SELECT status, title FROM contingency_plans WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!existing[0]) return res.status(404).json({ error: 'Plan not found' });
  const oldStatus = existing[0].status;

  const updates = ['status = $1', 'updated_at = now()'];
  const params = [status];
  if (status === 'triggered' || status === 'active') {
    updates.push('triggered_at = now()');
    updates.push('triggered_by = $' + (params.length + 1));
    params.push(userId);
  }
  if (status === 'resolved') {
    updates.push('resolved_at = now()');
  }
  params.push(id, tenantId);
  await db.query(`UPDATE contingency_plans SET ${updates.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`, params);

  await logEvent(tenantId, id, 'status_changed', `Status changed from "${oldStatus}" to "${status}"${note ? ': ' + note : ''}`, { from: oldStatus, to: status, note }, userId);
  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'contingency_plan', entityId: id, ipAddress: req.ip, metadata: { statusChange: { from: oldStatus, to: status } } });

  // Notify the responsible person if the plan is triggered
  if (status === 'triggered' || status === 'active') {
    const plan = existing[0];
    await createNotification(tenantId, userId, 'contingency_triggered', `Contingency plan triggered: ${plan.title}`,
      `The contingency plan "${plan.title}" has been activated. Review the response actions.`, 'contingency_plan', id);
  }

  res.json({ ok: true, status });
}

// ---- Dashboard summary: active risks, triggered plans, exposure ----
async function getDashboardSummary(req, res) {
  const { tenantId } = req.user;

  const { rows: plans } = await db.query(`
    SELECT id, title, status, risk_category, impact_estimate_max, impact_estimate_min,
           triggered_at, review_date, signal_type, signal_threshold_value
    FROM contingency_plans
    WHERE tenant_id = $1 AND status NOT IN ('archived', 'resolved')
    ORDER BY
      CASE status
        WHEN 'triggered' THEN 1 WHEN 'active' THEN 2 WHEN 'monitoring' THEN 3
        WHEN 'prepared' THEN 4 WHEN 'under_review' THEN 5 WHEN 'draft' THEN 6
      END, updated_at DESC
  `, [tenantId]);

  const triggered = plans.filter(p => p.status === 'triggered' || p.status === 'active');
  const monitoring = plans.filter(p => p.status === 'monitoring');
  const totalExposure = plans.reduce((sum, p) => sum + (Number(p.impact_estimate_max) || 0), 0);
  const upcomingReviews = plans.filter(p => p.review_date && new Date(p.review_date) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

  res.json({
    activeCount: plans.length,
    triggeredCount: triggered.length,
    monitoringCount: monitoring.length,
    totalPotentialExposure: totalExposure,
    upcomingReviews: upcomingReviews.map(p => ({ id: p.id, title: p.title, reviewDate: p.review_date })),
    triggeredPlans: triggered.map(p => ({ id: p.id, title: p.title, triggeredAt: p.triggered_at })),
    plansNeedingAttention: plans.slice(0, 5), // top 5 most urgent
  });
}

// ---- Automated trigger check (called by cron or dashboard load) ----
// Checks all 'monitoring' plans against current financial data.
// If a trigger condition is met, flags the plan + sends notification.
async function checkTriggers(req, res) {
  const { tenantId, id: userId } = req.user;

  const { rows: monitoringPlans } = await db.query(
    `SELECT * FROM contingency_plans WHERE tenant_id = $1 AND status = 'monitoring'`,
    [tenantId]
  );

  if (monitoringPlans.length === 0) {
    return res.json({ checked: 0, triggered: 0 });
  }

  // Get current financial data for comparison
  const { rows: termRows } = await db.query(`SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`, [tenantId]);
  const termId = termRows[0]?.id;
  if (!termId) return res.json({ checked: monitoringPlans.length, triggered: 0 });

  const { rows: feeRows } = await db.query(`
    SELECT
      COALESCE(SUM(expected_amount - discount_amount), 0) AS expected,
      COALESCE((SELECT SUM(amount) FROM payments WHERE tenant_id = $1 AND term_id = $2 AND reversed = 0), 0) AS collected
    FROM student_fee_assignments WHERE tenant_id = $1 AND term_id = $2
  `, [tenantId, termId]);

  const expected = Number(feeRows[0].expected) || 0;
  const collected = Number(feeRows[0].collected) || 0;
  const outstanding = Math.max(expected - collected, 0);
  const collectionRate = expected > 0 ? (collected / expected) * 100 : 100;

  // Get current cash position (income - expenditure)
  const { rows: cashRows } = await db.query(`
    SELECT
      COALESCE((SELECT SUM(amount) FROM transactions WHERE tenant_id = $1 AND type = 'income' AND reversed = 0), 0) AS income,
      COALESCE((SELECT SUM(amount) FROM transactions WHERE tenant_id = $1 AND type = 'expenditure' AND reversed = 0), 0) AS expenditure
  `, [tenantId]);
  const cashPosition = Number(cashRows[0].income) - Number(cashRows[0].expenditure);

  // Count overdue payments (students with outstanding > 0)
  const { rows: overdueRows } = await db.query(`
    SELECT COUNT(DISTINCT s.id)::int AS count
    FROM students s
    WHERE s.tenant_id = $1 AND s.status = 'active'
      AND COALESCE((SELECT SUM(expected_amount - discount_amount) FROM student_fee_assignments sfa WHERE sfa.student_id = s.id AND sfa.term_id = $2), 0) >
          COALESCE((SELECT SUM(amount) FROM payments p WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0)
  `, [tenantId, termId]);

  let triggeredCount = 0;
  const triggeredPlans = [];

  for (const plan of monitoringPlans) {
    let shouldTrigger = false;
    let triggerReason = '';

    switch (plan.signal_type) {
      case 'collection_below_pct':
        if (collectionRate < (plan.signal_threshold_value || 0)) {
          shouldTrigger = true;
          triggerReason = `Collection rate ${collectionRate.toFixed(1)}% is below threshold ${plan.signal_threshold_value}%`;
        }
        break;
      case 'cash_below_amount':
        if (cashPosition < (plan.signal_threshold_value || 0)) {
          shouldTrigger = true;
          triggerReason = `Cash position ₦${cashPosition.toLocaleString()} is below threshold ₦${plan.signal_threshold_value.toLocaleString()}`;
        }
        break;
      case 'outstanding_above_amount':
        if (outstanding > (plan.signal_threshold_value || 0)) {
          shouldTrigger = true;
          triggerReason = `Outstanding fees ₦${outstanding.toLocaleString()} exceed threshold ₦${plan.signal_threshold_value.toLocaleString()}`;
        }
        break;
      case 'overdue_count':
        if (overdueRows[0].count >= (plan.signal_threshold_value || 0)) {
          shouldTrigger = true;
          triggerReason = `${overdueRows[0].count} students have overdue payments (threshold: ${plan.signal_threshold_value})`;
        }
        break;
      // manual and custom signals require human evaluation — no auto-trigger
    }

    if (shouldTrigger) {
      triggeredCount++;
      triggeredPlans.push({ id: plan.id, title: plan.title, reason: triggerReason });

      // Auto-trigger the plan
      await db.query(`UPDATE contingency_plans SET status = 'triggered', triggered_at = now(), triggered_by = 'system', updated_at = now() WHERE id = $1`, [plan.id]);
      await logEvent(tenantId, plan.id, 'auto_triggered', `Auto-triggered: ${triggerReason}`, { signalType: plan.signal_type, threshold: plan.signal_threshold_value, actualValue: triggerReason }, null);
      await recordAudit({ tenantId, actorUserId: null, action: 'update', entityType: 'contingency_plan', entityId: plan.id, ipAddress: req.ip, metadata: { autoTriggered: true, reason: triggerReason } });

      // Notify all owners
      const { rows: owners } = await db.query(`SELECT id FROM users WHERE tenant_id = $1 AND role = 'owner' AND status = 'active'`, [tenantId]);
      for (const owner of owners) {
        await createNotification(tenantId, owner.id, 'contingency_triggered', `⚠ Contingency triggered: ${plan.title}`,
          `${triggerReason}. Review the response actions for "${plan.title}".`, 'contingency_plan', plan.id);
      }
    }
  }

  res.json({
    checked: monitoringPlans.length,
    triggered: triggeredCount,
    triggeredPlans,
    financialSnapshot: { expected, collected, outstanding, collectionRate, cashPosition, overdueCount: overdueRows[0].count },
  });
}

module.exports = { listPlans, getPlan, createPlan, updatePlan, changeStatus, getDashboardSummary, checkTriggers };
