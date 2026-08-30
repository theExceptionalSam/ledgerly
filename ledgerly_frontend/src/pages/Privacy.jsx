import { Link } from "react-router-dom";

// NDPR-compliant Privacy Policy for Ledgerly — a Nigerian school fee tracker.
// Public page at /privacy. Static content; updates require a code deploy.
//
// Covers: data collected, how it's used, retention, third-party processors
// (Supabase, Render, Vercel, Paystack, Resend), user rights, and contact
// for data protection enquiries.

export default function Privacy() {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <img src="/ledgerly-logo-dark.jpg" alt="Ledgerly" className="auth-wordmark" />
        <h1>Privacy Policy</h1>
        <p className="legal-sub">Last updated: {new Date().getFullYear()}</p>
      </header>

      <Section title="1. Who we are">
        <p>
          Ledgerly ("we", "us", "our") is a school fee tracking and finance management service
          operated from Nigeria. We help schools record student fees, accept online payments,
          issue receipts, and report on collections. This Privacy Policy explains what data we
          collect, why we collect it, and the rights you have over it under the Nigeria Data
          Protection Regulation (NDPR) 2019 and the Nigeria Data Protection Act 2023.
        </p>
        <p>
          By using Ledgerly, you (the school's owner, bursar, accountant, or assistant) and the
          parents whose data you enter agree to the practices described here.
        </p>
      </Section>

      <Section title="2. Data we collect">
        <p>We collect and process the following categories of personal data:</p>
        <ul>
          <li><strong>School information:</strong> school name, address, phone number, owner name, and email address.</li>
          <li><strong>Staff account data:</strong> name, email, role, password hash, two-factor authentication secret, and login activity.</li>
          <li><strong>Student records:</strong> name, class, admission number, and guardian contact (phone number).</li>
          <li><strong>Parent portal accounts:</strong> name, phone number, password hash, and the students linked to the parent.</li>
          <li><strong>Payment records:</strong> amount, method (cash, bank transfer, POS, cheque, online), date, fee head, receipt number, and (for online payments) the Paystack transaction reference.</li>
          <li><strong>Usage data:</strong> IP address, browser user-agent, device type, and timestamps of API requests — used for security, audit, and abuse prevention.</li>
          <li><strong>Optional branding data:</strong> if you upload a custom logo or set brand colours, those files are stored and served from our infrastructure.</li>
        </ul>
        <p>
          We do <strong>not</strong> collect biometric data, national identification numbers (NIN),
          BVN, or information about students' academic performance beyond what is needed to bill fees.
        </p>
      </Section>

      <Section title="3. How we use your data">
        <p>We process personal data only for the following lawful purposes:</p>
        <ul>
          <li>To create and manage your school's account, including staff logins and role-based permissions.</li>
          <li>To record student fees, payments, discounts, and issue receipts.</li>
          <li>To enable parents to view their child's outstanding fees and pay online via Paystack.</li>
          <li>To generate financial reports, audit logs, and term summaries for school management.</li>
          <li>To detect, prevent, and investigate fraud, abuse, or unauthorised access to your account.</li>
          <li>To send service notifications (payment receipts, weekly summaries, subscription renewal reminders).</li>
          <li>To comply with legal obligations, court orders, or requests from regulatory authorities.</li>
        </ul>
        <p>
          We process data based on: (a) the performance of a contract with you (providing the service),
          (b) our legitimate interests in securing and improving the service, and (c) your consent where
          required (e.g. optional marketing communications, which you can opt out of at any time).
        </p>
      </Section>

      <Section title="4. Data retention">
        <p>
          We retain personal data for as long as your school account is active. After account closure or
          termination, we retain records for the following periods:
        </p>
        <ul>
          <li><strong>Payment records and receipts:</strong> 7 years, in line with Nigerian tax and accounting requirements.</li>
          <li><strong>Audit logs:</strong> 7 years, to support forensic investigations.</li>
          <li><strong>Student and parent records:</strong> deleted 90 days after account closure, unless a legal hold applies.</li>
          <li><strong>Staff account data:</strong> deleted 90 days after the last user is removed.</li>
          <li><strong>Refresh tokens and session data:</strong> deleted automatically 30 days after expiry.</li>
        </ul>
        <p>
          You may submit a data deletion request at any time — see Section 7 below. We honour requests
          within 30 days, subject to the legal retention periods above.
        </p>
      </Section>

      <Section title="5. Third-party processors">
        <p>
          We do not sell your data. We share it only with the following subprocessors who help us deliver
          the service. Each processor is bound by data protection terms and processes data only on our
          instructions:
        </p>
        <ul>
          <li><strong>Supabase</strong> (supabase.com) — managed PostgreSQL database hosting. Stores all application data. Servers located in EU/US regions.</li>
          <li><strong>Render</strong> (render.com) — backend application hosting. Runs our Node.js API servers.</li>
          <li><strong>Vercel</strong> (vercel.com) — frontend application hosting. Serves the React web app to your browser.</li>
          <li><strong>Paystack</strong> (paystack.com) — online payment processing. Receives payment amounts, references, and customer email/phone for transaction routing. Paystack is PCI-DSS compliant.</li>
          <li><strong>Resend</strong> (resend.com) — transactional email delivery. Sends receipts, OTPs, and notification emails on our behalf.</li>
          <li><strong>Termii</strong> (termii.com) — SMS and WhatsApp messaging. Sends parent payment confirmations and OTPs where applicable.</li>
          <li><strong>Sentry</strong> (sentry.io) — error monitoring. Receives anonymised stack traces when the app crashes.</li>
        </ul>
        <p>
          We do not transfer personal data outside Nigeria except to the subprocessors listed above, whose
          regions are noted. Where data leaves Nigeria, we rely on the lawful transfer mechanisms required
          by the NDPR.
        </p>
      </Section>

      <Section title="6. Security">
        <p>
          We protect personal data using industry-standard measures:
        </p>
        <ul>
          <li>Access tokens are kept in memory only (never in localStorage); refresh tokens are stored in httpOnly, Secure, SameSite=strict cookies.</li>
          <li>Passwords are hashed with bcrypt (cost factor 12).</li>
          <li>API keys are SHA-256 hashed at rest; the raw key is shown once at creation.</li>
          <li>Two-factor authentication (TOTP) is available for all owner accounts.</li>
          <li>All traffic between your browser and our servers is encrypted with TLS 1.2+.</li>
          <li>Database access is restricted by IP allow-list and individual credentials with least privilege.</li>
        </ul>
        <p>
          No system is perfectly secure. In the event of a data breach affecting your rights, we will
          notify the Nigerian Data Protection Commission and affected users without undue delay, and
          in any case within 72 hours of becoming aware of the breach.
        </p>
      </Section>

      <Section title="7. Your rights">
        <p>Under the NDPR and NDP Act 2023, you have the right to:</p>
        <ul>
          <li><strong>Access</strong> — request a copy of the personal data we hold about you.</li>
          <li><strong>Rectification</strong> — correct inaccurate or incomplete data.</li>
          <li><strong>Erasure</strong> — request deletion of your data, subject to legal retention periods.</li>
          <li><strong>Restriction</strong> — limit how we process your data while a dispute is resolved.</li>
          <li><strong>Portability</strong> — receive your data in a structured, machine-readable format.</li>
          <li><strong>Objection</strong> — object to processing based on legitimate interests.</li>
          <li><strong>Withdraw consent</strong> — at any time, for processing that relies on your consent.</li>
        </ul>
        <p>
          To exercise any of these rights, email <a href="mailto:privacy@ledgerly.app">privacy@ledgerly.app</a>.
          We respond within 30 days. If you're not satisfied with our response, you may complain to the
          Nigeria Data Protection Commission at <a href="https://ndpc.gov.ng" target="_blank" rel="noopener noreferrer">ndpc.gov.ng</a>.
        </p>
      </Section>

      <Section title="8. Cookies">
        <p>
          Ledgerly uses a single essential cookie (<code>refresh_token</code>) to keep you signed in
          between page reloads. This cookie is httpOnly, Secure, and SameSite=strict — it cannot be read
          by JavaScript or sent in cross-site requests. We do not use advertising or analytics cookies.
        </p>
      </Section>

      <Section title="9. Children's data">
        <p>
          Ledgerly is used by schools to record information about students, who may be children. We do
          not collect data directly from children — all student data is entered by the school. Parents
          may access their child's fee and payment records through the parent portal after verifying
          their phone number against the school's guardian contact record.
        </p>
      </Section>

      <Section title="10. Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. We will notify you of material changes
          by email and by posting a banner in the app at least 30 days before the change takes effect.
          Continued use after the effective date constitutes acceptance of the updated policy.
        </p>
      </Section>

      <Section title="11. Contact our Data Protection Officer">
        <p>
          For any privacy-related question, request, or complaint, contact our Data Protection Officer:
        </p>
        <p>
          <strong>Email:</strong> <a href="mailto:privacy@ledgerly.app">privacy@ledgerly.app</a><br />
          <strong>Postal:</strong> Ledgerly Data Protection, Lagos, Nigeria
        </p>
      </Section>

      <div className="legal-footer-nav">
        <Link to="/terms">Terms of Service</Link>
        <span>·</span>
        <Link to="/pricing">Pricing</Link>
        <span>·</span>
        <Link to="/login">Sign in</Link>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="legal-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
