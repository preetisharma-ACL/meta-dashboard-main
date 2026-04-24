export const getAuth = () => {
  return JSON.parse(localStorage.getItem("auth"));
};

export const getToken = () => {
  const auth = getAuth();
  return auth?.token || null;
};

export const isAuthenticated = () => {
  const auth = getAuth();
  return auth?.isAuthenticated || false;
};