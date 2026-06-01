const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const TOKEN_KEY = "safeid.access_token";

function normalizeBaseUrl(url) {
  return url.replace(/\/$/, "");
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  const token = options.token || getToken();
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

export async function signup(email, password) {
  return request("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
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
