import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client";
import { naira } from "../utils/format";

// Receipts browser — owner / accountant / bursar.
//
// Lists every receipt issued in the tenant, with date-range filters and a
// client-side student-name search. Each row links back to the receipt PDF via
// the existing `GET /payments/:paymentId/receipt` endpoint.
//
// NOTE on payment_id: the backend `listReceipts` SELECT (see
// `receipts.controller.js`) currently returns `r.id, r.receipt_number,
// r.issued_at, p.amount, p.method, p.paid_on, student_name, student_class,
// fee_head_name, issued_by_name` — it does NOT include `r.payment_id`. So the
// Download PDF button below can only call `/payments/:paymentId/receipt` when
// the row exposes `payment_id`. Until the backend adds `r.payment_id AS
// payment_id` to that SELECT (or exposes a `/receipts/:id/pdf` endpoint), the
// button gracefully degrades: rows without `payment_id` show a disabled button
// with a tooltip pointing users at the student's payment history. The check is
// written defensively so the button lights up automatically the moment the
// backend starts returning `payment_id`.

const PAGE_SIZE = 50;

// "DD MMM YYYY" — e.g. "03 Feb 2025". Tolerates ISO strings, full timestamps,
// and date-only inputs (paid_on comes back as a YYYY-MM-DD string from the DB).
function fmtDay(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}

// Render the payment method as a human title (bank_transfer → "Bank Transfer").
// Falls back to the raw value for any future method we don't know about.
function fmtMethod(m) {
  if (!m) return "—";
  return m
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export default function Receipts() {
  const [receipts, setReceipts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  // Filters. `from`/`to` are sent to the server; `studentQuery` is applied
  // client-side on the loaded page (the backend filter is by studentId, not
  // name, so we can't push a name filter to the server without first resolving
  // it to a UUID).
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [studentQuery, setStudentQuery] = useState("");

  // `appliedFrom`/`appliedTo` are the values actually used in the last load —
  // we only re-fetch when the user clicks "Apply filters", not on every
  // keystroke. This mirrors the AuditLog/Reports filter pattern.
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (appliedFrom) params.set("from", appliedFrom);
    if (appliedTo) params.set("to", appliedTo);
    api
      .get(`/receipts?${params.toString()}`)
      .then((d) => {
        setReceipts(d.receipts || []);
        setTotal(d.total || 0);
      })
      .catch((e) => setError(e.message || "Could not load receipts"))
      .finally(() => setLoading(false));
  }, [page, appliedFrom, appliedTo]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const applyFilters = () => {
    setAppliedFrom(from);
    setAppliedTo(to);
    setPage(1);
  };

  const clearFilters = () => {
    setFrom("");
    setTo("");
    setAppliedFrom("");
    setAppliedTo("");
    setStudentQuery("");
    setPage(1);
  };

  const downloadPdf = async (r) => {
    const paymentId = r.payment_id;
    if (!paymentId) {
      // Graceful degradation — see the file-level note. The backend
      // listReceipts SELECT doesn't currently include payment_id, so we can't
      // reach `/payments/:paymentId/receipt` from this view. Point the user at
      // the student's payment history, where the Print receipt button has the
      // payment_id in hand.
      alert(
        "This receipt's payment ID isn't exposed by the receipts list. Open the student in Students → expand their record → Payments to download the receipt PDF."
      );
      return;
    }
    setBusyId(r.id);
    try {
      await api.openPdf(`/payments/${paymentId}/receipt`);
    } catch (e) {
      alert(e.message || "Could not open receipt PDF");
    } finally {
      setBusyId(null);
    }
  };

  // Client-side student-name filter on the loaded page. Cheap (<=50 rows) and
  // gives instant feedback without an extra round-trip.
  const filtered = studentQuery.trim()
    ? receipts.filter((r) =>
        (r.student_name || "").toLowerCase().includes(studentQuery.trim().toLowerCase())
      )
    : receipts;

  const showing = filtered.length;

  return (
    <div>
      <p className="page-intro">
        Browse all issued receipts. Click a row to download the PDF.
      </p>

      {error && <div className="form-error">{error}</div>}

      <div className="toolbar">
        <div className="toolbar-left">
          <input
            className="search-input"
            type="search"
            placeholder="Filter by student name…"
            value={studentQuery}
            onChange={(e) => setStudentQuery(e.target.value)}
          />
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--ink-soft)" }}>
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              style={{ marginTop: 2 }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--ink-soft)" }}>
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={{ marginTop: 2 }}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-primary" onClick={applyFilters}>Apply filters</button>
          <button className="btn-ghost" onClick={clearFilters}>Clear</button>
        </div>
      </div>

      {loading && <div className="page-loading">Loading receipts…</div>}

      {!loading && filtered.length === 0 && (
        <div className="empty-state">
          No receipts found. {total === 0 ? "Record a payment first — a receipt is issued automatically when you print or email it from the student's payment history." : "Try widening your date range or clearing the student filter."}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <>
          <div style={{ overflowX: "auto" }}>
            <table className="fee-table">
              <thead>
                <tr>
                  <th>Receipt #</th>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Fee Head</th>
                  <th className="num">Amount</th>
                  <th>Method</th>
                  <th>Paid On</th>
                  <th>Issued At</th>
                  <th>Issued By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const hasPaymentId = !!r.payment_id;
                  const tip = hasPaymentId
                    ? "Download receipt PDF"
                    : "Open this student in Students → Payments to download the receipt (payment_id not exposed by the receipts list).";
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600, color: "var(--navy)" }}>{r.receipt_number || "—"}</td>
                      <td>{r.student_name || "—"}</td>
                      <td>{r.student_class || "—"}</td>
                      <td>{r.fee_head_name || "—"}</td>
                      <td className="num" style={{ color: "#1B7A43", fontWeight: 600 }}>{naira(r.amount)}</td>
                      <td>{fmtMethod(r.method)}</td>
                      <td>{fmtDay(r.paid_on)}</td>
                      <td>{fmtDay(r.issued_at)}</td>
                      <td>{r.issued_by_name || "—"}</td>
                      <td>
                        <button
                          className="btn-ghost"
                          title={tip}
                          disabled={!hasPaymentId || busyId === r.id}
                          onClick={() => downloadPdf(r)}
                        >
                          {busyId === r.id ? "Opening…" : "Download PDF"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
            <span className="pagination-info">
              Showing {showing} of {total}
            </span>
            <button className="btn-ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        </>
      )}
    </div>
  );
}
