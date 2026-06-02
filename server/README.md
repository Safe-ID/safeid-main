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

Com a NAT em funcionamento, as chamadas HTTPS para HIBP e Gemini continuam saindo normalmente a partir da API na subnet privada.

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
