/**
 * Nomes (Breach.Name da HIBP) dos vazamentos guardados num scan.
 * Aceita os formatos já gravados: array direto, { breaches: [...] } ou { data: [...] }.
 * Devolve nomes únicos, na ordem em que aparecem.
 */
export function extractBreachNames(breachData: unknown): string[] {
  const container = breachData as { breaches?: unknown; data?: unknown } | null;
  const list = Array.isArray(breachData)
    ? breachData
    : Array.isArray(container?.breaches)
      ? container.breaches
      : Array.isArray(container?.data)
        ? container.data
        : [];

  const names = (list as unknown[])
    .map(item => (item as { Name?: unknown } | null)?.Name)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map(name => name.trim());

  return Array.from(new Set(names));
}
