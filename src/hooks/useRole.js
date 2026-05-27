
import { createSignal } from "solid-js";

const authData = JSON.parse(localStorage.getItem("auth"));

const [userRole] = createSignal(authData?.role ?? "client");

export default function useRole() {
  return {
    userRole,
    isAdmin: () => userRole() === "admin",
    isClient: () => userRole() === "client",
  };
}