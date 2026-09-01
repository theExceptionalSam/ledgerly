import { Link } from "react-router-dom";

// Terms of Service for Ledgerly — a Nigerian school fee tracker SaaS.
// Public page at /terms. Static content; updates require a code deploy.
//
// Covers: acceptable use, payment terms, data ownership, limitation of liability,
// termination, and changes to terms.

export default function Terms() {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <img src="/ledgerly-logo-dark.jpg" alt="Ledgerly" className="auth-wordmark" width="180" height="52" fetchpriority="high" />
        <h1>Terms of Service</h1>
        <p className="legal-sub">Last updated: {new Date().getFullYear()}</p>
      </header>

      <Section title="1. Agreement to terms">
        <p>
          These Terms of Service ("Terms") govern your use of Ledgerly (the "Service"), operated from
          Nigeria. By creating an account or otherwise using the Service, you agree to be bound by
          these Terms and our <Link to="/privacy">Privacy Policy</Link>. If you do not agree, do not
          use the Service.
        </p>
        <p>
          "You" refers to the school or educational institution that registers for the Service, and
          the individual owner who signs the registration. The owner is authorised to bind the school
          to these Terms.
        </p>
      </Section>

      <Section title="2. Acceptable use">
        <p>You agree to use the Service only for lawful school fee and finance management. You will not:</p>
        <ul>
          <li>Use the Service to process payments for illegal activities, money laundering, or terrorism financing.</li>
          <li>Enter false, misleading, or fraudulent payment records, or use the Service to evade tax.</li>
          <li>Share your account credentials, API keys, or access tokens with unauthorised parties.</li>
          <li>Attempt to reverse engineer, disassemble, or otherwise extract source code from the Service.</li>
          <li>Use the Service to send unsolicited SMS, email, or WhatsApp messages (spam).</li>
          <li>Upload malware, viruses, or any code designed to disrupt the Service.</li>
          <li>Scrape, crawl, or otherwise access the Service in a way that creates disproportionate load.</li>
          <li>Use the Service to store data unrelated to school fee management.</li>
        </ul>
        <p>
          Violations may result in immediate account suspension, data deletion, and reporting to the
          appropriate Nigerian authorities.
        </p>
      </Section>

      <Section title="3. Your account">
        <p>
          You must provide accurate information at registration: school name, owner name, contact phone,
          and email. You are responsible for maintaining the security of your account and for all
          activity that occurs under your account. Notify us immediately at
          <a href="mailto:security@ledgerly.app"> security@ledgerly.app</a> if you suspect unauthorised
          access.
        </p>
        <p>
          You may invite additional staff (bursars, accountants, assistants) to your school's account
          and assign roles. You are responsible for their use of the Service.
        </p>
      </Section>

      <Section title="4. Subscription and payment terms">
        <p>
          Ledgerly offers several subscription plans, listed on our <Link to="/pricing">pricing page</Link>.
          Plans are billed in Nigerian Naira (₦) on a monthly or yearly cycle. By subscribing to a paid
          plan, you authorise us to charge your chosen payment method (via Paystack) until you cancel.
        </p>
        <ul>
          <li><strong>Billing cycle:</strong> Monthly plans are billed every 30 days; yearly plans every 365 days.</li>
          <li><strong>Auto-renewal:</strong> Subscriptions auto-renew at the end of each cycle unless cancelled before the renewal date.</li>
          <li><strong>Cancellation:</strong> You may cancel at any time from your account settings. Cancellation takes effect at the end of the current billing cycle — no refunds for partial cycles.</li>
          <li><strong>Taxes:</strong> Prices exclude Value Added Tax (VAT) and any other applicable taxes, which will be added at checkout where required by Nigerian law.</li>
          <li><strong>Fee changes:</strong> We may change plan prices with at least 30 days' notice. Existing subscribers keep the current price for the remainder of the current cycle.</li>
          <li><strong>Free plan:</strong> The Free plan has a 50-student limit and is provided at no cost. We may modify or discontinue the Free plan with 60 days' notice.</li>
        </ul>
      </Section>

      <Section title="5. Data ownership">
        <p>
          You retain all rights to the data you enter into the Service (student records, payment
          records, branding assets, etc.). We process this data on your behalf as a data processor
          under the NDPR, and only as described in our <Link to="/privacy">Privacy Policy</Link>.
        </p>
        <p>
          You may export your data at any time using the in-app export tools (CSV, Excel) or by
          submitting a data portability request to <a href="mailto:privacy@ledgerly.app">privacy@ledgerly.app</a>.
          Upon account termination, we delete your data subject to the retention periods in the
          Privacy Policy.
        </p>
        <p>
          We retain a perpetual, royalty-free licence to use aggregate, anonymised usage data (e.g.
          "average fees collected per school") for product improvement and benchmarking — this data
          never identifies you or your students.
        </p>
      </Section>

      <Section title="6. Service availability">
        <p>
          We target 99.5% uptime for the Service, excluding scheduled maintenance (announced at least
          48 hours in advance) and events outside our control (internet outages, force majeure). We do
          not warrant that the Service will be uninterrupted or error-free.
        </p>
        <p>
          If we fail to meet the uptime target in a calendar month, eligible subscribers may request a
          service credit equal to 10% of their monthly subscription fee. Service credits are not
          refundable for cash.
        </p>
      </Section>

      <Section title="7. Limitation of liability">
        <p>
          To the maximum extent permitted by Nigerian law:
        </p>
        <ul>
          <li>The Service is provided "as is" and "as available", without warranties of any kind.</li>
          <li>We are not liable for indirect, incidental, special, consequential, or punitive damages.</li>
          <li>Our total aggregate liability for any claim arising from these Terms or your use of the Service is limited to the amount you paid us in the 12 months preceding the claim.</li>
          <li>We are not liable for lost revenue, lost data, or business interruption resulting from your use of, or inability to use, the Service.</li>
          <li>We are not liable for the accuracy of payment data you enter, nor for the actions of payment processors (Paystack) or messaging providers (Termii, Resend).</li>
        </ul>
        <p>
          You acknowledge that you are responsible for backing up critical data and for verifying
          payment records before issuing receipts or filing taxes.
        </p>
      </Section>

      <Section title="8. Indemnification">
        <p>
          You agree to indemnify and hold harmless Ledgerly and its operators, employees, and
          contractors from any claim, loss, or damage (including legal fees) arising from: (a) your
          breach of these Terms, (b) your misuse of the Service, (c) the data you enter, or (d) any
          dispute between you and your students, parents, or staff regarding fees.
        </p>
      </Section>

      <Section title="9. Termination">
        <p>
          You may terminate your account at any time from your account settings. Upon termination,
          your access to the Service ceases immediately, and your data will be deleted subject to the
          retention periods in our Privacy Policy.
        </p>
        <p>
          We may suspend or terminate your account immediately if: (a) you breach these Terms,
          (b) your account is inactive for more than 12 months, (c) we are required to do so by law,
          or (d) we cease to operate the Service (with at least 60 days' notice where possible).
        </p>
        <p>
          Upon termination, all amounts owed under your subscription become immediately due. Sections
          5, 7, 8, and 10-12 survive termination.
        </p>
      </Section>

      <Section title="10. Intellectual property">
        <p>
          The Service, including its design, source code, branding, and documentation, is the property
          of Ledgerly and is protected by Nigerian and international intellectual property laws. These
          Terms do not grant you any right to use the Ledgerly name, logo, or trademarks except as
          required to access the Service.
        </p>
      </Section>

      <Section title="11. Governing law and disputes">
        <p>
          These Terms are governed by the laws of the Federal Republic of Nigeria. Any dispute arising
          from these Terms or the Service will first be referred to amicable negotiation. If unresolved
          within 30 days, the dispute will be settled by arbitration in Lagos under the Arbitration and
          Conciliation Act, by a single arbitrator appointed under the Lagos Court of Arbitration rules.
        </p>
      </Section>

      <Section title="12. Changes to terms">
        <p>
          We may update these Terms from time to time. We will notify you of material changes by email
          and by posting a banner in the app at least 30 days before the change takes effect. Continued
          use after the effective date constitutes acceptance of the updated Terms. If you do not agree
          to the changes, you may cancel your subscription before the effective date.
        </p>
      </Section>

      <Section title="13. Contact">
        <p>
          For any question about these Terms, contact us:
        </p>
        <p>
          <strong>Email:</strong> <a href="mailto:legal@ledgerly.app">legal@ledgerly.app</a><br />
          <strong>Postal:</strong> Ledgerly Legal, Lagos, Nigeria
        </p>
      </Section>

      <div className="legal-footer-nav">
        <Link to="/privacy">Privacy Policy</Link>
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
