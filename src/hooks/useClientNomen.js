import { createQuery } from "@tanstack/solid-query";
import { fetchClientNomen } from "../pages/admin/services/clientNomen";

export function useClientNomen() {
  return createQuery(() => ({
    queryKey: ["client-nomen"],
    queryFn: async () => {
      let page = 1, all = [], hasMore = true;
      while (hasMore) {
        const res = await fetchClientNomen(page);
        all = [...all, ...(res.data ?? [])];
        hasMore = res.meta?.pagination?.has_next;
        page++;
      }
      return all;
    },
    staleTime: 5 * 60 * 1000,
  }));
}