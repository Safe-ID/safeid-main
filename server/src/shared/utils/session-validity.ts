/**
 * Um token de sessão vale só se foi emitido depois da última troca de senha.
 * O iat do JWT tem resolução de segundos: um token emitido no mesmo segundo da troca
 * continua valendo, porque a própria troca devolve um par novo.
 */
export function isIssuedAfterPasswordChange(iat: number | undefined, passwordChangedAt: Date | null | undefined): boolean {
  if (!passwordChangedAt) {
    return true;
  }
  return typeof iat === 'number' && iat >= Math.floor(passwordChangedAt.getTime() / 1000);
}
