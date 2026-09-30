# SafeID Backend

Backend API para o sistema **SafeID** - Proteção de Identidade Segura.

Desenvolvido com **Node.js + NestJS**, seguindo os padrões de **Clean Architecture** e atuais de backend profissional.

## 🏗️ Arquitetura

A estrutura segue a divisão clara entre camadas:

- **`src/modules`**: Módulos NestJS com controllers, services e DTOs (`auth`, `scan`, `health`)
- **`src/core`**: Camada de domínio (engines de risco e IA, entities, repositories, use-cases)
- **`src/infra`**: Camada de infraestrutura (Prisma, Redis, fila BullMQ, cliente HIBP)
- **`src/api`**: Decorators compartilhados pelos controllers (ex.: `@CurrentUser`)
- **`src/shared`**: Recursos compartilhados (criptografia)
- **`src/types`**: Tipos TypeScript de bibliotecas sem tipagem
- **`tests`**: Testes unitários, integração, e2e e scripts manuais

## 🚀 Quick Start

### Pré-requisitos

- Node.js 20+
- Docker e Docker Compose
- PostgreSQL (via Docker) ou localmente

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
- `JWT_SECRET` e `REFRESH_TOKEN_SECRET` com valores próprios
- `CORS_ORIGIN=http://localhost:5173` (endereço do Vite; sem isso o navegador bloqueia as chamadas do front)
- `HIBP_API_KEY` (ou `HIBP_USE_MOCK=true` para usar o cliente falso)
- `AI_API_KEY` e `AI_ENDPOINT` (opcional: sem eles o scan usa a recomendação padrão)

Para habilitar login/cadastro com Google, configure também `FRONTEND_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_CALLBACK_URL`.

### 3. Subir infraestrutura (com Docker)

```bash
docker-compose up -d
```

### 4. Setup do banco de dados

```bash
# Aplicar as migrations versionadas em prisma/migrations
npx prisma migrate deploy

# (Opcional) Explorar o banco com Prisma Studio
npm run db:studio
```

Para criar uma migration nova depois de alterar o `schema.prisma`, use `npm run db:migrate`.

### 5. Iniciar servidor em desenvolvimento

```bash
npm run dev
```

O servidor estará disponível em **http://localhost:3000**

A documentação Swagger em **http://localhost:3000/api/docs**

## 📝 Scripts disponíveis

### Desenvolvimento

- `npm run dev` - Inicia em modo watch
- `npm run build` - Build para produção
- `npm start` - Inicia a aplicação

### Código

- `npm run lint` - Verifica estilo com ESLint
- `npm run lint:fix` - Corrige erros automaticamente
- `npm run format` - Formata com Prettier

### Testes

- `npm test` - Testes unitários
- `npm run test:watch` - Testes em modo watch
- `npm run test:cov` - Cobertura de testes
- `npm run test:integration` - Testes de integração
- `npm run test:e2e` - Testes end-to-end
- `npm run test:auth:manual` - Fluxo manual de signup/login/me
- `npm run test:hibp:manual` - Fluxo manual com emails de teste da HIBP
- `npm run test:setup:user` - Cria o usuário de apoio para testes manuais

### Banco de dados

- `npm run db:migrate` - Cria nova migration
- `npm run db:push` - Aplica schema sem migration
- `npm run db:studio` - Abre Prisma Studio para visualizar dados

## 🗂️ Estrutura de módulos

### Autenticação (`auth`)
- Cadastro e login com email e senha (senha com bcrypt)
- Autenticação por JWT no header `Authorization: Bearer <token>`
- Login/cadastro com Google OAuth
- Perfil do usuário com o último resultado de scan
- Exclusão da conta autenticada (o histórico de scans é apagado junto)

### Scan (`scan`)
- Consulta o email do usuário na API do Have I Been Pwned por uma fila BullMQ
- Calcula o score de risco (`RiskEngine`: dados expostos, recência e verificação)
- Gera o plano de ação com IA (`AIEngine`), sem enviar o email para a IA
- Guarda o resultado no histórico e em cache no Redis

### Health (`health`)
- Verifica a conexão com o banco de dados

## 🔒 Segurança

- **Helmet**: Proteção de headers HTTP
- **Autenticação**: JWT com expiração de 24h
- **Senhas**: Hash com bcrypt
- **Validação**: DTOs validados com class-validator (`whitelist` e `forbidNonWhitelisted`)
- **CORS**: Liberado só para a origem configurada em `CORS_ORIGIN`
- **Privacidade**: O email é guardado apenas como hash e nunca é enviado para a IA

## 📊 Observabilidade

- Health check em `GET /api/health` (usado pelo `HEALTHCHECK` do Docker)
- Logs no console do worker do HIBP, da fila e do motor de IA

## 📚 Documentação

### Endpoints principais

| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| `POST` | `/api/v1/auth/signup` | não | Cria a conta e roda o primeiro scan |
| `POST` | `/api/v1/auth/login` | não | Login com email e senha |
| `GET` | `/api/v1/auth/google` | não | Inicia o login com Google |
| `GET` | `/api/v1/auth/google/callback` | não | Retorno do Google, redireciona para o front com o token |
| `GET` | `/api/v1/auth/me` | JWT | Perfil e último resultado de scan |
| `DELETE` | `/api/v1/auth/me` | JWT | Exclui a conta |
| `POST` | `/api/v1/scan` | JWT | Roda um novo scan |
| `GET` | `/api/v1/scan/history` | JWT | Histórico de scans do usuário |
| `GET` | `/api/v1/scan/:jobId` | JWT | Detalhe de um scan |
| `GET` | `/api/health` | não | Status de saúde |

Toda a documentação completa está disponível via Swagger em `/api/docs` (com `SWAGGER_ENABLED=true`).

## 🐳 Docker

### Subir contêineres

```bash
docker-compose up -d
```

### Derrubar contêineres

```bash
docker-compose down
```

### Visualizar logs

```bash
docker-compose logs -f app
```

## ☁️ AWS Deploy

> Os scripts `.ps1` citados nesta seção não ficam no repositório: eles estão no `.gitignore` porque dependem da conta AWS do time. Peça os scripts para quem cuida do deploy.

### Fluxo recomendado

Para manter o backend privado por trás de um ponto de entrada público controlado, siga esta ordem:

1. Criar o NAT Gateway e a rota privada
2. Enviar a imagem para o ECR
3. Subir o stack no ECS Fargate com ALB internet-facing
4. Publicar o frontend em S3 + CloudFront
5. Acessar a VPC via bastion com SSM quando precisar fazer troubleshooting

O ALB usa `ALB_SUBNET_IDS` com duas subnets e as tasks usam `BACKEND_SUBNET_IDS` com a subnet privada da API. Para um ALB público, configure `ALB_SCHEME=internet-facing`. Se você informar `ALB_HTTPS_CERTIFICATE_ARN`, o script cria o listener em HTTPS na porta 443.

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

Se o backend usar cookies ou sessão, ajuste CORS e os atributos de cookie para o domínio do CloudFront. Se usar JWT no `Authorization`, basta liberar o domínio do frontend no CORS.

### Criar NAT Gateway

```powershell
.\create-nat-gateway.ps1 -Action Create
```

Esse passo precisa acontecer antes do deploy do ECS para que a API privada tenha saída à internet para chamadas externas.

### Enviar imagem para o ECR

```powershell
.\push-ecr-image.ps1 -Action Create -AwsRegion sa-east-1 -RepositoryName safeid-backend -ImageTag latest
```

### Subir a aplicação no ECS Fargate

```powershell
.\deploy-ecs-fargate.ps1 -Action Create
```

Edite as variáveis de configuração no topo do [deploy-ecs-fargate.ps1](deploy-ecs-fargate.ps1) ou sobrescreva-as por variáveis de ambiente antes de rodar o script.

Para acessar externamente a VPC sem expor o serviço, use uma destas opções:

- AWS Client VPN para conectar sua máquina à VPC
- Site-to-Site VPN entre sua rede e a VPC
- Bastion host com SSH ou SSM Session Manager e port forwarding
- Session Manager port forwarding diretamente para uma instância de apoio na VPC

Para abrir um túnel até o ALB interno do backend no `localhost:8080`:

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
.\push-ecr-image.ps1 -Action Delete -AwsRegion sa-east-1 -RepositoryName safeid-backend
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

Esse caminho mantém o backend privado na VPC e expõe apenas o acesso administrativo via Session Manager. Os exemplos de túnel para ALB, RDS e Redis estão na seção de fluxo recomendado acima.

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
DATABASE_URL=postgresql://user:password@localhost:5432/safeid_db
SESSION_SECRET=your-session-secret
JWT_SECRET=your-jwt-secret
REFRESH_TOKEN_SECRET=your-refresh-token-secret
```

Veja `.env.example` para lista completa.

### Variáveis da integração HIBP

```env
HIBP_API_KEY=00000000000000000000000000000000
HIBP_BASE_URL=https://haveibeenpwned.com/api/v3
HIBP_MIN_INTERVAL_MS=1500
HIBP_USE_MOCK=false
```

- `HIBP_API_KEY`: chave da API v3 da Have I Been Pwned.
- O valor com 32 zeros funciona para os emails de teste da própria HIBP.
- `HIBP_BASE_URL`: endpoint base da API HIBP.
- `HIBP_MIN_INTERVAL_MS`: intervalo mínimo entre consultas do worker.
- `HIBP_USE_MOCK`: opt-in explícito para o cliente mock em desenvolvimento.

A consulta HIBP roda via BullMQ com worker de concorrência 1 e intervalo mínimo entre chamadas para respeitar o rate-limit da API.

### Comandos para validar a integração HIBP

```powershell
npm run start
```

Em outro terminal, faça login para pegar o token e execute um scan de teste:

```powershell
curl -X POST "http://localhost:3000/api/v1/auth/login" ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"seu-email@dominio.com\",\"password\":\"sua-senha\"}"

curl -X POST "http://localhost:3000/api/v1/scan" ^
  -H "accept: application/json" ^
  -H "Authorization: Bearer <access_token do login>"
```

Verifique no log da API mensagens do worker, como:

```text
[HIBP Worker] job <id> completed
```

## 🧪 Testes

A aplicação segue a pirâmide de testes:

```
      E2E (Ponta a ponta)
    Integração (Rotas + BD)
  Unitários (Lógica pura)
```

Execute testes com:

```bash
npm test              # Unitários
npm run test:integration  # Integração
npm run test:e2e      # End-to-end
npm run test:cov      # Com cobertura
```

## 📋 Checklist de Setup

- [ ] Node.js 20+ instalado
- [ ] Dependências instaladas (`npm install`)
- [ ] Arquivo `.env` configurado
- [ ] Docker e Docker Compose instalados (optional)
- [ ] Banco de dados rodando
- [ ] Migrations aplicadas (`npx prisma migrate deploy`)
- [ ] Servidor iniciado com sucesso
- [ ] Swagger acessível em `/api/docs`

## 🤝 Contribuindo

Siga o [Manual de Git e GitHub](../docs/GITHUB_E_FLUXO_CONTRIBUICAO.md): branch a partir da `main`, Pull Request, revisão de outra pessoa do time e CI verde antes do merge.

## 📄 Licença

MIT - veja LICENSE para detalhes

## 📞 Suporte

Para questões sobre a arquitetura ou implementação, consulte:
- [Estrutura do Backend SafeID.pdf](../docs/Backend/Estrutura%20do%20Backend%20SafeID.pdf)
- [Plan do Projeto](../docs/Backend/plan.prompt.md)

---

**SafeID Backend** • Proteção de Identidade Segura
