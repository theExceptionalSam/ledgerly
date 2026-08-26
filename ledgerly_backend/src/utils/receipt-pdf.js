'use strict';

/**
 * Receipt PDF generator for school fee payments.
 *
 * Produces an A4 portrait PDF receipt branded with the Ledgerly palette.
 * Returns a Promise<Buffer> so callers can stream it to the HTTP response
 * or attach it to an email.
 *
 * Font strategy
 * -------------
 * The host does not ship the brand fonts (Newsreader / Inter), so we use
 * pdfkit's built-in `Times-Roman` / `Times-Bold` (serif, ~Newsreader) and
 * `Helvetica` / `Helvetica-Bold` (sans, ~Inter) as the closest substitutes,
 * per the v2 upgrade conventions.
 *
 * One exception: the Naira sign "₦" (U+20A6) is NOT representable in
 * pdfkit's WinAnsi encoding used by the built-in fonts — pdfkit silently
 * substitutes it with the broken-bar "¦". To render the currency symbol
 * correctly on the two amount runs, we register DejaVu Sans Bold and
 * DejaVu Serif Bold (both ship on the host under /usr/share/fonts) as
 * Unicode-capable stand-ins. They are visually close to Helvetica-Bold
 * and Times-Bold respectively, so the deviation is invisible to the eye.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');

// ---- Brand palette ----------------------------------------------------------
const COLORS = {
  navy: '#14213D',     // headings / ink
  green: '#1B7A43',    // paid / total
  red: '#B3261E',      // outstanding (unused on receipt but kept for parity)
  neutral: '#5B5B54',  // body text
  tint: '#F0F2F6',     // light navy tint for the total band
  border: '#E4E3DD',   // row separator
  white: '#FFFFFF',
};

// ---- Page geometry (A4 portrait, points) ------------------------------------
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// ---- Unicode-capable font registration -------------------------------------
// Only used for text runs that include the Naira sign (₦).
const UNICODE_FONTS = {
  sansBold: {
    name: 'NairaSans-Bold',
    path: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    fallback: 'Helvetica-Bold',
  },
  serifBold: {
    name: 'NairaSerif-Bold',
    path: '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
    fallback: 'Times-Bold',
  },
};

function registerUnicodeFonts(doc) {
  const available = {};
  for (const [key, def] of Object.entries(UNICODE_FONTS)) {
    try {
      if (fs.existsSync(def.path)) {
        doc.registerFont(def.name, def.path);
        available[key] = def.name;
      } else {
        available[key] = def.fallback;
      }
    } catch (e) {
      available[key] = def.fallback;
    }
  }
  return available;
}

// Format amount for display. Uses ₦ if Unicode fonts are available,
// otherwise falls back to "NGN" text (avoids the broken-bar character
// that pdfkit's WinAnsi encoding produces for ₦).
function formatNaira(amount, hasUnicodeFonts) {
  const v = Number(amount) || 0;
  const formatted = v.toLocaleString("en-NG", { maximumFractionDigits: 0 });
  return hasUnicodeFonts ? `₦${formatted}` : `NGN ${formatted}`;
}

// ---- Formatting helpers -----------------------------------------------------

/**
 * Convert a non-negative integer (0 – 999,999,999) to English words.
 * Examples: 0 → "Zero", 15 → "Fifteen", 15000 → "Fifteen Thousand",
 *           1234567 → "One Million Two Hundred and Thirty-Four Thousand
 *                      Five Hundred and Sixty-Seven"
 */
function numberToWords(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n > 999999999) {
    // Clamp to supported range rather than producing garbage.
    n = n % 1000000000;
  }
  if (n === 0) return 'Zero';

  const ones = [
    'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven',
    'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
    'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tens = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty',
    'Sixty', 'Seventy', 'Eighty', 'Ninety',
  ];

  function below100(num) {
    if (num < 20) return ones[num];
    const t = Math.floor(num / 10);
    const o = num % 10;
    return o === 0 ? tens[t] : tens[t] + '-' + ones[o];
  }

  function below1000(num) {
    const h = Math.floor(num / 100);
    const rest = num % 100;
    let str = '';
    if (h > 0) str += ones[h] + ' Hundred';
    if (rest > 0) {
      if (str) str += ' and ';
      str += below100(rest);
    }
    return str;
  }

  const parts = [];
  const millions = Math.floor(n / 1000000);
  const thousands = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;

  if (millions > 0) parts.push(below1000(millions) + ' Million');
  if (thousands > 0) parts.push(below1000(thousands) + ' Thousand');
  if (rest > 0) parts.push(below1000(rest));

  return parts.join(' ');
}

// (formatNaira is defined above with Unicode-font awareness)

/** Format an ISO date (or "YYYY-MM-DD") as "DD MMM YYYY". */
function formatDate(dateStr) {
  if (!dateStr) return '';
  let d;
  if (dateStr instanceof Date) {
    d = dateStr;
  } else if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    // Parse the Y/M/D directly to avoid UTC-offset off-by-one errors.
    const [y, m, day] = dateStr.slice(0, 10).split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date(dateStr);
  }
  if (isNaN(d.getTime())) return String(dateStr);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const day = String(d.getDate()).padStart(2, '0');
  return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** Map a raw payment method code to its human label. */
function capitalizeMethod(method) {
  if (!method) return '';
  const map = {
    cash: 'Cash',
    bank_transfer: 'Bank Transfer',
    pos: 'POS',
    cheque: 'Cheque',
    online: 'Online',
  };
  if (map[method]) return map[method];
  return method
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---- Main generator ---------------------------------------------------------

/**
 * Build a receipt PDF for a single fee payment.
 *
 * @param {Object} opts
 * @param {{name:string}} opts.tenant           School issuing the receipt.
 * @param {{name:string, class?:string, admission_no?:string}} opts.student
 * @param {string} opts.feeHeadName             e.g. "Tuition".
 * @param {{amount:number, method:string, paid_on:string, issued_at?:string}} opts.payment
 * @param {string} opts.receiptNumber           e.g. "LHA-2026-00042".
 * @param {string} opts.termName                e.g. "First Term".
 * @param {string} opts.recordedByName          Staff who recorded the payment.
 * @returns {Promise<Buffer>}
 */
function generateReceiptPdf({
  tenant,
  student,
  feeHeadName,
  payment,
  receiptNumber,
  termName,
  recordedByName,
}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const unicodeFonts = registerUnicodeFonts(doc);
      const hasUnicodeFonts = unicodeFonts.sansBold !== 'Helvetica-Bold' && unicodeFonts.serifBold !== 'Times-Bold';

      // Normalise inputs (defensive — callers may pass partial objects).
      const tenantName = (tenant && tenant.name) || 'School';
      const studentName = (student && student.name) || '';
      const studentClass = (student && student.class) || '';
      const admissionNo = (student && student.admission_no) || '';
      const amount = Number(payment && payment.amount) || 0;
      const issuedAt =
        (payment && (payment.issued_at || payment.paid_on)) ||
        new Date().toISOString();
      const paidOn = (payment && payment.paid_on) || '';
      const method = (payment && payment.method) || '';

      // =====================================================================
      // 1. HEADER BAND
      // =====================================================================
      doc.rect(0, 0, PAGE_WIDTH, 80).fill(COLORS.navy);

      // School name (top-left) — Times-Bold 18pt white. Constrain width so a
      // long school name wraps before colliding with the receipt number.
      doc.fillColor(COLORS.white)
        .font('Times-Bold')
        .fontSize(18)
        .text(tenantName, MARGIN, 22, {
          align: 'left',
          width: CONTENT_WIDTH - 200,
        });

      // "OFFICIAL RECEIPT" subtitle (letter-spaced) — Helvetica 10pt white.
      doc.fillColor(COLORS.white)
        .font('Helvetica')
        .fontSize(10)
        .text('O F F I C I A L   R E C E I P T', MARGIN, 50, {
          align: 'left',
        });

      // Receipt number (top-right) — Helvetica-Bold 11pt white.
      doc.fillColor(COLORS.white)
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(receiptNumber || '', MARGIN, 24, {
          align: 'right',
          width: CONTENT_WIDTH,
        });

      // =====================================================================
      // 2. BODY
      // =====================================================================
      let y = 110;

      // Right-aligned date line — Helvetica 10pt, neutral.
      doc.fillColor(COLORS.neutral)
        .font('Helvetica')
        .fontSize(10)
        .text('Date: ' + formatDate(issuedAt), MARGIN, y, {
          align: 'right',
          width: CONTENT_WIDTH,
        });
      y += 16;

      // Term name line — Helvetica 10pt, neutral.
      doc.fillColor(COLORS.neutral)
        .font('Helvetica')
        .fontSize(10)
        .text('Term: ' + (termName || ''), MARGIN, y, { align: 'left' });
      y += 18;

      // Thin horizontal rule (navy, 1pt).
      doc.moveTo(MARGIN, y)
        .lineTo(PAGE_WIDTH - MARGIN, y)
        .strokeColor(COLORS.navy)
        .lineWidth(1)
        .stroke();
      y += 16;

      // "BILLED TO" label — Helvetica-Bold 9pt navy, letter-spaced.
      doc.fillColor(COLORS.navy)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('B I L L E D   T O', MARGIN, y, { align: 'left' });
      y += 16;

      // Student name — Times-Bold 14pt ink navy.
      doc.fillColor(COLORS.navy)
        .font('Times-Bold')
        .fontSize(14)
        .text(studentName, MARGIN, y, { align: 'left' });
      y += 20;

      // Class + admission number — Helvetica 10pt neutral.
      const metaParts = [];
      if (studentClass) metaParts.push('Class: ' + studentClass);
      if (admissionNo) metaParts.push('Admission No: ' + admissionNo);
      const metaLine = metaParts.join('  ·  ');
      doc.fillColor(COLORS.neutral)
        .font('Helvetica')
        .fontSize(10)
        .text(metaLine, MARGIN, y, { align: 'left' });
      y += 24;

      // ---- Details table (2 columns: label left, value right) ------------
      const rows = [
        ['Fee Head', feeHeadName || ''],
        ['Amount Paid (figures)', formatNaira(amount, hasUnicodeFonts)],
        ['Amount Paid (in words)', numberToWords(amount) + ' Naira Only'],
        ['Payment Method', capitalizeMethod(method)],
        ['Date Paid', formatDate(paidOn)],
        ['Recorded By', recordedByName || ''],
      ];

      const rowPad = 8;
      const valueRightX = PAGE_WIDTH - MARGIN;

      for (const [label, value] of rows) {
        // Label — Helvetica 10pt neutral.
        doc.fillColor(COLORS.neutral)
          .font('Helvetica')
          .fontSize(10)
          .text(label, MARGIN, y, { align: 'left' });

        // Value — Helvetica-Bold 11pt ink navy.
        // The "figures" row carries the ₦ sign; render it with the
        // Unicode-capable sans font so the currency symbol is not dropped.
        const isFiguresRow = label === 'Amount Paid (figures)';
        const valueFont = isFiguresRow
          ? unicodeFonts.sansBold
          : 'Helvetica-Bold';

        doc.fillColor(COLORS.navy)
          .font(valueFont)
          .fontSize(11)
          .text(String(value), MARGIN, y, {
            align: 'right',
            width: CONTENT_WIDTH,
          });

        y += 14 + rowPad;

        // Row bottom border — 0.5pt pale rule.
        doc.moveTo(MARGIN, y)
          .lineTo(valueRightX, y)
          .strokeColor(COLORS.border)
          .lineWidth(0.5)
          .stroke();
        y += rowPad;
      }

      y += 8;

      // ---- Total band -----------------------------------------------------
      const bandHeight = 40;
      doc.rect(MARGIN, y, CONTENT_WIDTH, bandHeight).fill(COLORS.tint);

      doc.fillColor(COLORS.navy)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('TOTAL PAID', MARGIN + 14, y + 14, { align: 'left' });

      // Total amount — Times-Bold 16pt green. Use the Unicode serif stand-in
      // so the ₦ sign renders.
      doc.fillColor(COLORS.green)
        .font(unicodeFonts.serifBold)
        .fontSize(16)
        .text(formatNaira(amount, hasUnicodeFonts), MARGIN + 14, y + 11, {
          align: 'right',
          width: CONTENT_WIDTH - 28,
        });

      // =====================================================================
      // 3. FOOTER
      // =====================================================================
      const footerY = PAGE_HEIGHT - 60;

      // Centered horizontal rule (navy 0.5pt).
      const ruleInset = 140;
      doc.moveTo(ruleInset, footerY)
        .lineTo(PAGE_WIDTH - ruleInset, footerY)
        .strokeColor(COLORS.navy)
        .lineWidth(0.5)
        .stroke();

      // Centered disclaimer — Helvetica-Oblique 9pt neutral.
      doc.fillColor(COLORS.neutral)
        .font('Helvetica-Oblique')
        .fontSize(9)
        .text(
          'This is a system-generated receipt.',
          MARGIN,
          footerY + 8,
          { align: 'center', width: CONTENT_WIDTH }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateReceiptPdf,
  // Exported for unit testing / reuse by other modules.
  numberToWords,
  formatNaira,
  formatDate,
  capitalizeMethod,
};
