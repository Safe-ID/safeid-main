# Testes E2E no navegador

Jornada completa do SafeID com o Playwright. Rodam **só em uma cópia local**: criam e apagam contas e leem os links de e-mail do log da API. Não aponte para a produção.

## Preparar a cópia local

Contêineres descartáveis, que não mexem nos volumes do `docker-compose`:

```bash
docker run -d --rm --name safeid-t-pg -e POSTGRES_USER=t -e POSTGRES_PASSWORD=t -e POSTGRES_DB=t -p 55432:5432 postgres:16-alpine
```

```bash
docker run -d --rm --name safeid-t-redis -p 56379:6379 redis:7-alpine redis-server --maxmemory-policy noeviction
```

Em `server/`, depois de `npm ci`, com `DATABASE_URL=postgresql://t:t@127.0.0.1:55432/t`:

```bash
npx prisma migrate deploy && npm run build
```

Suba a API, guardando o log, com estas variáveis de ambiente (os valores abaixo são só para esta cópia):

| Variável | Valor |
|---|---|
| `NODE_ENV` | `development` |
| `APP_PORT` | `3100` |
| `DATABASE_URL` | `postgresql://t:t@127.0.0.1:55432/t` |
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `56379` |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `SESSION_SECRET`, `EMAIL_HASH_SECRET` | qualquer texto de teste |
| `MONITORING_UNSUBSCRIBE_SECRET` | texto de teste com 32 caracteres ou mais |
| `ENCRYPTION_KEY` | texto de teste com 32 caracteres |
| `HIBP_USE_MOCK` | `true` |
| `EMAIL_PROVIDER` | `console` |
| `FRONTEND_URL` / `CORS_ORIGIN` | `http://localhost:3101` |
| `RATE_LIMIT_MAX_REQUESTS` | `1000000` |

```bash
node dist/main.js > api.log 2>&1
```

Em `client/`, gere o front apontando para essa API e sirva o build:

```bash
VITE_API_URL=http://localhost:3100 npm run build
```

```bash
npx vite preview --port 3101 --strictPort
```

## Rodar

Nesta pasta, com o caminho do log da API em `E2E_API_LOG`:

```bash
npm ci
```

```bash
npx playwright install chromium firefox webkit
```

```bash
E2E_API_LOG=../server/api.log npx playwright test --project=chromium
```

Os projetos são `chromium`, `firefox`, `webkit` e `celular`. Rode um por vez, com cerca de 1 minuto de intervalo: os limites por rota da API continuam ativos (login, 5 por minuto; cadastro, 5 a cada 15 minutos). Eles ficam em memória, então reiniciar a API também os zera.

## Cobertura

- Cadastro, confirmação pelo link, painel, vazamentos, plano e exportação em PDF.
- "Baixar meus dados", troca e recuperação de senha, exclusão da conta.
- Páginas públicas, textos legais, página 404, rolagem no celular e erros de CSP.

Ficam de fora o login com Google, a HIBP real, a IA real e o envio real de e-mail.
