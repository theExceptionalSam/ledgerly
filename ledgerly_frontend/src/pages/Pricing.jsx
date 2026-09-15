import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { naira } from "../utils/format";

// Public pricing page. Shows the 4 go-to-market plans and either routes an
// authenticated user straight to /subscriptions/subscribe or sends an anonymous
// visitor to /register first. Backend plan identifiers are: free / standard /
// premium / enterprise — kept in sync with subscriptions.controller.js PLANS.
const PLANS = [
  {
    plan: "free",
    label: "Free Term",
    price: 0,
    cadence: "first term",
    tagline: "Try it free. No risk, no commitment.",
    features: [
      "All features unlocked",
      "Unlimited students",
      "PDF receipts",
      "Parent portal",
      "Financial reports",
    ],
    cta: "Get started",
  },
  {
    plan: "standard",
    label: "Starter",
    price: 5000,
    cadence: "per month",
    tagline: "For most schools. Everything you need.",
    features: [
      "Everything in Free",
      "Up to 500 students",
      "Online payments (Paystack)",
      "Parent portal access",
      "Bulk student upload",
      "Priority support",
    ],
    cta: "Choose Starter",
    highlight: true,
  },
  {
    plan: "premium",
    label: "Pro",
    price: 15000,
    cadence: "per month",
    tagline: "For large schools with bursar teams.",
    features: [
      "Everything in Starter",
      "Unlimited students",
      "Bank reconciliation",
      "Payment plans & schedules",
      "Custom branding & logo",
      "Audit log & multi-user roles",
      "Boarding/day student tracking",
    ],
    cta: "Choose Pro",
  },
];

export default function Pricing() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(null); // plan name when subscribing
  const [error, setError] = useState("");
  const [done, setDone] = useState(null); // plan name on success

  const subscribe = async (plan) => {
    setError("");
    if (plan === "free") {
      // No payment required — send them to register (or dashboard if signed in).
      window.location.href = user ? "/" : "/register";
      return;
    }
    if (plan === "enterprise") {
      window.location.href = "mailto:hello@ledgerly.app?subject=Ledgerly%20Enterprise%20enquiry";
      return;
    }
    if (!user) {
      window.location.href = "/register";
      return;
    }
    setBusy(plan);
    try {
      await api.post("/subscriptions/subscribe", { plan, billingCycle: "monthly" });
      setDone(plan);
    } catch (e) {
      setError(e.message || "Could not start subscription. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="legal-page pricing-page">
      <header className="legal-header">
        <img src="/ledgerly-logo-dark.png" alt="Ledgerly" className="auth-wordmark" width="180" height="52" fetchpriority="high" />
        <h1>Simple pricing for every school</h1>
        <p className="legal-sub">
          Start free. Upgrade when you're ready to accept online payments or scale beyond 50 students.
          All plans are billed in naira (₦) and include unlimited receipts.
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <div className="pricing-grid">
        {PLANS.map((p) => (
          <div
            key={p.plan}
            className={"pricing-card" + (p.highlight ? " pricing-card-highlight" : "")}
          >
            {p.highlight && <div className="pricing-ribbon">Most popular</div>}
            <div className="pricing-label">{p.label}</div>
            <div className="pricing-price">
              {p.price === null ? "Custom" : naira(p.price)}
              {p.price !== null && p.price > 0 && (
                <span className="pricing-cadence"> / {p.cadence}</span>
              )}
              {p.price === 0 && (
                <span className="pricing-cadence"> / {p.cadence}</span>
              )}
            </div>
            <div className="pricing-tagline">{p.tagline}</div>
            <ul className="pricing-features">
              {p.features.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
            {done === p.plan ? (
              <div className="form-error" style={{ background: "#E7F3EC", color: "#1B7A43", borderColor: "#C5E0CF" }}>
                Subscription updated. We'll email you a payment link shortly.
              </div>
            ) : (
              <button
                className="btn-primary btn-full"
                disabled={busy === p.plan}
                onClick={() => subscribe(p.plan)}
              >
                {busy === p.plan ? "Processing..." : p.cta}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="legal-footer-nav">
        <Link to="/login">Sign in</Link>
        <span>·</span>
        <Link to="/register">Register your school</Link>
        <span>·</span>
        <Link to="/privacy">Privacy Policy</Link>
        <span>·</span>
        <Link to="/terms">Terms of Service</Link>
      </div>
    </div>
  );
}
