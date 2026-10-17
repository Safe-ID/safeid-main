# SafeID Backend

Backend API para o sistema **SafeID** - Proteção de Identidade Segura.

Desenvolvido com **Node.js + NestJS**, com PostgreSQL (Prisma), Redis e filas BullMQ, em camadas inspiradas na **Clean Architecture**.

## 🏗️ Arquitetura

A estrutura segue a divisão clara entre camadas:

- **`src/modules`**: Módulos NestJS com controllers, services e processors (`auth`, `scan`, `notifications`, `monitoring`, `breaches`, `health`)
- **`src/core`**: Camada de domínio (engines de risco e IA, entities, repositories, use-cases)
- **`src/infra`**: Camada de infraestrutura (Prisma, Redis, filas BullMQ, clientes HIBP, envio de e-mail, rate limit)
- **`src/api`**: Peças HTTP compartilhadas pelos controllers (`@CurrentUser`, `AdminTokenGuard`)
- **`src/shared`**: Recursos compartilhados (validação do `.env`, criptografia, logger JSON, `@StrictBoolean()`)
- **`src/types`**: Tipos TypeScript de bibliotecas sem tipagem
- **`tests`**: Testes unitários, integração, e2e e scripts manuais

A árvore completa de pastas, os 7 modelos do banco e os papéis de processo (`APP_ROLE`) estão em [STRUCTURE.md](../docs/Backend/STRUCTURE.md).

## 🚀 Quick Start

O passo a passo completo, com a tabela de variáveis e os problemas comuns, está em [SETUP.md](../docs/Backend/SETUP.md). O resumo:

### Pré-requisitos

- Node.js 20+
- Docker e Docker Compose (PostgreSQL 16 e Redis 7 em contêiner)

### 1. Instalação de dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Edite o arquivo .env com suas configurações
```

Para rodar localmente com o frontend, ajuste pelo menos:

- `DATABASE_URL` e `POSTGRES_PASSWORD` (a senha é usada pelo Postgres do `docker-compose`)
- `JWT_SECRET`, `REFRESH_TOKEN_SECRET` e `SESSION_SECRET` com valores próprios e diferentes entre si
- `ENCRYPTION_KEY` (32 bytes em base64, criptografa os vazamentos no banco)
- `FRONTEND_URL` e `CORS_ORIGIN` com `http://localhost:3001` (porta do Vite configurada no `client/vite.config.js`)
- `HIBP_API_KEY` (ou `HIBP_USE_MOCK=true` para usar o cliente falso)
- `EMAIL_PROVIDER=console`: os e-mails de verificação e de alerta saem no log da API, com o link
- `MONITORING_UNSUBSCRIBE_SECRET` com 32 caracteres ou mais
- `AI_API_KEY` e `AI_ENDPOINT` (opcional: sem eles o scan usa a recomendação padrão)

Para habilitar login/cadastro com Google, configure também `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_CALLBACK_URL`. `ADMIN_TOKEN` só é necessário para consultar `/api/health/jobs`.

### 3. Subir infraestrutura (com Docker)

```bash
docker compose up -d postgres redis
```

### 4. Iniciar servidor em desenvolvimento

```bash
npm run dev
```

O `predev` roda `prisma generate` e `prisma migrate deploy` antes de iniciar, então as migrations de `prisma/migrations` são aplicadas sozinhas.

O servidor estará disponível em **http://localhost:3000**

A documentação Swagger em **http://localhost:3000/api/docs** (com `SWAGGER_ENABLED=true`)

Para criar uma migration nova depois de alterar o `schema.prisma`, use `npm run db:migrate`. Evite o `npm run db:push`: ele altera o banco sem gerar migration e deixa o histórico inconsistente.

## 📝 Scripts disponíveis

### Desenvolvimento

- `npm run dev` - Aplica as migrations e inicia em modo watch
- `npm run build` - Build para produção
- `npm start` - Inicia a aplicação a partir do `dist/`

### Código

- `npm run lint` - Verifica estilo com ESLint
- `npm run lint:fix` - Corrige erros automaticamente
- `npm run format` - Formata com Prettier

### Testes

- `npm test` / `npm run test:unit` - Testes unitários
- `npm run test:cov` - Unitários com cobertura (o CI exige os limites)
- `npm run test:integration` - Testes de integração
- `npm run test:e2e` - Testes end-to-end
- `npm run test:auth:manual` - Fluxo manual de signup/login/me
- `npm run test:hibp:manual` - Fluxo manual com emails de teste da HIBP
- `npm run test:setup:user` - Cria o usuário de apoio para testes manuais

### Banco de dados

- `npm run db:migrate` - Cria nova migration a partir do `schema.prisma`
- `npm run db:studio` - Abre Prisma Studio para visualizar dados
- `npm run backfill:user-breaches` - Define a base de vazamentos conhecidos a partir dos scans (ver abaixo)

### Backfill da base de vazamentos (monitoramento)

O monitoramento só avisa sobre vazamentos **fora** da base de cada usuário (tabela `user_breach`). Depois de aplicar a migration `20261006000000_email_verification_and_breach_monitoring`, e **antes** de ligar o monitoramento, rode uma vez:

```bash
npm run backfill:user-breaches -- --dry-run
npm run backfill:user-breaches
```

- Para cada usuário, lê o scan mais recente do **próprio email da conta** e grava os vazamentos como `BASELINE`, além de `breachBaselineAt`.
- Usuários sem scan ficam sem base. A primeira checagem do monitoramento define a base em silêncio, sem notificar.
- Use as mesmas `ENCRYPTION_KEY` e `EMAIL_HASH_SECRET` da aplicação. Sem elas o `breachData` criptografado não abre e o `emailHash` não bate.
- É idempotente: rodar de novo não duplica linhas nem muda a data da base.
- Em produção, rode com a `DATABASE_URL` do RDS pelo túnel do bastion (`connect-bastion-ssm.ps1`). Faça o snapshot do banco antes (`create-database.ps1 -Action Snapshot`).

## 🗂️ Estrutura de módulos

### Autenticação (`auth`)
- Cadastro com email e senha (bcrypt), aceite dos termos e verificação de e-mail: o cadastro não devolve tokens; a conta só entra depois de confirmar o link enviado por e-mail
- Login com email e senha (conta não verificada recebe 403 `EMAIL_NOT_VERIFIED`) e login/cadastro com Google OAuth
- Token de acesso JWT (24 h) no header `Authorization: Bearer <token>` e refresh token (7 dias) renovado em `POST /api/v1/auth/refresh`
- Perfil do usuário com o último resultado de scan
- Exclusão da conta autenticada (scans, notificações e vazamentos conhecidos são apagados junto)

### Scan (`scan`)
- Consulta o email da conta logada na API do Have I Been Pwned por uma fila BullMQ
- Calcula o score de risco com o `RiskEngine` (ver abaixo)
- Gera o plano de ação com IA (`AIEngine`), sem enviar o email para a IA
- Guarda o resultado no histórico e em cache no Redis

O `RiskEngine` soma os pesos das Data Classes expostas em cada vazamento e multiplica pelo fator temporal (1,0 até 24 meses, 0,7 até 60 meses, 0,4 acima disso). A soma dos vazamentos é normalizada por 50 para a escala 0–100 (`min(100, bruto / 50 × 100)`) e classificada em `LOW` (0–25), `MODERATE` (26–50), `HIGH` (51–75) ou `CRITICAL` (76–100).

### Notificações (`notifications`)
- Sino do painel: lista paginada, contador de não lidas e marcação de leitura
- Worker de e-mail (verificação de conta e alertas), pelo Amazon SES ou pelo console em desenvolvimento

### Monitoramento (`monitoring`) e vazamentos conhecidos (`breaches`)
- Sincroniza o catálogo público da HIBP e checa os usuários que aceitaram o monitoramento
- Alerta (sino e e-mail) só sobre vazamentos que não estão na base do usuário, e recalcula o score
- Preferência de monitoramento no painel e descadastro em um clique pelo link do e-mail
- Diagnóstico das filas e agendamentos em `GET /api/health/jobs`

### Health (`health`)
- Verifica o PostgreSQL e o Redis e responde 503 se algum falhar

## 🔒 Segurança

- **Helmet**: Proteção de headers HTTP
- **Autenticação**: JWT com expiração de 24h e refresh token de 7 dias
- **Senhas**: Hash com bcrypt
- **Validação**: DTOs validados com class-validator (`whitelist` e `forbidNonWhitelisted`), booleanos estritos
- **Rate limit**: Limites por IP em cada rota (`@nestjs/throttler`)
- **CORS**: Liberado só para a origem configurada em `CORS_ORIGIN`
- **Privacidade**: O email é guardado como hash HMAC, os vazamentos ficam criptografados (AES-256-GCM) e o email nunca é enviado para a IA

## 📊 Observabilidade

- Health check em `GET /api/health` (PostgreSQL e Redis, 503 se algum falhar; usado pelo `HEALTHCHECK` do Docker e pelo ALB)
- Diagnóstico das filas, agendamentos e workers em `GET /api/health/jobs` (header `X-Admin-Token`)
- Logs estruturados: uma linha JSON por evento (`{ ts, level, ctx, event, ... }`) pelo logger de [`src/shared/utils/logger.ts`](src/shared/utils/logger.ts), com nível em `LOG_LEVEL` e `maskEmail` para nunca registrar e-mail em texto

## 📚 Documentação

### Endpoints principais

| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| `POST` | `/api/v1/auth/signup` | não | Cria a conta e envia o e-mail de verificação (não devolve tokens) |
| `POST` | `/api/v1/auth/verify-email` | não | Confirma o e-mail com o token do link, devolve os tokens e roda o primeiro scan |
| `POST` | `/api/v1/auth/resend-verification` | não | Reenvia o link de verificação |
| `POST` | `/api/v1/auth/login` | não | Login com email e senha |
| `POST` | `/api/v1/auth/refresh` | refresh token | Renova o token de acesso e o refresh token |
| `GET` | `/api/v1/auth/google` | não | Inicia o login com Google |
| `GET` | `/api/v1/auth/google/callback` | não | Retorno do Google, redireciona para o front com os tokens |
| `GET` | `/api/v1/auth/me` | JWT | Perfil e último resultado de scan |
| `DELETE` | `/api/v1/auth/me` | JWT | Exclui a conta |
| `POST` | `/api/v1/scan` | JWT | Roda um novo scan do email da conta |
| `GET` | `/api/v1/scan/history` | JWT | Histórico de scans do usuário |
| `GET` | `/api/v1/scan/:jobId` | JWT | Detalhe de um scan |
| `GET` | `/api/v1/notifications` | JWT | Notificações do sino, paginadas por cursor |
| `GET` | `/api/v1/notifications/unread-count` | JWT | Contador de não lidas |
| `PATCH` | `/api/v1/notifications/:id/read` | JWT | Marca uma notificação como lida |
| `PATCH` | `/api/v1/notifications/read-all` | JWT | Marca todas como lidas |
| `GET` | `/api/v1/monitoring/status` | JWT | Estado do monitoramento do usuário |
| `PATCH` | `/api/v1/monitoring/preferences` | JWT | Liga ou desliga o monitoramento |
| `GET` `POST` | `/api/v1/monitoring/unsubscribe` | token do e-mail | Descadastro pelo link do alerta (o `POST` é o one-click da RFC 8058) |
| `GET` | `/api/health` | não | Saúde do PostgreSQL e do Redis |
| `GET` | `/api/health/jobs` | `X-Admin-Token` | Filas, agendamentos e heartbeats dos workers |

Payloads, respostas, códigos de erro e limites por rota estão em [MATRIZ_CONSUMO_API_FRONTEND.md](../docs/Backend/MATRIZ_CONSUMO_API_FRONTEND.md). A documentação interativa fica no Swagger em `/api/docs` (com `SWAGGER_ENABLED=true`).

## 🐳 Docker

### Subir contêineres

```bash
docker compose up -d
```

### Derrubar contêineres

```bash
docker compose down
```

### Visualizar logs

```bash
docker compose logs -f app
```

## ☁️ AWS Deploy

> Os scripts `.ps1` do backend ficam versionados nesta pasta (`server/`). Nenhum valor da conta fica no código: IDs de VPC, subnets e security groups, senhas e e-mails vêm do `server/.env` (fora do git; os nomes estão na seção "Scripts AWS" do `.env.example`). Os scripts do frontend (`client/*-s3-cloudfront.ps1`) estão no `.gitignore` do `client`: peça para quem cuida do deploy.

A lista completa de scripts e a ordem de aplicação dos ajustes de confiabilidade e do monitoramento estão nas seções 9 e 10 de [ARQUITETURA_AWS.md](../docs/Backend/ARQUITETURA_AWS.md). Além dos scripts abaixo, há `create-database.ps1` (RDS), `create-redis.ps1` (ElastiCache), `put-ssm-secrets.ps1` (segredos no SSM), `create-ses.ps1` (e-mail) e `create-alerts.ps1` (alarmes).

### Fluxo recomendado

Para manter o backend privado por trás de um ponto de entrada público controlado, siga esta ordem:

1. Criar o NAT Gateway e a rota privada
2. Enviar a imagem para o ECR
3. Enviar os segredos para o SSM (`put-ssm-secrets.ps1 -DryRun`, conferir, e rodar sem `-DryRun`)
4. Subir o stack no ECS Fargate com ALB internet-facing
5. Publicar o frontend em S3 + CloudFront
6. Acessar a VPC via bastion com SSM quando precisar fazer troubleshooting

O ALB usa `ALB_SUBNET_IDS` com duas subnets e as tasks usam `BACKEND_SUBNET_IDS` com a subnet privada da API. O padrão é `ALB_SCHEME=internet-facing`. Se você informar `ALB_HTTPS_CERTIFICATE_ARN`, o script cria o listener em HTTPS na porta 443.

### Publicar o frontend

Use o script `client/provision-s3-cloudfront.ps1` para criar o bucket S3, a distribuição CloudFront e o Origin Access Control. Depois, use `client/deploy-s3-cloudfront.ps1` para gerar o build do Vite com `VITE_API_URL` apontando para a URL pública do backend e sincronizar os arquivos para o bucket S3, com invalidação opcional do CloudFront.

Pré-requisitos do frontend:

- bucket S3 criado para hospedar os arquivos estáticos
- distribuição CloudFront apontando para o bucket
- origem do CloudFront protegida com OAC ou, no mínimo, bucket sem acesso público direto
- domínio do frontend apontando para a distribuição CloudFront
- `VITE_API_URL` configurado para o endpoint público do backend
- certificado ACM em `us-east-1` se você for usar domínio próprio no CloudFront

Exemplo:

```powershell
.\deploy-s3-cloudfront.ps1 -ApiBaseUrl https://api.seudominio.com -S3BucketName safeid-frontend-prod -CloudFrontDistributionId E1234567890ABC
```

O backend usa JWT no `Authorization`, então basta liberar o domínio do frontend no `CORS_ORIGIN`.

### Criar NAT Gateway

```powershell
.\create-nat-gateway.ps1 -Action Create
```

Esse passo precisa acontecer antes do deploy do ECS para que a API privada tenha saída à internet para chamadas externas.

### Enviar imagem para o ECR

```powershell
.\push-ecr-image.ps1 -Action Create -AwsRegion us-east-1 -RepositoryName safeid-backend -ImageTag latest
```

Use a mesma região do `AWS_REGION` do `.env`, que é a usada pelo `deploy-ecs-fargate.ps1`.

### Subir a aplicação no ECS Fargate

```powershell
.\deploy-ecs-fargate.ps1 -Action Create
```

As variáveis de configuração do [deploy-ecs-fargate.ps1](deploy-ecs-fargate.ps1) vêm do `server/.env` (ou de variáveis de ambiente definidas antes de rodar o script). Os segredos não passam pelo script: a task definition referencia os parâmetros do SSM.

Para acessar externamente a VPC sem expor o serviço, use uma destas opções:

- AWS Client VPN para conectar sua máquina à VPC
- Site-to-Site VPN entre sua rede e a VPC
- Bastion host com SSH ou SSM Session Manager e port forwarding
- Session Manager port forwarding diretamente para uma instância de apoio na VPC

Para abrir um túnel até o ALB do backend no `localhost:8080`:

```powershell
.\connect-bastion-ssm.ps1 -Target Alb -LocalPort 8080
```

Outros alvos práticos:

```powershell
.\connect-bastion-ssm.ps1 -Target Rds -LocalPort 5432
.\connect-bastion-ssm.ps1 -Target Redis -LocalPort 6379
```

### Remover o stack para evitar cobrança

```powershell
.\deploy-ecs-fargate.ps1 -Action Delete
.\push-ecr-image.ps1 -Action Delete -AwsRegion us-east-1 -RepositoryName safeid-backend
```

O script de ECS cria e remove o cluster, o serviço, o ALB, o target group, o log group e as roles necessárias. Também libera o acesso do ECS para o RDS e para o Redis pelos security groups informados.

Para o ALB público, além do script, você precisa de:

- um certificado ACM na mesma região do ALB, se quiser HTTPS no ALB
- um DNS público apontando para o ALB ou para o CloudFront
- uma política de segurança/WAF se quiser restringir ou inspecionar o acesso
- CORS do backend permitindo o domínio do CloudFront

### Bastion com SSM para acessar a VPC

Pré-requisitos: AWS CLI configurado e Session Manager Plugin disponível na máquina.

Crie o bastion sem SSH aberto e com acesso via Session Manager:

```powershell
.\create-bastion-ssm.ps1 -Action Create
```

Para remover:

```powershell
.\create-bastion-ssm.ps1 -Action Delete
```

Esse caminho mantém o backend privado na VPC e expõe apenas o acesso administrativo via Session Manager. Os exemplos de túnel para ALB, RDS e Redis estão na seção de deploy no ECS acima.

### NAT Gateway para saída da API

Crie a NAT Gateway e a rota privada:

```powershell
.\create-nat-gateway.ps1 -Action Create
```

Remova quando quiser cortar custo:

```powershell
.\create-nat-gateway.ps1 -Action Delete
```

Com a NAT em funcionamento, as chamadas HTTPS para o HIBP e para a IA (Azure AI Foundry) continuam saindo normalmente a partir da API na subnet privada.

## 🔧 Configuração

### Variáveis de ambiente essenciais

```env
NODE_ENV=development
APP_PORT=3000
DATABASE_URL=postgresql://safeid_user:password@localhost:5432/safeid_db
SESSION_SECRET=your-session-secret
JWT_SECRET=your-jwt-secret
REFRESH_TOKEN_SECRET=your-refresh-token-secret
ENCRYPTION_KEY=
EMAIL_PROVIDER=console
```

Veja `.env.example` para a lista completa, com comentários. Ao subir, a API confere os segredos (`src/shared/config/env.validation.ts`) e avisa no log se algum estiver faltando, com valor de exemplo ou repetido.

### Variáveis da integração HIBP

```env
HIBP_API_KEY=00000000000000000000000000000000
HIBP_BASE_URL=https://haveibeenpwned.com/api/v3
HIBP_USE_MOCK=false
HIBP_RPM_LIMIT=
HIBP_RPM_SAFETY_FACTOR=0.9
HIBP_RPM_FALLBACK=10
```

- `HIBP_API_KEY`: chave da API v3 da Have I Been Pwned.
- O valor com 32 zeros funciona para os emails de teste da própria HIBP.
- `HIBP_BASE_URL`: endpoint base da API HIBP.
- `HIBP_USE_MOCK`: opt-in explícito para os clientes mock (consulta de conta e catálogo) em desenvolvimento. Com ele, `breached@example.com` tem vazamentos simulados e `clean@example.com` não tem nenhum.
- `HIBP_RPM_LIMIT`: opcional, só para forçar um limite menor que o do plano.
- `HIBP_RPM_SAFETY_FACTOR`: fração do RPM do plano usada pelo worker (padrão 0,9).
- `HIBP_RPM_FALLBACK`: RPM usado se `/subscription/status` falhar e não houver plano em cache.

A consulta HIBP roda via BullMQ, na fila `hibp-check`. O limite e a concorrência do worker vêm do plano contratado (`GET /subscription/status`): 1 chamada a cada `60 000 / (Rpm × 0,9)` ms (Core 1: ~6,7 s). O limiter do BullMQ fica no Redis, então vale para todas as tasks juntas. Trocar de plano não exige mudar código nem configuração.

### Comandos para validar a integração HIBP

```powershell
npm run dev
```

Em outro terminal, crie uma conta. Com `EMAIL_PROVIDER=console`, o link de verificação aparece no log da API (evento `email.sent`, campo `links`); o valor de `verify_token` no link é o token da confirmação, que devolve o `access_token` e já roda o primeiro scan:

```powershell
curl -X POST "http://localhost:3000/api/v1/auth/signup" ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"seu-email@dominio.com\",\"password\":\"sua-senha\",\"acceptTerms\":true}"

curl -X POST "http://localhost:3000/api/v1/auth/verify-email" ^
  -H "Content-Type: application/json" ^
  -d "{\"token\":\"<verify_token do link>\"}"
```

Para rodar um scan novo depois, com o token do `verify-email` ou do login:

```powershell
curl -X POST "http://localhost:3000/api/v1/scan" ^
  -H "accept: application/json" ^
  -H "Authorization: Bearer <access_token>"
```

A resposta traz `riskScore`, `classification` e `breachesFound`. No log da API, o worker registra eventos JSON como `hibp.worker_started` na subida e `hibp.auth_failed` ou `hibp.rate_limited` em caso de problema com a HIBP.

## 🧪 Testes

A aplicação segue a pirâmide de testes:

```
      E2E (Ponta a ponta)
    Integração (Rotas + BD)
  Unitários (Lógica pura)
```

Execute testes com:

```bash
npm test                  # Unitários
npm run test:integration  # Integração
npm run test:e2e          # End-to-end
npm run test:cov          # Com cobertura
```

Detalhes em [GUIA_TESTES_E_FLUXO_IMPLEMENTACAO.md](../docs/Backend/GUIA_TESTES_E_FLUXO_IMPLEMENTACAO.md).

## 📋 Checklist de Setup

- [ ] Node.js 20+ instalado
- [ ] Dependências instaladas (`npm install`)
- [ ] Arquivo `.env` configurado
- [ ] Docker e Docker Compose instalados
- [ ] PostgreSQL e Redis rodando (`docker compose up -d postgres redis`)
- [ ] Servidor iniciado com sucesso (`npm run dev`, que aplica as migrations)
- [ ] `GET /api/health` respondendo `status: ok`
- [ ] Swagger acessível em `/api/docs`

## 🤝 Contribuindo

Siga o [Manual de Git e GitHub](../docs/GITHUB_E_FLUXO_CONTRIBUICAO.md): branch a partir da `main`, Pull Request, revisão de outra pessoa do time e CI verde antes do merge.

## 📄 Licença

MIT (campo `license` do `package.json`)

## 📞 Suporte

Para questões sobre a arquitetura ou implementação, consulte:
- [Índice da documentação do backend](../docs/Backend/INDICE_DOCUMENTACAO.md)
- [Estrutura do código](../docs/Backend/STRUCTURE.md)
- [Estrutura do Backend SafeID.pdf](../docs/Backend/Estrutura%20do%20Backend%20SafeID.pdf)

---

**SafeID Backend** • Proteção de Identidade Segura
