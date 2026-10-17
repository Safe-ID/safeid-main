# ✅ Checklist de boas práticas e maturidade

Situação real do backend em 17/10/2026, com a evidência de cada item. Todo número citado aqui foi medido; o que ainda não foi medido aparece como "não medido".

**Legenda:** ✅ implementado · ⚠️ parcial · ❌ não implementado

## 📊 Matriz de implementação

| # | Prática | Status | Evidência |
|---|---|---|---|
| 1 | Arquitetura em camadas | ✅ | `core/` sem dependência de HTTP ou Prisma; `infra/`, `modules/`, `shared/` |
| 2 | Use cases e repositórios | ✅ | `ExecuteRiskScanUseCase`, `ScanHistoryRepository` (interface), `UserBreachRepository` |
| 3 | TypeScript strict | ✅ | `"strict": true` no `tsconfig.json` |
| 4 | Cabeçalhos de segurança | ✅ | `helmet()` no `main.ts` |
| 5 | Autenticação JWT | ✅ | Acesso 24 h + refresh 7 dias com `typ` separado; `JwtStrategy` confere a conta no banco |
| 6 | Verificação de e-mail | ✅ | Token de uso único, validade de 24 h, só o hash no banco |
| 7 | Hash de senha | ✅ | bcrypt, mínimo de 8 caracteres |
| 8 | Validação de entrada | ✅ | ValidationPipe com whitelist e `forbidNonWhitelisted`; `@StrictBoolean()` nos consentimentos |
| 9 | CORS restrito | ✅ | Só `CORS_ORIGIN` |
| 10 | Rate limit | ✅ | `@nestjs/throttler` por IP, com limites por rota |
| 11 | Dados pessoais protegidos | ✅ | Hash do e-mail, AES-256-GCM nos vazamentos, IA sem e-mail, `maskEmail` nos logs |
| 12 | Consentimento e exclusão (LGPD) | ✅ | Aceite dos termos e dos alertas separados; descadastro em 1 clique; exclusão em cascata |
| 13 | ORM e migrations | ✅ | Prisma, 6 migrations versionadas aplicadas por `migrate deploy` |
| 14 | Variáveis de ambiente | ⚠️ | `.env.example` completo; a validação só **avisa** no log, não impede subir |
| 15 | Logs estruturados | ⚠️ | Logger JSON nos módulos novos; ainda restam `console.log` em pontos antigos |
| 16 | Health checks | ✅ | `/api/health` (503 se o banco ou o Redis falharem) e `/api/health/jobs` |
| 17 | Circuit breaker | ✅ | Opossum na HIBP; o 429 não abre o circuito |
| 18 | Filas e agendamentos | ✅ | BullMQ com limiter global, prioridade, retentativas, watchdog e reconciliação |
| 19 | Shutdown gracioso | ✅ | `enableShutdownHooks`, workers fecham ao fim do job atual |
| 20 | Testes unitários | ✅ | 349 testes, 99,05% de linhas, 90,25% de branches |
| 21 | Testes de integração | ⚠️ | 5 testes de fluxo (scan e monitoramento) com Prisma e Redis em memória; o CI aplica as migrations num PostgreSQL real, mas nenhum teste consulta o banco de verdade |
| 22 | Testes e2e da API | ✅ | 23 testes subindo a API |
| 23 | Fuzz testing | ✅ | `risk.engine.fuzz.spec.ts` (fast-check) |
| 24 | Testes de frontend | ✅ | 26 testes de componente (Vitest) |
| 25 | Testes e2e no navegador | ❌ | Não há Playwright/Cypress |
| 26 | Testes de carga | ❌ | Não há scripts de k6 versionados |
| 27 | CI obrigatório | ✅ | 4 checks obrigatórios, CodeQL, dependency review |
| 28 | Revisão de código | ✅ | PR obrigatório com template, Code Owner, fila de merge |
| 29 | Dependências atualizadas | ✅ | Dependabot; majors que exigem migração tratadas em PR próprio |
| 30 | Contêiner | ⚠️ | Dockerfile multi-stage e migrations no entrypoint; a imagem roda como root |
| 31 | Documentação da API | ✅ | Swagger (`SWAGGER_ENABLED=true`) e [MATRIZ_CONSUMO_API_FRONTEND.md](./MATRIZ_CONSUMO_API_FRONTEND.md) |
| 32 | Infraestrutura como código | ⚠️ | Scripts PowerShell versionados para a AWS; nada implantado ainda |

## 📋 Checklists por área

### 🔐 Segurança
- [x] Senhas com bcrypt
- [x] JWT com expiração e refresh token com segredo próprio
- [x] Verificação de e-mail obrigatória
- [x] CORS, Helmet e validação global
- [x] Rate limit por rota
- [x] Segredos de produção no SSM (scripts prontos)
- [x] CodeQL e dependency review no CI
- [ ] Revogação de refresh token no servidor
- [ ] Rotação de segredos
- [ ] Imagem Docker rodando sem root

### 🗄️ Banco de dados
- [x] Migrations versionadas e aplicadas automaticamente
- [x] Índices nas consultas do monitoramento
- [x] Exclusão em cascata a partir do usuário
- [x] Pool de conexões limitado em produção (`connection_limit=10`)
- [x] Backups de 7 dias e snapshot antes de migration (scripts do RDS)
- [ ] Réplica de leitura (não necessária na escala atual)

### 🧪 Qualidade
- [x] TypeScript strict, ESLint e Prettier
- [x] Cobertura mínima no CI (80% statements, branches e lines; 85% functions)
- [x] Testes unitários, de integração, e2e da API e fuzz
- [x] Testes de componente no frontend
- [ ] Testes e2e no navegador
- [ ] Testes de carga

### 📊 Observabilidade
- [x] Health check do banco e do Redis
- [x] Diagnóstico das filas e agendamentos (`/api/health/jobs`)
- [x] Logs em JSON com e-mail mascarado
- [x] Alarmes no CloudWatch (scripts prontos, não implantados)
- [ ] Métricas de aplicação (Prometheus ou equivalente)
- [ ] Rastreamento distribuído

### 🚀 Deploy
- [x] Docker e docker-compose
- [x] Pipeline de CI
- [x] Migrations automáticas na subida do contêiner
- [x] Scripts de provisionamento da AWS
- [ ] Ambiente de produção na AWS implantado
- [ ] Deploy contínuo a partir da `main`

### 📚 Documentação
- [x] READMEs da raiz, do server e do client
- [x] Setup, estrutura, arquitetura e AWS em `docs/Backend`
- [x] Guia de contribuição com Git e PRs
- [x] Swagger
- [ ] Registro de decisões de arquitetura (ADRs)
- [ ] Changelog da API

## 📈 Métricas

| Métrica | Valor | Como medir |
|---|---|---|
| Cobertura de linhas (backend) | 99,05% | `npm run test:cov` |
| Cobertura de branches (backend) | 90,25% | `npm run test:cov` |
| Testes (unit / integração / e2e / frontend) | 349 / 5 / 23 / 26 | suítes do Jest e do Vitest |
| Erros de lint | 0 (há avisos) | `npm run lint` |
| Erros de tipo | 0 | `npm run build` |
| Tempo de resposta (p95) | não medido | precisa de teste de carga com o ambiente publicado |
| Disponibilidade | não medida | precisa do ambiente de produção e de monitoramento de uptime |

## 🔄 Próximos passos sugeridos

### Curto prazo
- Republicar o MVP e configurar o envio de e-mail em produção (alertas do monitoramento).
- Remover dependências sem uso (`express-session`, `passport-local`).
- Trocar os `console.log` restantes pelo logger JSON.
- Rodar a imagem Docker sem root.

### Médio prazo
- Testes de carga com k6 contra o ambiente publicado.
- Testes e2e no navegador para os fluxos de cadastro e scan.
- Revogação de refresh token no servidor.
- Separar API e workers em duas services quando a carga justificar.

### Migrações de versão
- NestJS 10 → 12, Prisma 5 → 7, typescript-eslint 6 → 8 e Tailwind 3 → 4 (no client), cada uma em PR próprio.

---

**Atualizado em:** 17/10/2026
