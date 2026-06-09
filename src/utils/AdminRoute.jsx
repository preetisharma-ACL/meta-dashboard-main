import { Navigate } from "@solidjs/router";

export default function AdminRoute(props) {
  const auth = JSON.parse(localStorage.getItem("auth") || "{}");

  if (!auth?.token) {
    return <Navigate href="/login" />;
  }

  if (auth?.role !== "admin") {
    return <Navigate href="/" />;
  }

  return props.children;
}