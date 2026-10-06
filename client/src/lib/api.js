export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const TOKEN_KEY = "safeid.access_token";
const REFRESH_TOKEN_KEY = "safeid.refresh_token";

// Disparado quando o token venceu ou foi recusado, para o app voltar ao login
export const SESSION_EXPIRED_EVENT = "safeid:session-expired";

function normalizeBaseUrl(url) {
  return url.replace(/\/$/, "");
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function setAuthTokens(tokens) {
  if (tokens?.access_token) {
    localStorage.setItem(TOKEN_KEY, tokens.access_token);
  }

  if (tokens?.refresh_token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  // token: null indica uma rota pública (login/cadastro), que não usa o token salvo
  const token = options.token === null ? null : options.token || getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${normalizeBaseUrl(API_BASE_URL)}${path}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    if (response.status === 401 && token) {
      clearToken();
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      throw new Error("Sua sessão expirou. Entre novamente.");
    }

    const message = typeof payload === "string"
      ? payload
      : payload?.message || payload?.error || "Erro ao consumir a API";
    throw new Error(Array.isArray(message) ? message.join(", ") : message);
  }

  return payload;
}

export async function login(email, password) {
  return request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    token: null,
  });
}

export async function signup(email, password, acceptTerms) {
  return request("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, acceptTerms }),
    token: null,
  });
}

export async function fetchMe() {
  return request("/api/v1/auth/me", { method: "GET" });
}

export async function fetchScanHistory() {
  return request("/api/v1/scan/history", { method: "GET" });
}

export async function fetchScanDetail(jobId) {
  return request(`/api/v1/scan/${jobId}`, { method: "GET" });
}

export async function createScan(email) {
  return request("/api/v1/scan", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function deleteAccount() {
  return request("/api/v1/auth/me", {
    method: "DELETE",
  });
}
