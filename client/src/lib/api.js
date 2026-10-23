export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const TOKEN_KEY = "safeid.access_token";
const REFRESH_TOKEN_KEY = "safeid.refresh_token";

// Disparado quando o token venceu ou foi recusado, para o app voltar ao login
export const SESSION_EXPIRED_EVENT = "safeid:session-expired";
// Chegou notificação nova: o painel recarrega o perfil (o score muda depois de um rescore)
export const NOTIFICATIONS_UPDATED_EVENT = "safeid:notifications-updated";
// Pedido para o painel abrir uma aba (ex.: clique numa notificação abre "Vazamentos")
export const OPEN_DASHBOARD_TAB_EVENT = "safeid:open-dashboard-tab";

/**
 * Erro da API com o status HTTP e o código do backend (ex.: EMAIL_NOT_VERIFIED,
 * TOKEN_EXPIRED), para a tela decidir o que mostrar sem depender do texto
 */
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

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

// Uma renovação por vez: requisições que recebem 401 juntas esperam a mesma chamada
let pendingRefresh = null;

/**
 * Troca o refresh token salvo por um par novo (POST /api/v1/auth/refresh).
 * Devolve true se a sessão foi renovada.
 */
export function refreshSession() {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    return Promise.resolve(false);
  }

  if (!pendingRefresh) {
    pendingRefresh = fetch(`${normalizeBaseUrl(API_BASE_URL)}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
      .then(async (response) => {
        if (!response.ok) return false;
        setAuthTokens(await response.json());
        return true;
      })
      .catch(() => false)
      .finally(() => {
        pendingRefresh = null;
      });
  }

  return pendingRefresh;
}

export async function request(path, options = {}) {
  const { retried, ...fetchOptions } = options;
  options = fetchOptions;
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

  // 204 e corpo vazio (ex.: PATCH de notificação) não têm JSON para ler
  const contentType = response.headers.get("content-type") || "";
  const raw = response.status === 204 ? "" : await response.text();
  let payload = raw;
  if (raw && contentType.includes("application/json")) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && token) {
      // Token de acesso vencido: renova a sessão uma vez e repete a requisição.
      // Só com o token salvo (não quando a chamada passou um token próprio).
      if (!retried && !options.token && (await refreshSession())) {
        return request(path, { ...options, retried: true });
      }
      clearToken();
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      throw new ApiError("Sua sessão expirou. Entre novamente.", 401, payload?.code);
    }

    const message = typeof payload === "string"
      ? payload
      : payload?.message || payload?.error || "Erro ao consumir a API";
    throw new ApiError(
      Array.isArray(message) ? message.join(", ") : message,
      response.status,
      typeof payload === "object" && payload ? payload.code : undefined,
    );
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

// Cria a conta e envia o link de verificação. Não devolve tokens: o acesso
// só é liberado depois de verifyEmail
export async function signup(email, password, acceptTerms, acceptMonitoring = true) {
  return request("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, acceptTerms, acceptMonitoring }),
    token: null,
  });
}

export async function verifyEmail(token) {
  return request("/api/v1/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
    token: null,
  });
}

export async function resendVerification(email) {
  return request("/api/v1/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email }),
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

export async function deleteAccount() {
  return request("/api/v1/auth/me", {
    method: "DELETE",
  });
}

export async function fetchNotifications(cursor) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request(`/api/v1/notifications${query}`, { method: "GET" });
}

export async function fetchUnreadCount() {
  return request("/api/v1/notifications/unread-count", { method: "GET" });
}

export async function markNotificationRead(id) {
  return request(`/api/v1/notifications/${id}/read`, { method: "PATCH" });
}

export async function markAllNotificationsRead() {
  return request("/api/v1/notifications/read-all", { method: "PATCH" });
}

export async function fetchMonitoringStatus() {
  return request("/api/v1/monitoring/status", { method: "GET" });
}

export async function updateMonitoringPreferences(enabled) {
  return request("/api/v1/monitoring/preferences", {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}
