# 🚀 Deploy de produção na AWS

Como publicar o SafeID na AWS com os scripts PowerShell do repositório. Depois da preparação inicial, cada deploy é um comando só:

```powershell
.\deploy.ps1
```

A arquitetura (por que cada serviço existe) está em [ARQUITETURA_AWS.md](./ARQUITETURA_AWS.md). Aqui fica só o passo a passo.

---

## 1) O que você precisa

| Item | Para quê |
|---|---|
| AWS CLI v2 com login feito (`aws configure` ou `aws sso login`) | Todos os scripts |
| Docker Desktop aberto | Build da imagem do backend |
| Node.js 20 | Build do frontend |
| Acesso ao DNS do domínio (Registro.br) | Validar SES e certificados, apontar a API e o site |
| Plugin do Session Manager (opcional) | Túnel até o banco pelo bastion |

Os scripts foram testados no Windows PowerShell 5.1, o que já vem no Windows.

---

## 2) Onde fica cada configuração

| Arquivo | O que tem | No git? |
|---|---|---|
| `server/.env` | Desenvolvimento local | Não |
| `server/.env.production` | Produção: URLs, segredos, IDs da AWS | **Não** |
| `server/.env.production.example` | Modelo comentado do arquivo acima | Sim |
| `client/.env.production` | `VITE_API_URL`, bucket e distribuição do CloudFront | **Não** |
| `client/.env.production.example` | Modelo do arquivo acima | Sim |

Os scripts de deploy leem só os `.env.production`; o `.env` de desenvolvimento nunca vai para a produção. Os scripts versionados não têm nenhum ID, senha ou e-mail fixo.

Os segredos vão do `server/.env.production` para o SSM Parameter Store (SecureString) e o ECS os injeta na task. Eles não aparecem na task definition nem na saída dos scripts.

---

## 3) Preparação (uma vez)

Copie os modelos e preencha as URLs públicas e os segredos:

```powershell
Copy-Item server\.env.production.example server\.env.production
Copy-Item client\.env.production.example client\.env.production
```

Os comentários do modelo dizem como gerar cada segredo. A `ENCRYPTION_KEY` precisa ter exatamente 32 bytes (`openssl rand -base64 32`) e não pode mudar depois do primeiro deploy.

Depois, na ordem (cada script pode rodar de novo sem duplicar nada):

| # | Comando (na pasta `server/`, exceto o 8) | O que faz | Ação manual |
|---|---|---|---|
| 1 | `.\create-network.ps1` | VPC, subnets públicas e privadas, security groups do banco e do Redis; grava os IDs no `.env.production` | — |
| 2 | `.\create-nat-gateway.ps1` | Saída para a internet das subnets privadas (HIBP, IA, SES) | — |
| 3 | `.\create-database.ps1` | RDS PostgreSQL 16 privado, criptografado, com backup de 7 dias | — |
| 4 | `.\create-redis.ps1` | ElastiCache Redis com `noeviction` (exigência do BullMQ) | — |
| 5 | `.\create-ses.ps1` | Domínio de e-mail, DKIM, MAIL FROM | Cadastrar os registros impressos no DNS; conferir com `-Action Status`; pedir a saída do sandbox |
| 6 | `.\create-certificates.ps1` | Certificados HTTPS da API e do site | Cadastrar os CNAMEs impressos; esperar `ISSUED` em `-Action Status` |
| 7 | `.\create-bastion-ssm.ps1` (opcional) | Acesso ao banco pelo SSM, sem porta aberta | — |
| 8 | `..\client\provision-s3-cloudfront.ps1` | Bucket privado e CloudFront; grava os IDs no `client/.env.production` | CNAME do domínio do site para o CloudFront (o script imprime) |
| 9 | `..\deploy.ps1` | Primeiro deploy (cria o ALB) | CNAME do domínio da API para o DNS do ALB (o script imprime) |
| 10 | `.\create-alerts.ps1` | Alarmes no CloudWatch e e-mail de alertas | Confirmar a assinatura pelo e-mail; testar com `-Action Test` |

O Registro.br não aceita CNAME no domínio raiz. Use `www.` no `FRONTEND_URL` ou passe o DNS para o Route 53 (`ROUTE53_HOSTED_ZONE_ID`).

---

## 4) Cada deploy

```powershell
.\deploy.ps1 -DryRun   # opcional: confere tudo sem mudar nada
.\deploy.ps1
```

O que o `deploy.ps1` faz:

1. **Confere antes de mexer:**
   - ferramentas instaladas e login na AWS;
   - commit sem alterações pendentes;
   - URLs públicas, sem `localhost` nem valores de exemplo;
   - segredos e configuração do ECS.
2. **Segredos:** envia para o SSM (`put-ssm-secrets.ps1`).
3. **Imagem:** gera e envia ao ECR com a tag do commit (`push-ecr-image.ps1`). Se a tag já existe, pula o build.
4. **Backend:** registra uma task definition nova e atualiza o serviço ECS (`deploy-ecs-fargate.ps1`). As migrations rodam na subida do contêiner.
5. **Saúde:** espera a versão nova ficar saudável no ALB e confere `APP_URL/api/health`.
6. **Frontend:** build com o `VITE_API_URL` de produção, envio ao S3 e limpeza do cache do CloudFront (`deploy-s3-cloudfront.ps1`).

| Opção | Quando usar |
|---|---|
| `-Snapshot` | Antes de um deploy com migration nova: snapshot do banco antes de tudo |
| `-SkipFrontend` / `-SkipBackend` | Publicar só uma das partes |
| `-AllowDirty` | Publicar com alterações não commitadas (a tag ganha `-dirty-<data>`) |

### Se a versão nova não subir

O ECS só troca a task antiga depois que a nova passa no health check. Se a nova não ficar saudável, o circuit breaker volta sozinho para a versão anterior e o script termina com erro e o comando para ver os logs:

```powershell
aws logs tail /ecs/safeid-cluster --since 30m
```

### Voltar para uma versão anterior

O ECR guarda as 15 últimas imagens. Para republicar uma delas:

```powershell
.\server\deploy-ecs-fargate.ps1 -ImageTag <hash-do-commit>
```

---

## 5) O que os scripts recusam

Os scripts param antes de criar ou mudar recursos quando a configuração está errada:

- **URLs:** `APP_URL`, `FRONTEND_URL`, `CORS_ORIGIN` e `GOOGLE_CALLBACK_URL` com `localhost` ou valor de exemplo. Elas entram nos links dos e-mails e no CORS.
- **Endereços locais:** `REDIS_HOST` ou qualquer segredo apontando para a máquina local.
- **Segredos obrigatórios:** vazios, com valor de exemplo ou curtos (menos de 32 caracteres).
- **Pares de segredos:** `JWT_SECRET` igual ao `REFRESH_TOKEN_SECRET`.
- **`ENCRYPTION_KEY`:** sem exatamente 32 bytes. Uma chave errada faria todo scan falhar.
- **Frontend:** `VITE_API_URL` sem `https://`. O navegador bloquearia as chamadas.
- **Imagem:** inexistente no ECR.
- **Ações destrutivas** (`-Action Delete`): pedem para digitar o nome do recurso. O banco ganha um snapshot final, a menos que venha `-SkipFinalSnapshot`.

---

## 6) Problemas comuns

| Mensagem | O que fazer |
|---|---|
| `Sem credenciais AWS válidas` | `aws configure` ou `aws sso login` |
| `Arquivo de ambiente não encontrado` | Copie o `.env.production.example` (seção 3) |
| `O Docker não está rodando` | Abra o Docker Desktop |
| `Há alterações não commitadas` | Faça o commit ou use `-AllowDirty` |
| `Não achei as subnets de BACKEND_SUBNET_IDS` | IDs de outra conta ou região; rode o `create-network.ps1` |
| `A versão nova não ficou saudável` | Veja os logs (comando acima); costuma ser segredo errado ou banco inacessível |
| `/api/health não respondeu 200` | O ALB já está saudável; falta o DNS da API apontar para o ALB |

---

## 7) Custos e desligamento

O NAT Gateway (cerca de US$ 32/mês) e o ALB cobram por hora, mesmo sem uso. Para desligar o ambiente, rode os `Delete` na ordem inversa:

1. `deploy-ecs-fargate.ps1 -Action Delete`;
2. `create-alerts.ps1 -Action Delete`;
3. `create-redis.ps1 -Action Delete`;
4. `create-database.ps1 -Action Delete`, que cria um snapshot final;
5. `create-bastion-ssm.ps1 -Action Delete`;
6. `create-nat-gateway.ps1 -Action Delete`;
7. `create-network.ps1 -Action Delete`.

O SES, os certificados e o bucket do frontend não cobram parados.

---

**Atualizado em:** 17/10/2026
