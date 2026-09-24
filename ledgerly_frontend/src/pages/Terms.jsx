import { Link } from "react-router-dom";

// Terms of Service for Ledgerly.
// Public page at /terms. Covers: acceptable use, payment terms, data ownership,
// limitation of liability, termination, KYC requirements, and changes to terms.

export default function Terms() {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <img src="/ledgerly-logo-dark.jpg" alt="Ledgerly" className="auth-wordmark" width="180" height="52" fetchpriority="high" />
        <h1>Terms of Service</h1>
        <p className="legal-sub">Last updated: September 2026</p>
      </header>

      <div className="legal-content">
        <p>These Terms of Service ("Terms") govern your use of Ledgerly, a school fee management platform operated by Ledgerly ("we", "us", "our"). By registering an account or using our services, you agree to these Terms.</p>

        <h2>1. Definitions</h2>
        <ul>
          <li><strong>"School"</strong> — The educational institution registered on Ledgerly</li>
          <li><strong>"Owner"</strong> — The person who registers the school and has full administrative access</li>
          <li><strong>"Staff"</strong> — Any user with access to the school's Ledgerly account (owner, bursar, accountant)</li>
          <li><strong>"Parent"</strong> — A guardian who uses the Parent Portal to view their child's fees</li>
          <li><strong>"Platform"</strong> — The Ledgerly web application at joinledgerly.com</li>
          <li><strong>"KYC"</strong> — Know Your Customer verification data collected during onboarding</li>
        </ul>

        <h2>2. Account Registration and KYC</h2>
        <h3>2.1 Registration</h3>
        <p>To use Ledgerly, you must:</p>
        <ul>
          <li>Be at least 18 years old</li>
          <li>Be authorised to represent the school you are registering</li>
          <li>Provide accurate and complete information during registration</li>
          <li>Complete the KYC (Know Your Customer) form before accessing the platform</li>
        </ul>

        <h3>2.2 KYC Requirements</h3>
        <p>As part of our compliance with Nigerian data protection regulations, all schools must complete KYC verification, which includes:</p>
        <ul>
          <li>School identity (type, education level, year established)</li>
          <li>Location (full address, LGA, state)</li>
          <li>Regulatory information (registration number, registration type)</li>
          <li>Operational details (student count, calendar type, classes offered)</li>
          <li>Agreement to these Terms and our Privacy Policy</li>
        </ul>
        <p>You acknowledge that providing false or misleading KYC information may result in immediate account suspension.</p>

        <h3>2.3 Account Security</h3>
        <p>You are responsible for:</p>
        <ul>
          <li>Maintaining the confidentiality of your login credentials</li>
          <li>All activities that occur under your account</li>
          <li>Notifying us immediately of any unauthorized access</li>
          <li>Ensuring all staff members use their own individual accounts (not shared logins)</li>
        </ul>
        <p>We recommend enabling Two-Factor Authentication (2FA) for all owner accounts.</p>

        <h2>3. Acceptable Use</h2>
        <p>You agree NOT to:</p>
        <ul>
          <li>Use Ledgerly for any illegal purpose</li>
          <li>Enter false or misleading payment records</li>
          <li>Use the platform to launder money or facilitate fraud</li>
          <li>Attempt to access another school's data</li>
          <li>Reverse engineer, decompile, or disassemble the platform</li>
          <li>Use automated scripts (bots) to access the platform without authorization</li>
          <li>Upload malicious files or malware</li>
          <li>Share your account credentials with unauthorized persons</li>
        </ul>

        <h2>4. Subscription and Payment</h2>
        <h3>4.1 Free Term</h3>
        <p>New schools receive their first term (approximately 3 months) free of charge. No credit card is required to start the free term.</p>

        <h3>4.2 Paid Plans</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 16 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E4E3DD' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Plan</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Price</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Students</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #E4E3DD' }}>
              <td style={{ padding: '8px' }}>Free Term</td>
              <td style={{ padding: '8px' }}>₦0 (first term)</td>
              <td style={{ padding: '8px' }}>Unlimited</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #E4E3DD' }}>
              <td style={{ padding: '8px' }}>Starter</td>
              <td style={{ padding: '8px' }}>₦5,000/month</td>
              <td style={{ padding: '8px' }}>Up to 500</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #E4E3DD' }}>
              <td style={{ padding: '8px' }}>Pro</td>
              <td style={{ padding: '8px' }}>₦15,000/month</td>
              <td style={{ padding: '8px' }}>Unlimited</td>
            </tr>
          </tbody>
        </table>

        <h3>4.3 Payment Terms</h3>
        <ul>
          <li>Subscription fees are billed monthly in Nigerian Naira (₦)</li>
          <li>Payment is due before the start of each billing period</li>
          <li>We accept bank transfer and online payment via Paystack (when available)</li>
          <li>Annual billing (10 months for the price of 12) is available on request</li>
          <li>All fees are exclusive of applicable taxes</li>
        </ul>

        <h3>4.4 Non-Payment</h3>
        <p>If subscription fees are not paid by the due date:</p>
        <ul>
          <li>Access to the platform will be suspended after a 7-day grace period</li>
          <li>Data will be retained for 30 days during which payment can restore access</li>
          <li>After 30 days of non-payment, the account may be permanently deleted</li>
        </ul>

        <h3>4.5 Refunds</h3>
        <p>Subscription fees are non-refundable. If you cancel mid-month, you retain access until the end of the billing period but no refund is issued for unused days.</p>

        <h2>5. Data Ownership</h2>
        <ul>
          <li><strong>You own your data.</strong> All student records, payment data, and financial information entered into Ledgerly belongs to the school.</li>
          <li>Ledgerly acts as a data processor on behalf of the school (the data controller).</li>
          <li>You may export your data at any time using the Data Export feature.</li>
          <li>Upon account deletion, all data is permanently removed after a 30-day grace period.</li>
          <li>Ledgerly retains audit logs for 7 years as required by Nigerian tax law, even after account deletion.</li>
        </ul>

        <h2>6. Privacy and Data Protection</h2>
        <p>Your use of Ledgerly is also governed by our <Link to="/privacy" style={{ color: '#14213D', fontWeight: 600 }}>Privacy Policy</Link>, which describes how we collect, use, and protect your data in compliance with the Nigeria Data Protection Regulation (NDPR) 2019.</p>

        <h2>7. Service Availability</h2>
        <ul>
          <li>We strive for 99.5% uptime but do not guarantee uninterrupted service.</li>
          <li>Scheduled maintenance is performed outside business hours when possible.</li>
          <li>We are not liable for downtime caused by third-party providers (hosting, DNS, payment processors).</li>
          <li>The platform may be unavailable during the first 15 minutes of inactivity on the free hosting tier (cold start). Upgrading to a paid plan eliminates this.</li>
        </ul>

        <h2>8. Limitation of Liability</h2>
        <ul>
          <li>Ledgerly is provided "as is" without warranties of any kind.</li>
          <li>We are not liable for lost revenue, lost data, or business interruption.</li>
          <li>Our total liability shall not exceed the amount paid by the school in the 3 months preceding the claim.</li>
          <li>We are not responsible for the accuracy of data entered by school staff.</li>
          <li>We are not responsible for financial decisions made based on reports generated by the platform.</li>
          <li>Schools are responsible for reconciling Ledgerly records with their bank statements.</li>
        </ul>

        <h2>9. Termination</h2>
        <h3>9.1 Termination by You</h3>
        <p>You may terminate your account at any time by:</p>
        <ul>
          <li>Using the Data Deletion feature in Settings</li>
          <li>Contacting us at 0807 323 1954</li>
        </ul>
        <p>Upon termination, your data will be retained for 30 days then permanently deleted (except audit logs retained for 7 years).</p>

        <h3>9.2 Termination by Us</h3>
        <p>We may suspend or terminate your account if:</p>
        <ul>
          <li>You violate these Terms</li>
          <li>You provide false KYC information</li>
          <li>You use the platform for fraudulent or illegal activities</li>
          <li>Subscription fees remain unpaid for more than 37 days</li>
          <li>We are required to do so by law</li>
        </ul>

        <h2>10. Intellectual Property</h2>
        <ul>
          <li>Ledgerly, its source code, design, and branding are the intellectual property of Ledgerly.</li>
          <li>Schools retain ownership of all data they enter into the platform.</li>
          <li>Schools may upload their logo for receipt branding — the logo remains the school's property.</li>
          <li>The "Powered by Ledgerly" text on receipts may not be removed without a Pro subscription.</li>
        </ul>

        <h2>11. Contingency Planning</h2>
        <p>Ledgerly provides a contingency planning module to help schools identify and respond to financial risks. However:</p>
        <ul>
          <li>Contingency plans are advisory only — the school is responsible for all financial decisions.</li>
          <li>Automated trigger alerts are based on data entered into the system and may not reflect real-time financial conditions.</li>
          <li>Ledgerly does not automatically execute financial actions (moving money, cancelling payments, etc.).</li>
          <li>Schools should always verify financial data with their bank statements before acting on contingency alerts.</li>
        </ul>

        <h2>12. Changes to Terms</h2>
        <p>We may update these Terms from time to time. We will notify users of significant changes via email or in-app notification at least 14 days before the changes take effect. Continued use of Ledgerly after the effective date constitutes acceptance of the updated Terms.</p>

        <h2>13. Governing Law</h2>
        <p>These Terms are governed by the laws of the Federal Republic of Nigeria. Any disputes shall be resolved in the courts of Nigeria.</p>

        <h2>14. Contact</h2>
        <p>For questions about these Terms:</p>
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
