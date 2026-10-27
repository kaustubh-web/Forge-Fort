import { createContext, useContext, useEffect, useState } from "react";
import { api, TOKEN_KEY } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // true until we know whether a saved token is still valid.
  // Without it, a refresh would flash the login page for a logged-in user.
  const [loading, setLoading] = useState(true);

  // On first load: if a token is saved, ask the server who we are.
  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setLoading(false);
      return;
    }
    api
      .get("/auth/me")
      .then((res) => setUser(res.data.data.user))
      .catch(() => localStorage.removeItem(TOKEN_KEY)) // expired or invalid
      .finally(() => setLoading(false));
  }, []);

  // The Axios interceptor fires this when the server rejects our token.
  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener("auth:logout", onLogout);
    return () => window.removeEventListener("auth:logout", onLogout);
  }, []);

  // login and register share the same steps: call API, save token, set user.
  async function authenticate(path, body) {
    const res = await api.post(path, body);
    const { user, token } = res.data.data;
    localStorage.setItem(TOKEN_KEY, token);
    setUser(user);
  }

  const login = (body) => authenticate("/auth/login", body);
  const register = (body) => authenticate("/auth/register", body);

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Any component calls useAuth() to read the shared auth state.
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
