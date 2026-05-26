# SafeID Backend

Backend API para o sistema **SafeID** - Proteção de Identidade Segura.

Desenvolvido com **Node.js + NestJS**, seguindo os padrões de **Clean Architecture** e atuais de backend profissional.

## 🏗️ Arquitetura

A estrutura segue a divisão clara entre camadas:

- **`src/@types`**: Tipos TypeScript globais
- **`src/api`**: Camada de apresentação (controllers, middlewares, routes)
- **`src/core`**: Camada de domínio (entities, repositories, use-cases)
- **`src/infra`**: Camada de infraestrutura (database, cache, http)
- **`src/shared`**: Recursos compartilhados (utils, crypto, schemas)
- **`tests`**: Testes unitários, integração e e2e

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

### 3. Subir infraestrutura (com Docker)

```bash
docker-compose up -d
```

### 4. Setup do banco de dados

```bash
# Criar migration inicial
npm run db:push

# (Opcional) Explorar o banco com Prisma Studio
npm run db:studio
```

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
- Login com sessão e refresh token
- Estratégia de autenticação local
- Proteção de rotas com guards

### Usuários (`usuarios`)
- CRUD de usuários
- Gestão de perfis (ADMIN, OPERADOR)
- Validações de CPF

### Instituições (`instituicoes`)
- Registro de instituições
- Gestão de responsáveis
- Validações de CNPJ

### Beneficiários (`beneficiarios`)
- Cadastro de beneficiários
- Relacionamento com responsáveis
- Dados de dependentes

### Atendimentos (`atendimentos`)
- Registro de atendimentos
- Classificação de urgência
- Histórico de consultas

### Serviços (`servicos`)
- Catálogo de serviços
- Associação com instituições
- Filtros e buscas

## 🔒 Segurança

- **Helmet**: Proteção de headers HTTP
- **Rate Limiting**: Limite de requisições por IP
- **Autenticação**: Sessão com refresh token
- **Validação**: Schema validation com class-validator
- **CORS**: Configurado para origem específica
- **HTTPS**: Suporta SSL/TLS em produção

## 📊 Observabilidade

- Logs estruturados em JSON
- Health checks para liveness e readiness
- Suporte para métricas de aplicação

## 📚 Documentação

### Endpoints principais

- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `POST /api/auth/refresh` - Renovar sessão

- `GET /api/usuarios` - Listar usuários
- `POST /api/usuarios` - Criar usuário

- `GET /api/instituicoes` - Listar instituições
- `POST /api/instituicoes` - Criar instituição

- `GET /api/health` - Status de saúde

Toda a documentação completa está disponível via Swagger em `/api/docs`

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

### Enviar imagem para o ECR

```powershell
.\push-ecr-image.ps1 -Action Create -AwsRegion sa-east-1 -RepositoryName safeid-backend -ImageTag latest
```

### Subir a aplicação no ECS Fargate com ALB

```powershell
.\deploy-ecs-fargate.ps1 -Action Create `
  -AwsRegion sa-east-1 `
  -ImageUri 123456789012.dkr.ecr.sa-east-1.amazonaws.com/safeid-backend:latest `
  -AcmCertificateArn arn:aws:acm:sa-east-1:123456789012:certificate/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx `
  -RdsEndpoint safeid-pg.xxxxx.sa-east-1.rds.amazonaws.com `
  -RedisHost safeid-redis.xxxxx.cache.amazonaws.com `
  -DatabaseSecurityGroupId sg-0b1fcbdc0dc851275 `
  -RedisSecurityGroupId sg-0c4a99817a8681e1b
```

O endpoint público fica no ALB com HTTPS. O certificado ACM precisa existir na mesma região do load balancer.

### Remover o stack para evitar cobrança

```powershell
.\deploy-ecs-fargate.ps1 -Action Delete -AwsRegion sa-east-1
.\push-ecr-image.ps1 -Action Delete -AwsRegion sa-east-1 -RepositoryName safeid-backend
```

O script de ECS cria e remove o cluster, o serviço, o ALB, o target group, o log group e as roles necessárias. Também libera o acesso do ECS para o RDS e para o Redis pelos security groups informados.

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

Em outro terminal, execute um scan de teste:

```powershell
curl -X POST "http://localhost:3000/api/v1/scan" ^
  -H "accept: application/json" ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"seu-email@dominio.com\"}"
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
- [ ] Migrations aplicadas
- [ ] Servidor iniciado com sucesso
- [ ] Swagger acessível em `/api/docs`

## 🤝 Contribuindo

1. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
2. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
3. Push para a branch (`git push origin feature/AmazingFeature`)
4. Abra um Pull Request

## 📄 Licença

MIT - veja LICENSE para detalhes

## 📞 Suporte

Para questões sobre a arquitetura ou implementação, consulte:
- [Estrutura do Backend SafeID.pdf](../docs/Backend/Estrutura%20do%20Backend%20SafeID.pdf)
- [Plan do Projeto](../docs/Backend/plan.prompt.md)

---

**SafeID Backend** • Proteção de Identidade Segura
