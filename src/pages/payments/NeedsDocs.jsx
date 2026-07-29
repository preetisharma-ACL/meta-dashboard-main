import PaymentsList from "./PaymentsList";

// ─── Needs-Docs queue (accounts / admin) ──────────────────────────────────────
// The payments ledger pre-filtered to ?docs_status=pending — i.e. the amounts
// tier-1 campaign managers entered that still need a reference or invoice.
// Filling the reference flips docs_status to complete server-side, and the row
// leaves this queue on the next read.
//
// Deliberately a thin wrapper, not a second implementation: the queue IS the
// ledger with one server filter pinned, so it inherits the same table, edit
// modal, totals and delete guard for free.
export default function NeedsDocs() {
  return (
    <PaymentsList
      lockDocsStatus="pending"
      kicker="Accounts"
      title="Needs Docs"
      blurb="Payments recorded by campaign managers that are waiting on paperwork. Add a reference to complete one and clear it from this queue."
      emptyHint="Nothing is waiting on paperwork — every payment has its reference."
    />
  );
}
