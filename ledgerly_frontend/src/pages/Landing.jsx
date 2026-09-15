import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Landing page — the marketing site for Ledgerly.
// Designed so an elementary school student could understand what Ledgerly does:
// simple words, big icons, visual examples, and a clear "what is this?" flow.
//
// Public route (no auth). The first thing visitors see when they visit the app.

function FeatureCard({ icon, title, desc, color }) {
  return (
    <div className="landing-feature-card">
      <div className="landing-feature-icon" style={{ background: color + "20", color }}>{icon}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
    </div>
  );
}

function StepCard({ num, title, desc }) {
  return (
    <div className="landing-step-card">
      <div className="landing-step-num">{num}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();

  return (
    <div className="landing-page">
      {/* ===== HERO ===== */}
      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-logo-row">
            <img src="/ledgerly-logo-dark.png" alt="Ledgerly" className="landing-logo-img" width="200" height="58" />
          </div>
          <h1>Collect school fees faster.</h1>
          <h1 className="landing-hero-green">Track every naira.</h1>
          <p className="landing-hero-sub">
            The simple way to manage school fees, issue receipts, and see who owes what — all in one place. Built for Nigerian schools.
          </p>
          <div className="landing-hero-cta">
            <Link to={user ? "/dashboard" : "/register"} className="btn-primary landing-cta-btn">
              {user ? "Go to dashboard →" : "Start FREE this term →"}
            </Link>
            {!user && (
              <Link to="/login" className="btn-ghost landing-cta-btn-alt">
                Already have an account? Sign in
              </Link>
            )}
          </div>
          <div className="landing-trust-row">
            <span className="landing-trust-badge">🔒 Bank-grade security</span>
            <span className="landing-trust-badge">🇳🇬 Built for Nigeria</span>
            <span className="landing-trust-badge">📱 Works on any device</span>
          </div>
          <p className="landing-hero-note">No credit card needed · No commitment · Cancel anytime</p>
        </div>
      </section>

      {/* ===== WHAT IS LEDGERLY? (kid-friendly explanation) ===== */}
      <section className="landing-section">
        <div className="landing-section-inner">
          <h2>What is Ledgerly?</h2>
          <p className="landing-section-intro">
            Imagine you have a piggy bank for your school. Every time a parent pays school fees, the money goes in.
            But instead of a piggy bank, Ledgerly is a <strong>smart computer program</strong> that:
          </p>
          <div className="landing-what-grid">
            <div className="landing-what-item">
              <span className="landing-what-emoji">📝</span>
              <p><strong>Writes down</strong> who paid and who didn't</p>
            </div>
            <div className="landing-what-item">
              <span className="landing-what-emoji">🧾</span>
              <p><strong>Gives a receipt</strong> to prove the parent paid</p>
            </div>
            <div className="landing-what-item">
              <span className="landing-what-emoji">📊</span>
              <p><strong>Shows you</strong> how much money you've collected</p>
            </div>
            <div className="landing-what-item">
              <span className="landing-what-emoji">🔔</span>
              <p><strong>Reminds you</strong> who still needs to pay</p>
            </div>
          </div>
          <p className="landing-section-outro">
            It's like having a smart assistant that never forgets a payment.
          </p>
        </div>
      </section>

      {/* ===== THE PROBLEM ===== */}
      <section className="landing-section landing-section-tint">
        <div className="landing-section-inner">
          <h2>The Problem</h2>
          <p className="landing-section-intro">
            Schools lose an average of <strong style={{ color: "#B3261E" }}>₦500,000 per term</strong> in uncollected fees. Here's why:
          </p>
          <div className="landing-problem-grid">
            <div className="landing-problem-item">
              <span className="landing-problem-emoji">📓</span>
              <h4>Exercise books</h4>
              <p>Records get torn, lost, or damaged. No backup.</p>
            </div>
            <div className="landing-problem-item">
              <span className="landing-problem-emoji">✍️</span>
              <h4>Hand-written receipts</h4>
              <p>Slow, unprofessional, and easy to fake.</p>
            </div>
            <div className="landing-problem-item">
              <span className="landing-problem-emoji">🤷</span>
              <h4>No idea who owes what</h4>
              <p>You can't see your total outstanding fees at any moment.</p>
            </div>
            <div className="landing-problem-item">
              <span className="landing-problem-emoji">📞</span>
              <h4>Chasing parents</h4>
              <p>End of term = chasing parents who haven't paid. Stressful.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== THE SOLUTION (features) ===== */}
      <section className="landing-section">
        <div className="landing-section-inner">
          <h2>How Ledgerly Fixes It</h2>
          <p className="landing-section-intro">Everything you need to manage school fees, in one simple app:</p>
          <div className="landing-features-grid">
            <FeatureCard
              icon="📊"
              title="See everything at a glance"
              desc="Your dashboard shows how much you've collected, how much is outstanding, and who has paid all in real-time."
              color="#1B7A43"
            />
            <FeatureCard
              icon="🧾"
              title="Receipts in 2 seconds"
              desc="Record a payment and generate a professional PDF receipt instantly. Email it to the parent or print it."
              color="#14213D"
            />
            <FeatureCard
              icon="👥"
              title="Easy student management"
              desc="Add students one by one or upload an Excel sheet. Fees auto-sync — set fees once for a class, and every new student gets them."
              color="#C77D22"
            />
            <FeatureCard
              icon="📱"
              title="Parent portal"
              desc="Parents check their child's fees and download receipts from their own phone. No more calling the bursar."
              color="#1B7A43"
            />
            <FeatureCard
              icon="📈"
              title="Aged debtors report"
              desc="See exactly who owes you money and for how long — 30 days, 60 days, 90+ days. Know who to chase."
              color="#B3261E"
            />
            <FeatureCard
              icon="🔒"
              title="Bank-grade security"
              desc="Every payment is encrypted. Every action is logged. Your data is backed up automatically."
              color="#14213D"
            />
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS (3 steps) ===== */}
      <section className="landing-section landing-section-tint">
        <div className="landing-section-inner">
          <h2>How It Works</h2>
          <p className="landing-section-intro">Get started in 5 minutes. No training needed.</p>
          <div className="landing-steps-grid">
            <StepCard
              num="1"
              title="Add your students"
              desc="Type them in one by one, or upload an Excel sheet. Ledgerly imports them all at once."
            />
            <StepCard
              num="2"
              title="Set up your fees"
              desc="Create fee heads (tuition, feeding, bus) and assign them to classes. One click assigns fees to every student in a class."
            />
            <StepCard
              num="3"
              title="Record payments"
              desc="When a parent pays, enter the amount. Ledgerly records it, generates a receipt, and updates your dashboard instantly."
            />
          </div>
        </div>
      </section>

      {/* ===== WHO IS IT FOR ===== */}
      <section className="landing-section">
        <div className="landing-section-inner">
          <h2>Who Is Ledgerly For?</h2>
          <div className="landing-audience-grid">
            <div className="landing-audience-item">
              <span className="landing-audience-emoji">🏫</span>
              <h4>School owners</h4>
              <p>See your total collection and outstanding fees at any moment. No more waiting for the bursar's report.</p>
            </div>
            <div className="landing-audience-item">
              <span className="landing-audience-emoji">💼</span>
              <h4>Bursars & accountants</h4>
              <p>Record payments in seconds, generate receipts instantly, and reconcile cash at end of day.</p>
            </div>
            <div className="landing-audience-item">
              <span className="landing-audience-emoji">👨‍👩‍👧</span>
              <h4>Parents</h4>
              <p>Check your child's fees, see outstanding balances, and download receipts — all from your phone.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== TRUST ===== */}
      <section className="landing-section landing-section-tint">
        <div className="landing-section-inner">
          <h2>Why Trust Ledgerly?</h2>
          <div className="landing-trust-grid">
            <div className="landing-trust-item">
              <span className="landing-trust-emoji">🔐</span>
              <h4>Secure</h4>
              <p>Bank-grade encryption. Your data is backed up automatically and never shared.</p>
            </div>
            <div className="landing-trust-item">
              <span className="landing-trust-emoji">🇳🇬</span>
              <h4>Built for Nigeria</h4>
              <p>Naira formatting, Nigerian class names, local payment methods (cash, bank transfer, POS).</p>
            </div>
            <div className="landing-trust-item">
              <span className="landing-trust-emoji">📱</span>
              <h4>Works everywhere</h4>
              <p>Phone, tablet, or computer. No installation needed — just open in your browser.</p>
            </div>
            <div className="landing-trust-item">
              <span className="landing-trust-emoji">⏱️</span>
              <h4>Saves time</h4>
              <p>Receipts in 2 seconds. Reports in 1 click. No more hours spent on manual bookkeeping.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="landing-cta-section">
        <div className="landing-cta-inner">
          <h2>Ready to collect fees faster?</h2>
          <p>Start your first term <strong>FREE</strong>. No risk, no commitment.</p>
          <p className="landing-cta-note">If Ledgerly doesn't save you time and help you collect more fees, you walk away at no cost.</p>
          <Link to={user ? "/dashboard" : "/register"} className="btn-primary landing-cta-btn">
            {user ? "Go to dashboard →" : "Start FREE this term →"}
          </Link>
          <p className="landing-cta-or">or</p>
          <p className="landing-cta-contact-text">
            Prefer to talk? <a href="tel:+2348073231954" className="landing-cta-phone">Call 0807 323 1954</a> and we'll set up your school for you.
          </p>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <img src="/ledgerly-logo-dark.png" alt="Ledgerly" className="landing-footer-logo-img" width="140" height="40" />
          </div>
          <p>School Fee Management Made Simple</p>
          <div className="landing-footer-links">
            <Link to="/login">Sign in</Link>
            <Link to="/register">Register</Link>
            <Link to="/pricing">Pricing</Link>
            <Link to="/parent">Parent Portal</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </div>
          <p className="landing-footer-copy">© 2026 Ledgerly · Built for Nigerian schools · ledgerly-xi-ochre.vercel.app</p>
        </div>
      </footer>
    </div>
  );
}
