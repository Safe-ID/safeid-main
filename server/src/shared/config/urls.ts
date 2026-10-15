/** URL pública do frontend (links de e-mail, redirects do OAuth e do opt-out) */
export function getFrontendUrl(): string {
  const configured = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
  return configured.trim().replace(/\/+$/, '');
}
