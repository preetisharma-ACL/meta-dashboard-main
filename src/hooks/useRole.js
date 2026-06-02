
import { createSignal } from "solid-js";

const authData = JSON.parse(localStorage.getItem("auth"));

const [userRole] = createSignal(authData?.role ?? "client");
const [clientType] = createSignal(authData?.client_type ?? "retainer");


  export default function useRole() {
    return {
      userRole,
      isAdmin: () => userRole() === "admin",
      isClient: () => userRole() === "client",
      
    };
  }
   export function clientRole() {
    return {
      clientType,
      isRetainer: () => clientType() === "retainer",
      ishybrid: () => clientType() === "hybrid",
      iscpl: () => clientType() === "cpl",
      isAdmin: () => userRole() === "admin", 
    };
  }