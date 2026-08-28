const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Tenant subscription management.
//
// Plan catalogue is hard-coded here (the plans table from migration 016 stores the
// tenant's CURRENT plan, not the catalogue). Pricing is in NGN. The subscribe
// endpoint updates the subscription row in the DB — actual Paystack subscription
// initialization is a TODO (we just record intent and rely on the webhook to flip
// status when payment is confirmed).

const PLANS = [
  { plan: 'free',      label: 'Free',      monthly: 0,     yearly: 0,     students: 50,  features: ['Core fee tracking', '1 school', 'Email support'] },
  { plan: 'starter',   label: 'Starter',   monthly: 5000,  yearly: 50000, students: 200, features: ['Everything in Free', 'Online payments', 'Receipts PDF'] },
  { plan: 'standard',  label: 'Standard',  monthly: 15000, yearly: 150000, students: 1000, features: ['Everything in Starter', 'Bank reconciliation', 'Payment plans', 'Parent portal'] },
  { plan: 'premium',   label: 'Premium',   monthly: 35000, yearly: 350000, students: 5000, features: ['Everything in Standard', 'Webhooks', 'API access', 'Priority support'] },
  { plan: 'enterprise', label: 'Enterprise', monthly: 0, yearly: 0, students: -1, features: ['Everything in Premium', 'Custom integrations', 'Dedicated CSM', 'SLA'] },
];

async function getCurrent(req, res) {
  const { rows } = await db.query(
    `SELECT id, plan, amount, currency, status, billing_cycle, current_period_end, paystack_subscription_code, created_at, updated_at
     FROM subscriptions WHERE tenant_id = $1`,
    [req.user.tenantId]
  );
  res.json({ subscription: rows[0] || null });
}

async function listPlans(req, res) {
  res.json({ plans: PLANS });
}

async function subscribe(req, res) {
  const { plan, billingCycle } = req.body;
  const catalogue = PLANS.find((p) => p.plan === plan);
  if (!catalogue) return res.status(400).json({ error: 'Unknown plan' });

  const amount = billingCycle === 'yearly' ? catalogue.yearly : catalogue.monthly;
  const periodEnd = new Date(Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString();

  // Upsert: each tenant has exactly one subscription row (seeded by migration 016).
  const { rows: existing } = await db.query(`SELECT id FROM subscriptions WHERE tenant_id = $1`, [req.user.tenantId]);
  let subscriptionId;
  if (existing[0]) {
    subscriptionId = existing[0].id;
    await db.query(
      `UPDATE subscriptions SET plan = $1, amount = $2, billing_cycle = $3, current_period_end = $4, status = 'trialing', updated_at = now() WHERE id = $5`,
      [plan, amount, billingCycle, periodEnd, subscriptionId]
    );
  } else {
    subscriptionId = randomUUID();
    await db.query(
      `INSERT INTO subscriptions (id, tenant_id, plan, amount, billing_cycle, current_period_end, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'trialing')`,
      [subscriptionId, req.user.tenantId, plan, amount, billingCycle, periodEnd]
    );
  }

  // TODO: initialize Paystack subscription — POST /subscription with { customer_code, plan, authorization }.
  // Until then, the DB reflects intent; a back-office process can reconcile against Paystack.
  await recordAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'update', entityType: 'subscription', entityId: subscriptionId, ipAddress: req.ip, metadata: { plan, billingCycle, amount } });
  res.json({ id: subscriptionId, plan, billingCycle, amount, currentPeriodEnd: periodEnd });
}

module.exports = { getCurrent, listPlans, subscribe };
