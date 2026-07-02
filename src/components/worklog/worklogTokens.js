// ─── Worklog design tokens ────────────────────────────────────────────────────
// Shared palette + option lists for the Client Workspace surfaces so the node
// scheme (green = Meta/campaign change, gold = team task, clay = complaint) reads
// identically across My Work and the per-client Activity/Complaints tabs.

// Timeline / row node colours — the mock's exact scheme.
export const NODE_DOT = {
  green: "bg-emerald-500",
  gold: "bg-amber-500",
  clay: "bg-orange-500",
};

export const NODE_SOFT = {
  green:
    "bg-emerald-50 dark:bg-emerald-900/15 border-emerald-200 dark:border-emerald-900/40",
  gold: "bg-amber-50 dark:bg-amber-900/15 border-amber-200 dark:border-amber-900/40",
  clay: "bg-orange-50 dark:bg-orange-900/15 border-orange-200 dark:border-orange-900/40",
};

export const NODE_TEXT = {
  green: "text-emerald-700 dark:text-emerald-300",
  gold: "text-amber-700 dark:text-amber-300",
  clay: "text-orange-700 dark:text-orange-300",
};

// A My Work row's node colour derives from its kind: complaint → clay, task → gold.
export const kindNode = (kind) => (kind === "complaint" ? "clay" : "gold");

// Level chip — the task "priority" and complaint "severity" both arrive as
// `level` on a My Work item; the standalone entities expose them by their own name.
export const LEVEL_CHIP = {
  urgent: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  low: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

// Status chip — shared by complaints (open/in_progress/resolved/closed) and
// tasks (open/in_progress/done).
export const STATUS_CHIP = {
  open: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  closed: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

export const CATEGORY_LABEL = {
  lead_quality: "Lead quality",
  delivery: "Delivery",
  billing: "Billing",
  communication: "Communication",
  other: "Other",
};

// ── Modal option lists ────────────────────────────────────────────────────────
export const CATEGORY_OPTIONS = [
  { value: "lead_quality", label: "Lead quality" },
  { value: "delivery", label: "Delivery" },
  { value: "billing", label: "Billing" },
  { value: "communication", label: "Communication" },
  { value: "other", label: "Other" },
];

export const SEVERITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export const COMPLAINT_STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

// ── Formatting helpers ────────────────────────────────────────────────────────
export const humanize = (s) =>
  String(s ?? "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

export const fmtDate = (iso) =>
  !iso
    ? "—"
    : new Date(iso).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

export const fmtDateTime = (iso) =>
  !iso
    ? "—"
    : new Date(iso).toLocaleString("en-IN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

// Relative "3d ago" style stamp for the timeline; falls back to a date.
export const fmtRelative = (iso) => {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return "—";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
};
