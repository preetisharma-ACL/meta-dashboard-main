import { isAuthenticated } from "../utils/auth";
import { Navigate } from "@solidjs/router";

const ProtectedRoute = (props) => {
  return isAuthenticated() ? props.children : <Navigate href="/login" replace />;
};

export default ProtectedRoute;