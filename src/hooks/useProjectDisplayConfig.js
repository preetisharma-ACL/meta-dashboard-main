import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { fetchProjectDisplayConfig, fetchClients } from "../services/projectDisplayConfig";

export function useProjectConfigs() {
  return createQuery(() => ({
    queryKey: ["project-display-configs"],
    queryFn: () => fetchProjectDisplayConfig().then(r => r.data ?? []),
    staleTime: 5 * 60 * 1000,
  }));
}

export function useClientsDropdown() {
  return createQuery(() => ({
    queryKey: ["clients-dropdown"],
    queryFn: () => fetchClients(1, 500).then(r => r.data || []),
    staleTime: 10 * 60 * 1000, // clients list changes rarely
  }));
}

export function useInvalidateConfigs() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["project-display-configs"] });
}