import axe from 'axe-core'

// Regras WCAG 2.0/2.1 nível A e AA, mais as boas práticas do axe.
// Contraste de cor fica de fora: o jsdom não calcula estilos, então ele é verificado no navegador.
const OPCOES = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: { 'color-contrast': { enabled: false } },
}

/** Violações de acessibilidade da página renderizada, num formato fácil de ler no teste */
export async function violacoesDeAcessibilidade(alvo = document) {
  const resultado = await axe.run(alvo, OPCOES)
  return resultado.violations.map((v) => ({
    regra: v.id,
    impacto: v.impact,
    ajuda: v.help,
    elementos: v.nodes.map((n) => n.target.join(' ')),
  }))
}
