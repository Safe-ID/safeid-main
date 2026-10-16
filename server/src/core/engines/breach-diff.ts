/**
 * Vazamentos novos: presentes na consulta atual e fora da base conhecida.
 * Mantém a ordem da consulta e remove repetidos. Nomes que sumiram da consulta
 * não geram evento (a HIBP pode retirar vazamentos).
 */
export function diffNewBreaches(known: Set<string>, current: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of current) {
    if (!name || known.has(name) || seen.has(name)) {
      continue;
    }
    seen.add(name);
    result.push(name);
  }

  return result;
}
