import { createSignal } from "solid-js";

// `initial` lets a table open on a meaningful column (e.g. the coordination
// payments table starts on closing-balance ascending so debtors are on top).
// Omit it and the behaviour is what every existing caller already gets: no
// column selected, so the incoming API order is preserved.
export default function useColumnSort(initial = { key: "", direction: "desc" }) {
  const [columnSort, setColumnSort] = createSignal({
    key: initial.key ?? "",
    direction: initial.direction ?? "desc",
  });

  const handleSort = (key) => {
    setColumnSort((prev) => {
      if (prev.key === key) {
        return {
          key,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      const textColumns = ["name", "location", "type", "status"];

      return {
        key,
        direction: textColumns.includes(key) ? "asc" : "desc",
      };
    });
  };

  const getSortIcon = (key) => {
    const current = columnSort();
    if (current.key !== key) return "⇅";
    return current.direction === "asc" ? "↑" : "↓";
  };

  const sortData = (data) => {
    const { key, direction } = columnSort();

    if (!key) return data;

    return [...data].sort((a, b) => {
      let valA = a[key];
      let valB = b[key];

      // number sorting
      const isNumber = typeof valA === "number" && typeof valB === "number";

      if (isNumber) {
        return direction === "asc" ? valA - valB : valB - valA;
      }

      // string sorting
      return direction === "asc"
        ? String(valA || "").localeCompare(String(valB || ""), undefined, {
            sensitivity: "base",
          })
        : String(valB || "").localeCompare(String(valA || ""), undefined, {
            sensitivity: "base",
          });
    });
  };

  const resetSort = () => {
    setColumnSort({
      key: initial.key ?? "",
      direction: initial.direction ?? "desc",
    });
  };

  return {
    columnSort,
    handleSort,
    getSortIcon,
    sortData,
    resetSort,
  };
}
