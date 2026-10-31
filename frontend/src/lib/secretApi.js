import { api } from "@/lib/api";

// Wrappers over /api/secrets (decision note: docs/decisions/secrets.md). Values go in, but the
// server never sends one back: every function here returns names and dates only.

export async function listSecrets() {
  const res = await api.get("/secrets");
  return res.data.data.secrets;
}

export async function createSecret(name, value) {
  const res = await api.post("/secrets", { name, value });
  return res.data.data.secret;
}

// Replaces the value (rotation). The name stays, because workflows refer to it.
export async function updateSecret(name, value) {
  const res = await api.put(`/secrets/${encodeURIComponent(name)}`, { value });
  return res.data.data.secret;
}

export async function deleteSecret(name) {
  await api.delete(`/secrets/${encodeURIComponent(name)}`);
}

// Same rule as the server (backend/src/schema/secret.js), so the form can explain a bad name
// before submitting. Returns a message, or null when the name is fine.
const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

export function secretNameProblem(name) {
  if (!name) return "Name is required";
  if (!SECRET_NAME.test(name)) return "Use A-Z, 0-9 and _, starting with a letter (max 64)";
  return null;
}

// What to type in an HTTP Request node to use this secret.
export const secretExpression = (name) => `{{secrets.${name}}}`;
