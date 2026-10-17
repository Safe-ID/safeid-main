# 📚 Índice - documentação técnica do SafeID

Documentos de `docs/Backend`, do que é mais rápido de ler ao mais detalhado. Todos foram revisados contra o código em 17/10/2026.

## 📖 Documentos

| Documento | O que tem | Para quem | Leitura |
|---|---|---|---|
| ⚡ [RESUMO_EXECUTIVO.md](./RESUMO_EXECUTIVO.md) | Stack, o que o backend faz, boas práticas e números atuais em uma página | Todos, especialmente quem está chegando | 5 min |
| 🛠️ [SETUP.md](./SETUP.md) | Rodar API, banco e frontend na máquina: `.env`, Docker, testes e problemas comuns | Desenvolvedores | 10 min |
| 🗂️ [STRUCTURE.md](./STRUCTURE.md) | Pastas do `server/`, módulos, modelos do banco e papéis do processo (`APP_ROLE`) | Desenvolvedores | 10 min |
| 🔌 [MATRIZ_CONSUMO_API_FRONTEND.md](./MATRIZ_CONSUMO_API_FRONTEND.md) | Contrato de todas as rotas: payloads, respostas, códigos de erro e qual tela usa cada uma | Frontend e full stack | 15 min |
| 🎨 [ARQUITETURA_VISUAL.md](./ARQUITETURA_VISUAL.md) | Diagramas: camadas, fluxo do scan, fluxo do monitoramento, segurança, módulos e pipeline | Todos | 10 min |
| 🛠️ [TECNOLOGIAS_E_BOAS_PRATICAS.md](./TECNOLOGIAS_E_BOAS_PRATICAS.md) | Cada tecnologia com a versão e cada prática com o arquivo onde está | Desenvolvedores e banca | 20 min |
| 💻 [EXEMPLOS_PRATICOS.md](./EXEMPLOS_PRATICOS.md) | Trechos reais do código: camadas, motor de risco, validação, JWT, rate limit, circuit breaker, testes | Desenvolvedores | 15 min |
| 🧪 [GUIA_TESTES_E_FLUXO_IMPLEMENTACAO.md](./GUIA_TESTES_E_FLUXO_IMPLEMENTACAO.md) | Tipos de teste, como rodar cada um e o fluxo de implementar uma feature com testes | Desenvolvedores | 10 min |
| 📈 [COBERTURA_TESTES_ATUAL.md](./COBERTURA_TESTES_ATUAL.md) | Medição de cobertura, limites do CI, testes por camada e fuzz testing | Desenvolvedores e revisores | 5 min |
| ✅ [CHECKLIST_MATURIDADE.md](./CHECKLIST_MATURIDADE.md) | O que está implementado, parcial ou faltando, com evidência, e próximos passos | Tech lead e banca | 10 min |
| ☁️ [ARQUITETURA_AWS.md](./ARQUITETURA_AWS.md) | Arquitetura alvo na AWS, segredos, scripts de provisionamento, SES, alarmes e ordem de implantação | DevOps | 20 min |

Fora desta pasta:

- 🔐 [GITHUB_E_FLUXO_CONTRIBUICAO.md](../GITHUB_E_FLUXO_CONTRIBUICAO.md): Git, PRs, regras da `main`, fila de merge e checks do CI.
- `README.md` da raiz, `server/README.md` e `client/README.md`: visão geral e comandos de cada parte.
- Swagger em `/api/docs` com a API rodando e `SWAGGER_ENABLED=true`.

## 🎓 Por onde começar

| Objetivo | Caminho |
|---|---|
| Entender o projeto rápido | RESUMO_EXECUTIVO → ARQUITETURA_VISUAL |
| Rodar localmente | SETUP → STRUCTURE |
| Mexer no frontend | MATRIZ_CONSUMO_API_FRONTEND → `client/README.md` |
| Implementar uma feature no backend | STRUCTURE → EXEMPLOS_PRATICOS → GUIA_TESTES |
| Preparar a banca | RESUMO_EXECUTIVO → TECNOLOGIAS_E_BOAS_PRATICAS → CHECKLIST_MATURIDADE → COBERTURA_TESTES_ATUAL |
| Implantar na AWS | ARQUITETURA_AWS → `server/README.md` (seção AWS) |
| Abrir um PR | GITHUB_E_FLUXO_CONTRIBUICAO |

## 🔍 Busca rápida por tópico

| Tópico | Onde |
|---|---|
| Score de risco (fórmula, pesos, faixas) | [EXEMPLOS_PRATICOS.md](./EXEMPLOS_PRATICOS.md#2-motor-de-risco), [RESUMO_EXECUTIVO.md](./RESUMO_EXECUTIVO.md) |
| Cadastro, verificação de e-mail e tokens | [MATRIZ_CONSUMO_API_FRONTEND.md](./MATRIZ_CONSUMO_API_FRONTEND.md#3-autenticação), [TECNOLOGIAS_E_BOAS_PRATICAS.md](./TECNOLOGIAS_E_BOAS_PRATICAS.md) |
| LGPD e dados pessoais | [TECNOLOGIAS_E_BOAS_PRATICAS.md](./TECNOLOGIAS_E_BOAS_PRATICAS.md) (seção 5) |
| Monitoramento de vazamentos | [ARQUITETURA_VISUAL.md](./ARQUITETURA_VISUAL.md), [ARQUITETURA_AWS.md](./ARQUITETURA_AWS.md) (seção 10) |
| Integração com a HIBP (fila, limite, circuit breaker) | [TECNOLOGIAS_E_BOAS_PRATICAS.md](./TECNOLOGIAS_E_BOAS_PRATICAS.md) (seção 6) |
| Banco de dados e migrations | [STRUCTURE.md](./STRUCTURE.md#banco-de-dados), [SETUP.md](./SETUP.md) |
| Testes e cobertura | [GUIA_TESTES_E_FLUXO_IMPLEMENTACAO.md](./GUIA_TESTES_E_FLUXO_IMPLEMENTACAO.md), [COBERTURA_TESTES_ATUAL.md](./COBERTURA_TESTES_ATUAL.md) |
| CI e regras da `main` | [GITHUB_E_FLUXO_CONTRIBUICAO.md](../GITHUB_E_FLUXO_CONTRIBUICAO.md) |
| Segredos e variáveis de ambiente | [SETUP.md](./SETUP.md), [ARQUITETURA_AWS.md](./ARQUITETURA_AWS.md) |

## 📝 Histórico

| Data | Mudanças |
|---|---|
| 12/05/2026 | Versão inicial |
| 16/10/2026 | Monitoramento de vazamentos: ARQUITETURA_AWS.md (SES, jobs, alarmes) e novos contratos na matriz da API |
| 17/10/2026 | Revisão completa contra o código: STRUCTURE, SETUP, RESUMO, TECNOLOGIAS, ARQUITETURA_VISUAL, CHECKLIST, EXEMPLOS e matriz da API reescritos (descreviam outro projeto ou versões antigas); cobertura, guia de testes e AWS atualizados; links para planos internos removidos |

---

**Atualizado em:** 17/10/2026
