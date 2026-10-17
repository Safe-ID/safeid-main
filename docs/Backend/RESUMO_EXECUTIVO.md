# ⚡ Resumo executivo - SafeID Backend

O SafeID consulta se o e-mail do usuário apareceu em vazamentos de dados (Have I Been Pwned), calcula um score de risco, gera um plano de ação com IA e acompanha o e-mail ao longo do tempo, avisando quando ele aparece num vazamento novo.

## 📦 Stack

```
Runtime:        Node.js 20
Framework:      NestJS 10 (Express)
Linguagem:      TypeScript 5 (strict)
Banco:          PostgreSQL 16 + Prisma 5
Cache e filas:  Redis 7 + BullMQ
Auth:           JWT (Passport) + refresh token + Google OAuth
IA:             SDK da OpenAI, via Azure AI Foundry (modelo configurável em AI_MODEL)
E-mail:         Amazon SES (console no ambiente local)
Docs da API:    Swagger / OpenAPI
Testes:         Jest + fast-check (backend), Vitest + Testing Library (frontend)
CI:             GitHub Actions + CodeQL + Dependabot, merge queue na main
Infra alvo:     AWS (ECS Fargate, RDS, ElastiCache, SES), scripts prontos e não implantados
```

## 🔄 O que o backend faz

1. **Cadastro com verificação de e-mail**: a conta só é ativada pelo link enviado ao e-mail. O aceite da Política de Privacidade e o consentimento para alertas são gravados separadamente (LGPD).
2. **Scan**: consulta a HIBP sempre para o e-mail da conta logada (nunca para um e-mail informado na requisição), com fila, limite pelo plano contratado e circuit breaker.
3. **Score de risco**: soma dos pesos dos tipos de dado expostos em cada vazamento, multiplicada pelo fator de tempo (1,0 / 0,7 / 0,4) e normalizada de 0 a 100, com 4 faixas (LOW, MODERATE, HIGH, CRITICAL).
4. **Plano de ação**: a IA recebe só metadados dos vazamentos (nunca o e-mail) e devolve resumo, passos e urgência. Se o modelo falhar, entra uma resposta padrão.
5. **Monitoramento contínuo**: o catálogo público da HIBP é sincronizado a cada 6 h. Quando surge um vazamento novo, cada usuário com alertas ligados é checado de novo, e quem aparece recebe notificação no sino e e-mail com descadastro em 1 clique.

## ✅ Boas práticas implementadas

| Área | Prática |
|---|---|
| Arquitetura | Camadas (`core`, `infra`, `modules`, `shared`), use case de scan, repositórios |
| Segurança | Helmet, CORS restrito, ValidationPipe com whitelist, bcrypt, JWT com `typ` separando acesso e refresh |
| Dados pessoais | E-mail guardado no histórico e no cache como hash (HMAC-SHA256 com `EMAIL_HASH_SECRET`; SHA-256 sem a chave), vazamentos criptografados com AES-256-GCM, exclusão total da conta em cascata |
| Abuso | Rate limit por IP e por rota (login, cadastro, scan, verificação, refresh, descadastro) |
| Resiliência | Circuit breaker (Opossum), consulta estrita à HIBP (erro nunca vira "sem vazamentos"), filas com retentativa, shutdown gracioso |
| Observabilidade | Logger JSON com e-mail mascarado, `/api/health`, `/api/health/jobs`, alarmes no CloudWatch (scripts) |
| Qualidade | TypeScript strict, ESLint, Prettier, cobertura mínima no CI, fuzz testing do motor de risco |
| Processo | PR obrigatório com template, aprovação de Code Owner, 4 checks obrigatórios, fila de merge |

## 📊 Números atuais

| Métrica | Valor |
|---|---|
| Testes unitários (backend) | 349 em 32 suítes |
| Cobertura de linhas / branches | 99,05% / 90,25% (limites do CI: 80% / 80%) |
| Testes de integração | 5 (fluxos de scan e monitoramento, com banco em memória) |
| Testes e2e da API | 23 |
| Testes de componente (frontend) | 26 |

Medição de 17/10/2026. Detalhes em [COBERTURA_TESTES_ATUAL.md](./COBERTURA_TESTES_ATUAL.md).

## 🔐 Fluxo de autenticação

```
Cadastro (e-mail + senha + aceite)  →  e-mail com link (24 h)
        ↓
Clique no link  →  conta verificada  →  scan inicial  →  access token (24 h) + refresh token (7 dias)
        ↓
Requisições com Authorization: Bearer <access token>
        ↓
Token vencido  →  POST /api/v1/auth/refresh  →  par novo (o cliente faz isso sozinho)
```

O login com Google também está disponível, e a conta já entra verificada.

## 🏥 Saúde e operação

```
GET /api/health        → PostgreSQL e Redis (503 se algum falhar)
GET /api/health/jobs   → filas, agendamentos, workers e plano HIBP (exige X-Admin-Token)
```

## 🚀 Comandos

```bash
npm run dev               # API com reload (aplica as migrations antes)
npm run build             # compila
npm run test:cov          # testes unitários com cobertura
npm run test:integration  # integração
npm run test:e2e          # e2e
npm run lint              # ESLint
docker compose up -d postgres redis   # banco e Redis locais
```

Passo a passo completo em [SETUP.md](./SETUP.md).

## 📈 Pipeline

```
Pull Request
   ├── Frontend: lint, testes (Vitest), build
   ├── Backend: lint, build, testes unitários com cobertura
   ├── Integração: migrations num PostgreSQL 16 + fluxos de scan e monitoramento
   ├── E2E: API completa
   ├── CodeQL e dependency review
   └── Aprovação de Code Owner
        ↓
Merge when ready → fila de merge testa o PR com a main atual → merge
```

---

**Documentação completa:** [TECNOLOGIAS_E_BOAS_PRATICAS.md](./TECNOLOGIAS_E_BOAS_PRATICAS.md) · Atualizado em 17/10/2026
