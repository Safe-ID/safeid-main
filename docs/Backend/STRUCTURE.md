# SafeID Backend - Estrutura do código

O backend é um monólito modular em NestJS, organizado em camadas inspiradas na Clean Architecture: o domínio (`core/`) não depende de HTTP nem de banco, a infraestrutura (`infra/`) concentra integrações externas, e cada funcionalidade fica num módulo próprio (`modules/`).

## Estrutura de pastas

```
server/
├── src/
│   ├── main.ts                    # Bootstrap: Helmet, compressão, CORS, ValidationPipe, Swagger, APP_ROLE
│   ├── app.module.ts              # Módulo raiz (ConfigModule, rate limit e módulos de funcionalidade)
│   │
│   ├── api/                       # Peças HTTP compartilhadas entre módulos
│   │   ├── decorators/            # @CurrentUser()
│   │   └── guards/                # AdminTokenGuard (rotas operacionais)
│   │
│   ├── core/                      # Domínio: regras sem dependência de framework externo
│   │   ├── engines/               # RiskEngine (score), AIEngine (plano de ação), diffNewBreaches
│   │   ├── entities/              # ScanResult
│   │   ├── repositories/          # Interface ScanHistoryRepository
│   │   └── use-cases/             # ExecuteRiskScanUseCase (orquestra scan, score, IA e cache)
│   │
│   ├── infra/                     # Integrações e infraestrutura
│   │   ├── cache/                 # Cliente Redis (ioredis)
│   │   ├── database/              # PrismaService
│   │   ├── email/                 # Envio pelo Amazon SES ou console (dev) + templates
│   │   ├── http/                  # Clientes HIBP (conta, catálogo, plano), mocks e erros tipados
│   │   ├── queue/                 # Filas BullMQ: hibp-check, monitoring, email
│   │   └── rate-limit/            # @nestjs/throttler com limites por rota
│   │
│   ├── modules/                   # Funcionalidades (controller + services + processors)
│   │   ├── auth/                  # Cadastro, verificação de e-mail, login, refresh, Google OAuth, exclusão
│   │   ├── breaches/              # UserBreachRepository (vazamentos já conhecidos de cada usuário)
│   │   ├── health/                # GET /api/health (PostgreSQL e Redis)
│   │   ├── monitoring/            # Catálogo HIBP, varredura, agendamentos, opt-out, /api/health/jobs
│   │   ├── notifications/         # Notificações do sino e worker de e-mail
│   │   └── scan/                  # Scan (sem rota de disparo), histórico e detalhe
│   │
│   ├── shared/                    # Utilitários sem dependência de módulo
│   │   ├── config/                # Validação do .env, APP_ROLE, URLs públicas
│   │   ├── crypto/                # AES-256-GCM, hash HMAC do e-mail, token de descadastro
│   │   ├── utils/                 # Logger JSON, datas em BRT, shutdown, nomes de vazamentos
│   │   └── validation/            # @StrictBoolean()
│   │
│   └── types/                     # Declarações de tipos (opossum)
│
├── prisma/
│   ├── schema.prisma              # 7 modelos (ver abaixo)
│   └── migrations/                # Migrations versionadas, aplicadas com prisma migrate deploy
│
├── scripts/
│   └── backfill-user-breaches.ts  # Registra os vazamentos já conhecidos das contas antigas
│
├── tests/
│   ├── unit/                      # Jest, 32 suítes (inclui fuzz testing do RiskEngine)
│   ├── integration/               # Fluxos de scan e monitoramento com banco em memória
│   ├── e2e/                       # Jest subindo a API e chamando as rotas por HTTP
│   ├── helpers/                   # Prisma, filas e Redis em memória
│   ├── fixtures/                  # Catálogo HIBP simulado
│   └── manual/                    # Scripts de teste manual (auth, HIBP)
│
├── *.ps1                          # Scripts AWS (ver DEPLOY_PRODUCAO.md); leem o .env.production
├── .env.production.example        # Modelo da configuração de produção
├── Dockerfile                     # Multi-stage: builder, dev e produção (Node 20 Alpine)
├── docker-entrypoint.sh           # Aplica as migrations antes de iniciar o contêiner
├── docker-compose.yml             # PostgreSQL 16, Redis 7 (noeviction) e a API
├── jest.unit.config.js            # Testes unitários + limites de cobertura
├── jest.integration.config.js
├── jest.e2e.config.js
├── tsconfig.json                  # TypeScript strict, aliases @core, @infra, @modules...
├── .eslintrc.js / .prettierrc
└── .env.example                   # Todas as variáveis, com comentários (o .env real não vai para o git)
```

## Módulos

| Módulo | Rotas | Responsabilidade |
|---|---|---|
| `auth` | `/api/v1/auth/*` | Cadastro com verificação de e-mail, login, renovação de sessão, Google OAuth, perfil e exclusão da conta |
| `scan` | `/api/v1/scan/*` | Histórico e detalhe das análises da própria conta; o scan roda no cadastro, no monitoramento e na reconciliação |
| `notifications` | `/api/v1/notifications/*` | Sino do painel e envio dos e-mails (verificação e alerta) |
| `monitoring` | `/api/v1/monitoring/*`, `/api/health/jobs` | Catálogo de vazamentos, varredura dos usuários, agendamentos, preferências e descadastro |
| `breaches` | (interno) | Base de vazamentos que cada usuário já conhece, para alertar só os novos |
| `health` | `/api/health` | Saúde do PostgreSQL e do Redis |

A lista completa de rotas, com payloads, está em [MATRIZ_CONSUMO_API_FRONTEND.md](./MATRIZ_CONSUMO_API_FRONTEND.md) e no Swagger (`/api/docs`, quando `SWAGGER_ENABLED=true`).

## Banco de dados

O `schema.prisma` tem 7 modelos, todos removidos em cascata quando o usuário apaga a conta:

| Modelo | Para que serve |
|---|---|
| `User` | Conta: e-mail, senha (bcrypt) ou Google, aceite dos termos, verificação do e-mail, preferência de monitoramento, snapshot do último scan |
| `EmailVerificationToken` | Hash dos tokens do link de verificação (validade de 24 h, uso único) |
| `ScanHistory` | Cada análise: score, classificação, vazamentos (criptografados com AES-256-GCM), plano da IA e origem (`SIGNUP`, `MANUAL`, `MONITORING`) |
| `UserBreach` | Vazamentos que o usuário já conhece; só os que não estão aqui geram alerta |
| `BreachCatalog` | Cópia local do catálogo público da HIBP |
| `CatalogSyncState` | Marca da última sincronização completa do catálogo |
| `Notification` | Notificações do sino e situação do e-mail de alerta |

## Processos

O mesmo código roda em três papéis, definidos por `APP_ROLE`:

- `all` (padrão): API HTTP e workers no mesmo processo, como no ambiente local e na AWS hoje;
- `api`: só a API HTTP;
- `worker`: só os workers das filas e os agendamentos, sem abrir porta.

---

**SafeID Backend** · Documentação atualizada em 17/10/2026
