# Guia de setup local - SafeID Backend

Passo a passo para rodar a API, o banco e o frontend na sua máquina.

## Pré-requisitos

- **Node.js 20 ou mais novo** (o CI e o Dockerfile usam o 20)
- **Docker Desktop** (PostgreSQL 16 e Redis 7 em contêiner)
- **Git**

## 1. Instalar as dependências

```bash
cd server
npm install
```

## 2. Configurar o `.env`

```bash
cp .env.example .env
```

O `.env.example` traz todas as variáveis, com comentários. Para rodar localmente, preencha pelo menos:

| Variável | Valor local |
|---|---|
| `POSTGRES_PASSWORD` | uma senha qualquer (usada pelo contêiner do PostgreSQL) |
| `DATABASE_URL` | `postgresql://safeid_user:<POSTGRES_PASSWORD>@localhost:5432/safeid_db` |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `SESSION_SECRET` | valores aleatórios e diferentes entre si |
| `ENCRYPTION_KEY` | 32 bytes em base64 (`openssl rand -base64 32`), criptografa os vazamentos no banco |
| `HIBP_USE_MOCK` | `true` para usar a HIBP simulada; `false` com uma `HIBP_API_KEY` válida |
| `EMAIL_PROVIDER` | `console`: os e-mails de verificação e de alerta aparecem no log, com o link |
| `MONITORING_UNSUBSCRIBE_SECRET` | 32 caracteres ou mais |
| `FRONTEND_URL`, `CORS_ORIGIN` | `http://localhost:3001` |

A IA (`AI_API_KEY`, `AI_ENDPOINT`) é opcional no ambiente local: sem ela, o plano de ação usa a resposta padrão. `ADMIN_TOKEN` só é necessário para consultar `/api/health/jobs`.

Com `HIBP_USE_MOCK=true`, o e-mail `breached@example.com` tem vazamentos simulados e `clean@example.com` não tem nenhum.

## 3. Subir o PostgreSQL e o Redis

```bash
docker compose up -d postgres redis
docker compose ps
```

O Redis sobe com `maxmemory-policy noeviction`, igual à produção (exigência do BullMQ).

## 4. Iniciar a API

```bash
npm run dev
```

O `predev` roda `prisma generate` e `prisma migrate deploy` antes de iniciar, então as migrations são aplicadas sozinhas. A API fica em **http://localhost:3000**:

- `GET /api/health`: deve responder `{"status":"ok", "database":{"status":"ok"}, "redis":{"status":"ok"}}`
- Swagger em `http://localhost:3000/api/docs`, quando `SWAGGER_ENABLED=true`

Use `npm run db:migrate` só para **criar** uma migration nova depois de mudar o `schema.prisma`. Evite o `npm run db:push`: ele altera o banco sem gerar migration e deixa o histórico inconsistente.

## 5. Iniciar o frontend

Em outro terminal:

```bash
cd client
npm install
npm run dev
```

O painel fica em **http://localhost:3001** e usa a API em `http://localhost:3000` (ou a `VITE_API_URL` do `client/.env`).

## 6. Testes

```bash
cd server
npm run test:unit          # testes unitários
npm run test:cov           # unitários com cobertura (o CI exige os limites)
npm run test:integration   # integração (fluxos com banco em memória)
npm run test:e2e           # API completa via HTTP

cd ../client
npm test                   # testes de componente (Vitest)
```

Detalhes em [GUIA_TESTES_E_FLUXO_IMPLEMENTACAO.md](./GUIA_TESTES_E_FLUXO_IMPLEMENTACAO.md).

## 7. Qualidade de código

```bash
npm run lint        # ESLint
npm run lint:fix    # corrige o que der automaticamente
npm run format      # Prettier
npm run build       # compila o TypeScript
```

## Banco de dados

```bash
npm run db:studio                 # Prisma Studio para explorar os dados
npm run db:migrate                # cria uma migration a partir do schema.prisma
npm run backfill:user-breaches    # registra os vazamentos já conhecidos das contas antigas
npx prisma migrate reset          # apaga e recria o banco local (cuidado!)
```

## Docker

```bash
docker compose up -d            # PostgreSQL, Redis e a API em contêiner
docker compose logs -f app      # logs da API
docker compose down             # para tudo (os dados ficam nos volumes)
docker compose down -v          # para tudo e APAGA os dados
```

A imagem de produção é construída com o `Dockerfile` multi-stage, e o `docker-entrypoint.sh` aplica as migrations antes de iniciar.

## Problemas comuns

**`failed to connect to the docker API`**: o Docker Desktop está fechado. Abra e espere o engine iniciar.

**Erro de conexão com o banco**: confira `docker compose ps` e se a senha da `DATABASE_URL` é a mesma do `POSTGRES_PASSWORD`.

**Porta 3000 ou 3001 ocupada**: no Windows, `netstat -ano | findstr :3000` mostra o processo, e `taskkill /PID <pid> /F` encerra.

**`hibp.auth_failed` no log**: a `HIBP_API_KEY` é inválida ou venceu. Use `HIBP_USE_MOCK=true` enquanto isso.

**Dois testes do `/api/health/jobs` falhando localmente**: atualize a branch. Isso foi corrigido no PR #80 (o `ADMIN_TOKEN` do `.env` vazava para os testes).

## Segurança

- Nunca faça commit do `.env`. Em produção, os segredos ficam no AWS SSM Parameter Store (ver [ARQUITETURA_AWS.md](./ARQUITETURA_AWS.md)).
- Ao subir, a API confere os segredos (`shared/config/env.validation.ts`) e avisa no log se algum estiver faltando, com valor de exemplo ou repetido. É só um aviso: a API sobe mesmo assim, então leia o log ao configurar um ambiente novo.

---

**SafeID Backend** · Documentação atualizada em 17/10/2026
