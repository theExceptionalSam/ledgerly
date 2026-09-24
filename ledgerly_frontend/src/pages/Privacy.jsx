import { Link } from "react-router-dom";

// NDPR-compliant Privacy Policy for Ledgerly.
// Public page at /privacy. Covers: data collected (including KYC), how it's
// used, retention, third-party processors, user rights, and contact.

export default function Privacy() {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <img src="/ledgerly-logo-dark.jpg" alt="Ledgerly" className="auth-wordmark" width="180" height="52" fetchpriority="high" />
        <h1>Privacy Policy</h1>
        <p className="legal-sub">Last updated: September 2026</p>
      </header>

      <div className="legal-content">
        <p>This Privacy Policy explains how Ledgerly ("we", "us", "our") collects, uses, stores, and protects your data. We operate in compliance with the Nigeria Data Protection Regulation (NDPR) 2019 and the Nigeria Data Protection Act 2023.</p>

        <h2>1. Data We Collect</h2>
        <h3>1.1 School Registration Data</h3>
        <p>When a school registers with Ledgerly, we collect:</p>
        <ul>
          <li>School name, address, Local Government Area, and state</li>
          <li>School registration number and registration type (CAC, Ministry of Education, etc.)</li>
          <li>School type (day, boarding, mixed), education level, and year established</li>
          <li>Approximate student count and classes offered</li>
          <li>School motto, email, and website (optional)</li>
          <li>Tax ID / TIN (optional)</li>
        </ul>

        <h3>1.2 User Account Data</h3>
        <p>For each staff member (owner, bursar, accountant), we collect:</p>
        <ul>
          <li>Full name, email address, and phone number</li>
          <li>Role (owner, bursar, accountant)</li>
          <li>Hashed password (using bcrypt — we never store plain-text passwords)</li>
          <li>Two-factor authentication secret (if enabled, stored encrypted)</li>
          <li>Session data (IP address, user agent, login timestamps)</li>
        </ul>

        <h3>1.3 Student Data</h3>
        <p>Schools enter the following data about their students:</p>
        <ul>
          <li>Student name, class, admission number</li>
          <li>Student type (day student or boarding student)</li>
          <li>Guardian/parent contact (phone number and/or email)</li>
          <li>Fee assignments (expected fees per term)</li>
          <li>Payment records (amount, method, date, receipt number)</li>
          <li>Discount information (if applicable)</li>
        </ul>

        <h3>1.4 Financial Data</h3>
        <p>We collect and process:</p>
        <ul>
          <li>Fee payment records (amount, method, date)</li>
          <li>Receipt numbers and receipt PDFs</li>
          <li>Income and expenditure transactions</li>
          <li>Bank reconciliation data (uploaded bank statements)</li>
          <li>Budget and contingency planning data</li>
          <li>Audit log entries (all actions taken in the system)</li>
        </ul>

        <h3>1.5 Parent Portal Data</h3>
        <p>When parents use the Parent Portal, we collect:</p>
        <ul>
          <li>Phone number and name</li>
          <li>Hashed password</li>
          <li>Link to their child's student record</li>
        </ul>

        <h2>2. How We Use Your Data</h2>
        <p>We use your data solely for the purpose of providing the Ledgerly service:</p>
        <ul>
          <li>To record and track school fee payments</li>
          <li>To generate and issue receipts</li>
          <li>To produce financial reports (aged debtors, reconciliation, budgets, contingency plans)</li>
          <li>To allow parents to view their child's fees and download receipts</li>
          <li>To send email notifications (OTP codes, weekly summaries, payment receipts)</li>
          <li>To maintain an audit trail for financial integrity</li>
          <li>To verify the identity of schools (KYC) for regulatory compliance</li>
          <li>To prevent fraud and unauthorized access</li>
        </ul>
        <p>We do NOT:</p>
        <ul>
          <li>Sell your data to third parties</li>
          <li>Use your data for advertising</li>
          <li>Share student data with third parties without the school's consent</li>
          <li>Use student data for any purpose other than fee management</li>
        </ul>

        <h2>3. Legal Basis for Processing</h2>
        <p>We process your data based on:</p>
        <ul>
          <li><strong>Contract:</strong> Processing is necessary to provide the service you signed up for</li>
          <li><strong>Legal obligation:</strong> NDPR requires us to maintain records of data processed</li>
          <li><strong>Legitimate interest:</strong> Audit logs and security measures protect your data</li>
          <li><strong>Consent:</strong> Parents consent to their data being used when they register for the Parent Portal</li>
        </ul>

        <h2>4. Data Retention</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E4E3DD' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Data Type</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Retention Period</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #E4E3DD' }}>
              <td style={{ padding: '8px' }}>Payment records and receipts</td>
              <td style={{ padding: '8px' }}>7 years (Nigerian tax law requirement)</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #E4E3DD' }}>
              <td style={{ padding: '8px' }}>Audit logs</td>
              <td style={{ padding: '8px' }}>7 years</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #E4E3DD' }}>
              <td style={{ padding: '8px' }}>Student records</td>
              <td style={{ padding: '8px''>Until the school archives or deletes the student</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #E4E3DD' }}>
              <td style={{ padding: '8px' }}>KYC data</td>
              <td style={{ padding: '8px' }}>Duration of the account + 2 years</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #E4E3DD' }}>
              <td style={{ padding: '8px' }}>Session tokens</td>
              <td style={{ padding: '8px' }}>30 days (then automatically deleted)</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #E4E3DD' }}>
              <td style={{ padding: '8px' }}>Deleted account data</td>
              <td style={{ padding: '8px' }}>30-day grace period, then permanently deleted</td>
            </tr>
          </tbody>
        </table>

        <h2>5. Data Security</h2>
        <p>We protect your data using industry-standard security measures:</p>
        <ul>
          <li><strong>Encryption in transit:</strong> All data is transmitted over HTTPS (TLS 1.2+)</li>
          <li><strong>Encryption at rest:</strong> The database is encrypted by our hosting provider (Supabase)</li>
          <li><strong>Password hashing:</strong> Passwords are hashed using bcrypt with a cost factor of 12</li>
          <li><strong>Row-Level Security:</strong> Database-level isolation prevents cross-tenant data access</li>
          <li><strong>Rate limiting:</strong> Brute-force protection with account lockout after 5 failed attempts</li>
          <li><strong>Two-factor authentication:</strong> Available for all staff accounts</li>
          <li><strong>Audit trail:</strong> Every action is logged immutably</li>
          <li><strong>Regular security audits:</strong> We run automated vulnerability scans (npm audit)</li>
        </ul>

        <h2>6. Third-Party Processors</h2>
        <p>We use the following third-party services to operate Ledgerly. Each provider has their own privacy policy and complies with applicable data protection laws.</p>
        <ul>
          <li><strong>Supabase</strong> (supabase.com) — PostgreSQL database hosting. Stores all application data. Servers located in EU (Ireland).</li>
          <li><strong>Render</strong> (render.com) — Backend application hosting. Runs the API server. Servers located in US (Oregon).</li>
          <li><strong>Vercel</strong> (vercel.com) — Frontend application hosting. Serves the web app. Global CDN.</li>
          <li><strong>Resend</strong> (resend.com) — Transactional email delivery. Sends OTP codes, receipts, and weekly summaries.</li>
          <li><strong>Paystack</strong> (paystack.com) — Online payment processing. Processes parent payments (when enabled). PCI-DSS compliant.</li>
          <li><strong>Sentry</strong> (sentry.io) — Error monitoring. Receives anonymized stack traces when the app crashes. No user data is sent.</li>
          <li><strong>Namecheap</strong> (namecheap.com) — Domain registration and DNS management.</li>
        </ul>

        <h2>7. Your Rights (NDPR)</h2>
        <p>Under the Nigeria Data Protection Regulation, you have the right to:</p>
        <ul>
          <li><strong>Access:</strong> Request a copy of your personal data (use the Data Export feature in Settings)</li>
          <li><strong>Rectification:</strong> Correct inaccurate or incomplete data</li>
          <li><strong>Erasure:</strong> Request deletion of your data (use the Data Deletion feature in Settings)</li>
          <li><strong>Portability:</strong> Export your data in a machine-readable format (JSON export available)</li>
          <li><strong>Objection:</strong> Object to processing of your data for specific purposes</li>
          <li><strong>Withdraw consent:</strong> Withdraw consent for processing at any time</li>
        </ul>
        <p>To exercise these rights, contact us at: <strong>joinledgerly.com/contact</strong> or call <strong>0807 323 1954</strong>.</p>

        <h2>8. Data Breach Notification</h2>
        <p>In the event of a data breach, we will:</p>
        <ul>
          <li>Notify affected users within 72 hours of becoming aware of the breach</li>
          <li>Notify the Nigerian Data Protection Commission (NDPC) as required by law</li>
          <li>Take immediate steps to contain and remediate the breach</li>
          <li>Provide affected users with recommendations to protect themselves</li>
        </ul>

        <h2>9. Children's Data</h2>
        <p>Ledgerly stores data about students (who may be children), but this data is entered and managed by the school. We do not directly collect data from children. Schools are responsible for obtaining parental consent for data processing as required by NDPR.</p>

        <h2>10. International Data Transfers</h2>
        <p>Your data is stored on servers located in the EU (Supabase, Ireland) and the US (Render, Oregon; Vercel, global CDN). We ensure appropriate safeguards are in place for international data transfers in compliance with NDPR requirements.</p>

        <h2>11. Cookies</h2>
        <p>Ledgerly uses essential cookies only:</p>
        <ul>
          <li><strong>Refresh token cookie:</strong> HttpOnly, Secure, SameSite=None. Used to keep you logged in. Expires after 30 days.</li>
          <li><strong>Parent refresh token cookie:</strong> Same as above, for parent portal sessions.</li>
        </ul>
        <p>We do NOT use analytics cookies, advertising cookies, or tracking pixels.</p>

        <h2>12. Changes to This Policy</h2>
        <p>We may update this Privacy Policy from time to time. We will notify users of significant changes via email or in-app notification. The "Last updated" date at the top of this page indicates when the policy was last revised.</p>

        <h2>13. Contact</h2>
        <p>For privacy enquiries, data protection requests, or to report a privacy concern:</p>
        <ul>
          <li>Phone: <strong>0807 323 1954</strong></li>
          <li>Email: <strong>noreply@joinledgerly.com</strong></li>
          <li>Website: <strong>joinledgerly.com</strong></li>
        </ul>

        <div style={{ marginTop: 40 }}>
          <Link to="/" className="btn-ghost">← Back to home</Link>
        </div>
      </div>
    </div>
  );
}
