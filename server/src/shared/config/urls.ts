/** URL pública do frontend (links de e-mail, redirects do OAuth e do opt-out) */
export function getFrontendUrl(): string {
  const configured = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
  return configured.trim().replace(/\/+$/, '');
}

/** URL pública da API (links do e-mail que apontam para o backend, como o opt-out) */
export function getApiPublicUrl(): string {
  const configured = process.env.APP_URL || 'http://localhost:3000';
  return configured.trim().replace(/\/+$/, '');
}
