import { createSignal } from "solid-js";
import { getLeads } from "../components/leadsService";

export const [leads, setLeads] = createSignal([]);

export const fetchLeads = async () => {
    const data = await getLeads();
    setLeads(data);
};

//  update
export const updateLead = (updatedLead) => {
    setLeads((prev) =>
        prev.map((l) => (l.id === updatedLead.id ? updatedLead : l))
    );
};

//  delete
export const deleteLead = (id) => {
    setLeads((prev) => prev.filter((l) => l.id !== id));
};