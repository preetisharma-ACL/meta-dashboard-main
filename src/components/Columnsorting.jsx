import { createSignal } from "solid-js";

export default function useColumnSort() {
  const [columnSort, setColumnSort] = createSignal({
    key: "",
    direction: "desc",
  });

  const handleSort = (key) => {
    setColumnSort((prev) => {
      if (prev.key === key) {
        return {
          key,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { key, direction: "desc" };
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
      const isNumber =
        typeof valA === "number" && typeof valB === "number";

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

  return {
    columnSort,
    handleSort,
    getSortIcon,
    sortData,
  };
}