import { createQuery, useQueryClient } from "@tanstack/solid-query";
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

// The list is cached for 5 minutes, so a freshly created nomen would not show
// up until that expires. Every writer calls this right after a successful POST.
export function useInvalidateClientNomen() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["client-nomen"] });
}
