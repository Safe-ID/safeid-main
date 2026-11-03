/**
 * Vazamentos que a HIBP marca como sensíveis (ex.: sites adultos): o simples nome do serviço
 * pode revelar dado sensível da pessoa (LGPD, art. 11). Ele aparece só no painel logado:
 * não vai para a IA nem para o e-mail.
 */
export const SENSITIVE_BREACH_LABEL = 'Serviço de natureza sensível';

export function anonymizeSensitiveBreaches<T extends { Name: string; Title: string; IsSensitive?: boolean }>(breaches: T[]): T[] {
  return breaches.map(breach =>
    breach.IsSensitive
      ? {
          ...breach,
          Name: SENSITIVE_BREACH_LABEL,
          Title: SENSITIVE_BREACH_LABEL,
          Domain: '',
          Description: '',
          LogoPath: '',
        }
      : breach,
  );
}
