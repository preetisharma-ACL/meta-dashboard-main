export default function RoleGuard(props) {
  const auth = JSON.parse(localStorage.getItem("auth"));
  const role = auth?.role;

  return role === props.role ? props.children : null;
}