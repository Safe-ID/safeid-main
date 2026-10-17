# 🛠️ Tecnologias e boas práticas - SafeID Backend

Documento de referência da stack do backend e das práticas aplicadas, com os trechos reais do código onde cada uma está. As versões são as faixas declaradas no `server/package.json`.

## 📦 Tecnologias

### Runtime e framework

| Tecnologia | Versão | Uso |
|---|---|---|
| Node.js | 20 | Runtime (Dockerfile e CI) |
| NestJS | ^10.3 | Framework (módulos, injeção de dependência, guards, pipes) |
| Express | ^4.18 | Servidor HTTP usado pelo NestJS |
| TypeScript | 5.3 | Linguagem, com `strict: true` |

### Dados, cache e filas

| Tecnologia | Versão | Uso |
|---|---|---|
| PostgreSQL | 16 | Banco relacional |
| Prisma | ^5.8 | ORM e migrations versionadas |
| Redis | 7 | Cache de scans e da IA, filas, limiter da HIBP |
| ioredis | ^5.3 | Cliente Redis |
| BullMQ | ^5 | Filas `hibp-check`, `monitoring` e `email`, e agendamentos (Job Schedulers) |

### Segurança e validação

| Tecnologia | Versão | Uso |
|---|---|---|
| Helmet | ^8.3 | Cabeçalhos HTTP de segurança |
| @nestjs/jwt + passport-jwt | ^11 / ^4 | Token de acesso e refresh token |
| bcryptjs | ^2.4 | Hash das senhas |
| class-validator / class-transformer | ^0.14 / ^0.5 | Validação dos DTOs |
| @nestjs/throttler | ^6.7 | Rate limit por IP e por rota |

### Integrações

| Tecnologia | Versão | Uso |
|---|---|---|
| Axios | ^1.20 | Chamadas à API da HIBP |
| Opossum | ^10 | Circuit breaker da HIBP |
| OpenAI SDK | ^6.41 | IA via Azure AI Foundry (modelo padrão `grok-4-20-non-reasoning`, trocável por `AI_MODEL`) |
| @aws-sdk/client-sesv2 | ^3 | Envio de e-mails pelo Amazon SES |

### Documentação, testes e qualidade

| Tecnologia | Versão | Uso |
|---|---|---|
| @nestjs/swagger | ^7.1 | Swagger em `/api/docs` (quando `SWAGGER_ENABLED=true`) |
| Jest + ts-jest | ^29 | Testes unitários, de integração e e2e |
| fast-check | ^3.23 | Fuzz testing do motor de risco |
| ESLint + @typescript-eslint | ^8.55 / ^6.13 | Lint |
| Prettier | ^3.1 | Formatação |

**Instalados sem uso hoje:** `express-session` (configurado no `main.ts`, mas a autenticação é só por JWT, e nenhum código lê a sessão) e `passport-local` (não há estratégia local registrada). São candidatos a remoção.

---

## ✅ Boas práticas

### 1. Arquitetura em camadas

```
modules/ (controllers, services, processors)
    ↓ usam
core/ (RiskEngine, AIEngine, ExecuteRiskScanUseCase)  ← não conhece HTTP nem Prisma
    ↓ depende de interfaces
infra/ (Prisma, Redis, filas, HIBP, SES)
```

O `ExecuteRiskScanUseCase` recebe o repositório de histórico, o Redis e a fila por injeção, então os testes unitários trocam tudo por versões em memória. Detalhes de pastas em [STRUCTURE.md](./STRUCTURE.md).

### 2. Segurança na borda (`main.ts`)

```typescript
app.use(helmet());
app.use(compression());
app.enableCors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,            // remove campos não declarados no DTO
  forbidNonWhitelisted: true, // e rejeita a requisição se houver
  transform: true,
  transformOptions: { enableImplicitConversion: true },
}));
```

Como a conversão implícita transforma qualquer texto em `true` (até `"false"`), os campos de consentimento usam `@StrictBoolean()` (`shared/validation/strict-boolean.ts`): só `true` ou `false` de verdade passam.

### 3. Autenticação

- **Cadastro com verificação de e-mail**: a conta só é ativada pelo link (token de 32 bytes, só o hash fica no banco, validade de 24 h, uso único). Login antes disso responde 403 `EMAIL_NOT_VERIFIED`.
- **Tokens**: acesso de 24 h (`JWT_EXPIRES_IN`) e refresh de 7 dias (`REFRESH_TOKEN_EXPIRES_IN`), com segredos diferentes. O refresh token leva `typ: "refresh"`, e o `JwtStrategy` recusa o uso de um no lugar do outro.
- **Renovação**: `POST /api/v1/auth/refresh` devolve um par novo, e o cliente renova sozinho ao receber 401.
- **Google OAuth** com `state` assinado; a conta Google já entra verificada.
- O `JwtStrategy` confere no banco, a cada requisição, se a conta ainda existe e está verificada.

### 4. Rate limit (`infra/rate-limit/rate-limit.module.ts`)

Por IP real, com limites próprios nas rotas sensíveis:

| Rota | Limite |
|---|---|
| Login | 5 por minuto |
| Cadastro, scan, reenvio da verificação | 5 a cada 15 min |
| Confirmação do e-mail | 10 a cada 15 min |
| Refresh | 20 a cada 15 min |
| Descadastro dos alertas | 20 a cada 15 min |
| Demais rotas | 100 a cada 15 min (`RATE_LIMIT_MAX_REQUESTS`) |

### 5. Proteção dos dados pessoais (LGPD)

- O scan usa sempre o e-mail da conta logada, nunca um e-mail enviado na requisição.
- No histórico e no cache, o e-mail é guardado como hash (HMAC-SHA256 com `EMAIL_HASH_SECRET`; SHA-256 sem a chave).
- Os vazamentos de cada análise são criptografados com AES-256-GCM (`ENCRYPTION_KEY`).
- A IA recebe só metadados (nome do vazamento, data, tipos de dado), nunca o e-mail.
- Os logs usam `maskEmail`, e o e-mail nunca aparece em texto.
- Consentimentos separados: Política de Privacidade (`termsAcceptedAt`) e alertas (`monitoringConsentAt`), com descadastro em 1 clique (RFC 8058).
- `DELETE /api/v1/auth/me` apaga a conta e tudo ligado a ela em cascata, e limpa o cache.

### 6. Resiliência com a HIBP

- **Circuit breaker** (`infra/http/hibp.client.ts`): abre com 50% de erro, timeout de 10 s e nova tentativa depois de 30 s. O 429 (limite de uso) não abre o circuito.
- **Consulta estrita**: erro, timeout ou circuito aberto viram erro tipado; nunca são tratados como "sem vazamentos".
- **Limite pelo plano**: o `HibpPlanService` lê o plano contratado (`/subscription/status`) e ajusta o limiter global do BullMQ, com margem de 10%. No 429, a fila pausa até o `Retry-After`.
- **Prioridade**: o scan do usuário passa na frente das checagens automáticas do monitoramento.

### 7. Cargas em segundo plano

- 6 agendamentos em horário de Brasília (catálogo, consulta horária, varredura semanal, plano HIBP, reconciliação e limpeza de contas não verificadas), com watchdog e heartbeat dos workers.
- A reconciliação recupera pelo banco o que se perdeu no Redis: e-mails de alerta pendentes, catálogo atrasado e usuários sem checagem.
- Shutdown gracioso: ao receber SIGTERM, os workers terminam o job atual antes de fechar (120 s no ECS).

### 8. Observabilidade

- **Logger JSON** (`shared/utils/logger.ts`): uma linha por evento (`{ ts, level, ctx, event, ... }`), nível por `LOG_LEVEL`. Alguns pontos antigos ainda usam `console.log`.
- **`GET /api/health`**: testa PostgreSQL e Redis com timeout de 2 s e responde 503 se algum falhar, o que tira a instância do ALB.
- **`GET /api/health/jobs`** (com `X-Admin-Token`): filas, agendamentos, workers e plano HIBP.
- **Alarmes** (scripts AWS): catálogo parado, falha de autenticação na HIBP, falhas de e-mail, reputação do SES, memória do Redis e disco do RDS.

### 9. Variáveis de ambiente

- `ConfigModule` global lê o `.env`; o `.env.example` é versionado com todas as variáveis comentadas.
- `shared/config/env.validation.ts` confere, ao subir, `JWT_SECRET` e `REFRESH_TOKEN_SECRET` (faltando, com valor de exemplo ou iguais entre si) e, em produção, também `SESSION_SECRET` e `MONITORING_UNSUBSCRIBE_SECRET` (32+ caracteres). Os problemas aparecem como **aviso no log**; a API não deixa de subir. O script `put-ssm-secrets.ps1` faz a checagem que bloqueia: recusa enviar ao SSM valores com localhost.
- Em produção, os segredos ficam no AWS SSM Parameter Store e entram na task do ECS como variáveis.

### 10. Testes e CI

- Backend: unitários (com limites mínimos de cobertura), integração (fluxos com banco em memória; o CI valida as migrations num PostgreSQL real), e2e da API, e fuzz testing do motor de risco.
- Frontend: testes de componente com Vitest e Testing Library.
- CI em 4 jobs obrigatórios, CodeQL e dependency review. Na `main`: PR com template, aprovação de Code Owner e fila de merge.

Números e comandos em [COBERTURA_TESTES_ATUAL.md](./COBERTURA_TESTES_ATUAL.md) e [GUIA_TESTES_E_FLUXO_IMPLEMENTACAO.md](./GUIA_TESTES_E_FLUXO_IMPLEMENTACAO.md).

### 11. Contêineres

- `Dockerfile` multi-stage (Node 20 Alpine): `builder`, `dev` e produção (só as dependências de produção na imagem final).
- `docker-entrypoint.sh` aplica as migrations (com novas tentativas) antes de iniciar a API.
- `docker-compose.yml`: PostgreSQL 16, Redis 7 com `noeviction` e a API.

---

## 🚀 Melhorias possíveis

1. Remover `express-session` e `passport-local`, que não são usados.
2. Trocar os `console.log` restantes pelo logger JSON.
3. Revogação de refresh token no servidor (hoje o logout só apaga os tokens do navegador).
4. Separar API e workers em duas services do ECS (`APP_ROLE`), quando a carga justificar.
5. Rodar o contêiner de produção com um usuário sem privilégios (`USER node` no Dockerfile).
6. Migrações planejadas de NestJS 12, Prisma 7 e typescript-eslint 8 (PRs do Dependabot fechados por exigirem migração).

---

**Atualizado em:** 17/10/2026 · **Projeto:** SafeID
