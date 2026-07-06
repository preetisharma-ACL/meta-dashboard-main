import { Navigate } from "@solidjs/router";

export default function AdminRoute(props) {
  const auth = JSON.parse(localStorage.getItem("auth") || "{}");

  if (!auth?.token) {
    return <Navigate href="/login" />;
  }

  // Defaults to admin-only. Pass `roles` to widen access to specific pages
  // (e.g. the Clients section is also open to campaign managers).
  const allowed = props.roles ?? ["admin"];
  if (!allowed.includes(auth?.role)) {
    return <Navigate href="/" />;
  }

  return props.children;
}