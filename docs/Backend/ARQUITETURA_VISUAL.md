# 🎨 Arquitetura visual - SafeID

## 🏗️ Visão geral

```
┌──────────────────────────────────────────────────────────────────┐
│                 CLIENT (React 19 + Vite + Tailwind)                │
│        painel, sino de notificações, PDF do plano de ação          │
└──────────────────────────────┬───────────────────────────────────┘
                               │ HTTPS REST (JSON) + JWT
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                     API NestJS (APP_ROLE=all)                      │
│                                                                    │
│  modules/   auth · scan · notifications · monitoring · health      │
│     │        (controllers, services, processors das filas)         │
│     ▼                                                              │
│  core/      RiskEngine · AIEngine · ExecuteRiskScanUseCase         │
│     │        (regras de negócio, sem HTTP nem Prisma)              │
│     ▼                                                              │
│  infra/     Prisma · Redis · BullMQ · clientes HIBP · SES          │
│  shared/    logger JSON · criptografia · validação do .env         │
└───────┬──────────────┬──────────────┬──────────────┬─────────────┘
        ▼              ▼              ▼              ▼
  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────┐
  │PostgreSQL│   │  Redis   │   │   HIBP   │   │ Azure AI /   │
  │    16    │   │ cache +  │   │ API v3 + │   │ Amazon SES   │
  │ (Prisma) │   │ filas    │   │ catálogo │   │              │
  └──────────┘   └──────────┘   └──────────┘   └──────────────┘
```

## 🔄 Fluxo de um scan

```
Gatilhos (não há rota para o usuário disparar um scan):
   ├─ Cadastro: POST /api/v1/auth/verify-email ou primeiro login pelo Google
   ├─ Monitoramento: vazamento novo no catálogo da HIBP → recálculo do score
   └─ Reconciliação (de hora em hora): refaz o scan de quem ficou sem resultado válido
   │
   ▼
ScanService.submitScan(userId, e-mail da CONTA)
   │
   ▼
ExecuteRiskScanUseCase
   │
   ├─ 1. Cache Redis "scan:<hash do e-mail>"  ── HIT ──► devolve o resultado guardado
   │
   ├─ 2. MISS: job na fila hibp-check (sem prioridade = passa na frente do monitoramento)
   │        HibpProcessor: limiter pelo plano HIBP · circuit breaker · 429 pausa a fila
   │
   ├─ 3. RiskEngine: soma dos pesos × fator de tempo → score 0-100 e classificação
   ├─ 4. AIEngine: resumo, passos e urgência (metadados apenas; resposta padrão se falhar)
   ├─ 5. ScanHistory no PostgreSQL (vazamentos criptografados, AES-256-GCM)
   └─ 6. Cache por 12 h (com vazamentos) ou 24 h (sem)
   │
   ▼
ScanService: atualiza o snapshot do painel e registra os vazamentos vistos (UserBreach)
   │
   ▼
201 { jobId, riskScore, classification, breachesFound, recommendation, ... }
```

## 🔔 Fluxo do monitoramento contínuo

```
catalog-sync (a cada 6 h)          catalog-probe (de hora em hora)
   GET /breaches (público)            GET /latestbreach
        │                                   │ mudou? antecipa o sync
        ▼                                   ▼
   BreachCatalog atualizado ◄───────────────┘
        │ vazamento novo e relevante (não sensível, não retirado)
        ▼
   monitor-sweep  ─── também toda segunda às 03h ───
        │ um monitor-check por usuário com alertas ligados (prioridade baixa)
        ▼
   monitor-check (fila hibp-check)
        │ consulta estrita à HIBP para o e-mail do usuário
        ▼
   MonitoringService: compara com UserBreach (o que o usuário já conhece)
        │ só os vazamentos NOVOS
        ├─► UserBreach + score recalculado (ScanHistory source=MONITORING)
        ├─► Notification (sino do painel)
        └─► fila email ──► Amazon SES (descadastro em 1 clique)

   monitoring-reconcile (de hora em hora): reenvia alertas pendentes,
   antecipa catálogo atrasado e checa usuários sem verificação há 8 dias
```

## 🔐 Segurança em camadas

```
Requisição
   │  1. Helmet ............. cabeçalhos de segurança
   │  2. CORS ............... só a origem do frontend
   │  3. Rate limit ......... por IP e por rota
   │  4. JWT Guard .......... token válido, typ correto, conta verificada no banco
   │  5. ValidationPipe ..... whitelist, campos extras rejeitados, booleanos estritos
   │  6. Regras de negócio .. scan só do e-mail da conta, IA sem e-mail
   ▼
Dados
      7. Hash do e-mail, AES-256-GCM nos vazamentos, bcrypt nas senhas
      8. Exclusão em cascata da conta inteira
```

## 📊 Módulos NestJS

```
AppModule
├── ConfigModule (global, valida o .env)
├── RateLimitModule (@nestjs/throttler)
├── DatabaseModule ── PrismaService
├── CacheModule ───── cliente Redis
├── QueueModule ───── filas hibp-check, monitoring, email + clientes HIBP
├── EmailModule ───── SES ou console
├── AuthModule ────── AuthController, AuthService, EmailVerificationService, JwtStrategy
├── ScanModule ────── ScanController, ScanService, ExecuteRiskScanUseCase
├── BreachesModule ── UserBreachRepository
├── NotificationsModule ── NotificationsController, NotificationsService, EmailProcessor
├── MonitoringModule ───── controllers de monitoramento e de /api/health/jobs,
│                          catálogo, varredura, agendamentos, reconciliação,
│                          HibpProcessor e MonitoringProcessor
└── HealthModule ──── GET /api/health
```

## 🗄️ Modelo de dados

```
User 1───N ScanHistory            (cada análise; source SIGNUP | MANUAL | MONITORING)
User 1───N UserBreach             (vazamentos já conhecidos; base para alertar só os novos)
User 1───N Notification           (sino + situação do e-mail de alerta)
User 1───N EmailVerificationToken (hash do token do link)

BreachCatalog                     (catálogo público da HIBP, sem ligação com usuário)
CatalogSyncState                  (uma linha: última sincronização completa)
```

Todas as relações com `User` usam `onDelete: Cascade`.

## 🔀 Padrões usados

| Padrão | Onde |
|---|---|
| Injeção de dependência | Todo o NestJS; facilita trocar Prisma, Redis e filas por versões em memória nos testes |
| Use case | `ExecuteRiskScanUseCase` |
| Repository | `ScanHistoryRepository` (interface no core), `UserBreachRepository` |
| Strategy | `JwtStrategy` (Passport); `EmailSender` com SES ou console |
| Guard | `JwtAuthGuard`, `AdminTokenGuard` |
| Circuit breaker | Opossum no `HibpClient` |
| Fila e worker | BullMQ, com limiter global e prioridade |
| Decorator | `@CurrentUser()`, `@StrictBoolean()` |

## 📈 Escala

Hoje: uma task Fargate de 0,5 vCPU e 1 GB rodando API e workers juntos, um RDS `db.t3.micro` e um ElastiCache `cache.t3.micro` (arquitetura alvo, ainda não implantada). O limiter da HIBP vive no Redis, então vale para todas as tasks juntas.

Primeira evolução prevista: separar API e workers em duas services do ECS com a mesma imagem (`APP_ROLE=api` e `APP_ROLE=worker`). Ver [ARQUITETURA_AWS.md](./ARQUITETURA_AWS.md).

## 🚀 Pipeline

```
Pull Request
   ├── Frontend lint and build ........ lint · Vitest · build
   ├── Backend lint, build and unit ... lint · build · Jest com cobertura mínima
   ├── Backend integration tests ...... migrations num PostgreSQL 16 + fluxos com Prisma em memória
   ├── Backend E2E tests .............. API completa via HTTP
   ├── CodeQL · dependency review
   └── Aprovação de Code Owner
          ▼
   Merge when ready ── fila de merge: main atual + PR ── checks de novo ── merge
```

---

**Atualizado em:** 17/10/2026
