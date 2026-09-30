# SafeID

Repositório do projeto SafeID, com a parte técnica e a documental.

O **SafeID** verifica se o email de uma pessoa aparece em vazamentos de dados conhecidos e mostra o que fazer a respeito. Ele consulta a base do [Have I Been Pwned](https://haveibeenpwned.com), calcula um score de risco e usa IA para montar um plano de ação em linguagem simples.

Projeto de TCC do curso de Tecnologia em Análise e Desenvolvimento de Sistemas (TADS), IFSP São Paulo, 2026.

## ✨ Funcionalidades

- Cadastro e login com email e senha ou com Google
- Consulta do email do usuário nas bases de vazamentos do Have I Been Pwned
- **Score de risco** de 0 a 100, que considera o tipo de dado exposto, a data do vazamento e se ele foi verificado
- **Plano de ação com IA** em português, feito para quem não é da área de tecnologia
- Linha do tempo e detalhes de cada vazamento
- Exclusão da conta pelo próprio usuário

**Privacidade:** o email nunca é enviado para a IA, que recebe apenas o nome dos vazamentos e os tipos de dado expostos. No histórico de scans e no cache, o email é guardado só como hash.

## 🧱 Tecnologias

| Parte | Tecnologias |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS |
| Backend | Node.js 20, NestJS 10, TypeScript |
| Banco de dados | PostgreSQL 16 com Prisma |
| Cache e fila | Redis 7 com BullMQ |
| Integrações | Have I Been Pwned API v3, IA via Azure AI Foundry (SDK da OpenAI), Google OAuth |
| Testes e CI | Jest (unitários, integração e E2E), GitHub Actions, CodeQL |

## 🏗️ Arquitetura

```
Navegador (React)
      │  HTTPS + JWT
      ▼
API NestJS ──► PostgreSQL (usuários e histórico de scans)
      │
      ├──► Redis (cache dos resultados + fila BullMQ)
      │         │
      │         ▼
      │    Worker HIBP ──► Have I Been Pwned
      │
      └──► IA (Azure AI Foundry) ──► plano de ação
```

Fluxo de um scan:
1. O backend coloca o email na fila e o worker consulta o HIBP, respeitando o limite de requisições da API.
2. O `RiskEngine` calcula o score a partir dos vazamentos encontrados.
3. O `AIEngine` gera o resumo e os passos de mitigação.
4. O resultado é salvo no histórico e mostrado no painel.

Diagramas: [arquitetura (draw.io)](assets/arquitetura_safeid.drawio) · [implantação da PoC](docs/safeid_poc_deployment_diagram.svg)

## 📁 Estrutura do repositório

```
├── client/     # Frontend React (veja client/README.md)
├── server/     # Backend NestJS (veja server/README.md)
├── docs/       # Documentação do TCC, apresentações e manuais
├── assets/     # Diagramas
└── .github/    # CI, CodeQL, Dependabot e template de PR
```

## 🚀 Como rodar localmente

Pré-requisitos: **Node.js 20+** e **Docker**.

### 1. Backend

```bash
cd server
npm install
cp .env.example .env
```

Edite o `.env`. O mínimo para rodar localmente:

| Variável | Valor para rodar local |
|---|---|
| `POSTGRES_PASSWORD` | uma senha qualquer para o Postgres do Docker |
| `DATABASE_URL` | `postgresql://safeid_user:<POSTGRES_PASSWORD>@localhost:5432/safeid_db` |
| `REDIS_HOST` | `localhost` |
| `JWT_SECRET` / `REFRESH_TOKEN_SECRET` | dois valores aleatórios e diferentes entre si |
| `CORS_ORIGIN` | `http://localhost:3001` |
| `HIBP_API_KEY` | sua chave do HIBP, ou `HIBP_USE_MOCK=true` para usar dados falsos |
| `AI_API_KEY` / `AI_ENDPOINT` | opcional: sem eles o plano de ação usa a resposta padrão |

Suba o banco e o Redis, aplique as migrations e inicie a API:

```bash
docker compose up -d postgres redis
npx prisma migrate deploy
npm run dev
```

A API fica em **http://localhost:3000** e o Swagger em **http://localhost:3000/api/docs** (com `SWAGGER_ENABLED=true`).

### 2. Frontend

Em outro terminal:

```bash
cd client
npm install
cp .env.example .env   # VITE_API_URL=http://localhost:3000
npm run dev
```

O front abre em **http://localhost:3001**.

Mais detalhes nos READMEs de cada parte: [backend](server/README.md) · [frontend](client/README.md).

## 🧪 Testes

```bash
cd server
npm run test:cov              # unitários com cobertura
npm run test:integration      # integração
npm run test:e2e              # end-to-end da API
```

O CI roda lint, build e todos os testes do backend, além do lint e do build do frontend, em cada Pull Request.

## Como contribuir

O projeto usa Pull Requests, revisão obrigatória de outro desenvolvedor e validações automáticas no GitHub.

Consulte o [Manual de Git e GitHub](docs/GITHUB_E_FLUXO_CONTRIBUICAO.md) para aprender como criar branches, rodar os testes, publicar alterações e acompanhar o CI.
