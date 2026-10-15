Documentação de Infraestrutura AWS - Projeto SafeID

Este documento descreve detalhadamente a arquitetura de nuvem provisionada na Amazon Web Services (AWS) para suportar a aplicação SafeID. A infraestrutura foi desenhada com foco em alta disponibilidade, segurança rigorosa de rede (isolamento de dados) e escalabilidade por meio de computação serverless (sem servidor).

Neste documento, você encontrará não apenas a topologia do projeto, mas a explicação de cada componente e seu papel dentro do ecossistema.

1. Topologia de Rede (VPC e Roteamento)

A base de toda a arquitetura é a nossa rede virtual privada. Ela garante que os recursos conversem entre si de forma segura e que apenas o tráfego autorizado alcance a internet pública.

Amazon VPC (Virtual Private Cloud): É o componente fundacional da rede na AWS. Trata-se de um ambiente de rede logicamente isolado, como um data center virtual, onde definimos nossos próprios intervalos de IP (CIDR), criação de sub-redes e tabelas de rotas.

Subnets (Sub-redes) Públicas: São frações da nossa rede VPC configuradas em Zonas de Disponibilidade (AZs) distintas para garantir resiliência contra falhas físicas na AWS. Elas hospedam recursos que precisam receber tráfego direto da internet, pois possuem uma rota direta para o "mundo exterior".

Subnet (Sub-rede) Privada: Uma sub-rede totalmente isolada que abriga o "coração" do sistema: a lógica de negócios (Backend) e a persistência de dados (Banco de Dados e Cache). Os recursos aqui dentro não possuem IPs públicos e não podem ser acessados diretamente de fora.

Internet Gateway (IGW): É, metaforicamente, a "porta da frente" da nossa VPC. Ele é anexado à tabela de rotas pública e permite a comunicação bidirecional entre os recursos nas subnets públicas e a internet.

NAT Gateway (Network Address Translation): Serviço essencial para segurança. Fica alocado na subnet pública e possui um Elastic IP (IP fixo público). Sua função é agir como um "tradutor" e intermediário: ele permite que as máquinas na rede privada iniciem requisições para a internet (ex: baixar atualizações ou acessar a API da OpenAI), mas bloqueia qualquer conexão iniciada pela internet de chegar até elas.

2. Computação e Contêineres (Backend)

O backend em Node.js é executado de forma totalmente conteinerizada, garantindo que o código rode da mesma forma em qualquer ambiente. Utilizamos serviços orquestrados para não nos preocuparmos com a manutenção de sistemas operacionais.

Amazon ECR (Elastic Container Registry): É o repositório seguro e privado da AWS para imagens de contêiner (equivalente ao Docker Hub). Nosso pipeline de deploy constrói a imagem Docker localmente e realiza o envio (push) para o ECR.

Amazon ECS (Elastic Container Service): É o orquestrador de contêineres nativo da AWS. Ele gerencia o ciclo de vida dos nossos contêineres (ligar, desligar, reiniciar se falharem) de forma semelhante ao Kubernetes, mas com profunda integração aos demais serviços AWS.

AWS Fargate: É o "motor" de computação do ECS. Ao utilizar o modo Fargate, nossa arquitetura se torna Serverless (sem servidor). Não precisamos provisionar, atualizar ou gerenciar instâncias EC2 (máquinas virtuais). Nós apenas dizemos à AWS: "rode este contêiner com 512MB de RAM e 0.25 vCPU", e a AWS cuida da infraestrutura subjacente.

Task Definition (Definição de Tarefa): Funciona como a "receita" ou "molde" da nossa aplicação. É um arquivo de configuração JSON que diz ao ECS qual imagem do ECR usar, quais portas abrir, limites de recursos e injeta dinamicamente as variáveis de ambiente necessárias para o contêiner funcionar.

3. Balanceamento de Carga e Roteamento de Tráfego

Para lidar com alto volume de acessos e garantir que a aplicação nunca saia do ar caso um contêiner falhe, utilizamos um gerenciamento inteligente de tráfego.

Application Load Balancer (ALB): É um balanceador de carga que atua na Camada 7 (HTTP/HTTPS) do modelo OSI. Ele atua como nosso ponto único de entrada público. O ALB distribui inteligentemente o tráfego de entrada entre as várias instâncias do nosso contêiner Fargate.

Target Group (Grupo de Destino) e Health Checks: O Target Group é o agrupamento lógico dos nossos contêineres ECS na rede privada. O ALB fica constantemente enviando "ping"s (verificações de integridade - health checks) na rota /api/health dos contêineres. Se um contêiner não responder, o ALB para de mandar tráfego para ele até que se recupere.

AWS Certificate Manager (ACM) e Terminação SSL/TLS: O ACM é o serviço que gerencia nossos certificados de segurança gratuitamente. O certificado SSL fica atrelado ao ALB. Assim, a conexão entre o usuário e o balanceador é criptografada de ponta a ponta (HTTPS na porta 443). O tráfego na porta HTTP (80) é forçado a redirecionar (HTTP 301) para a rota segura.

DNS (Domain Name System): Nosso domínio customizado (api.safeid.app.br) está configurado por meio de um registro CNAME/Alias para apontar não para um IP fixo, mas para o endereço DNS dinâmico do nosso ALB.

4. Camada de Dados e Cache

A persistência de dados é crítica. Por isso, delegamos a manutenção, backups e atualizações de patch de segurança para os serviços gerenciados (Managed Services) da AWS.

Amazon RDS (Relational Database Service) c/ PostgreSQL: O RDS automatiza tarefas administrativas do banco de dados relacional (PostgreSQL). Ele é provisionado em um Subnet Group isolado nas subnets privadas. O banco opera em uma instância otimizada (db.t3.micro) com armazenamento SSD (gp2). Não há rota de internet para ele, impedindo ataques diretos externos. Os backups automáticos ficam guardados por 7 dias, com janela às 06h-07h UTC (03h-04h BRT), e um snapshot manual é feito antes de toda migration em produção (create-database.ps1 -Action Snapshot).

Amazon ElastiCache c/ Redis: O ElastiCache é um armazenamento de dados em memória totalmente gerenciado. Utilizamos o motor Redis para atuar como cache ultrarrápido, gerenciar sessões ativas dos usuários, guardar as filas do BullMQ e absorver picos de acesso, aliviando a carga no banco de dados primário (RDS). Fica, também, blindado na subnet privada. O cluster usa o parameter group safeid-redis-queues, com maxmemory-policy=noeviction, exigido pelo BullMQ: com a política padrão (volatile-lru), sob pressão de memória o Redis poderia apagar locks de jobs e travar ou duplicar execuções.

5. Segurança e Isolamento (Security Groups)

Nossa infraestrutura aplica o princípio do Menor Privilégio e utiliza uma "Corrente de Confiança" (Chain of Trust). Isso significa que as regras não são abertas por "IP", mas sim pela referência mútua de grupos de segurança.

Security Groups (SGs): São firewalls virtuais de rede com estado (stateful) que controlam o tráfego de entrada e saída.

SG do ALB: Permite tráfego de entrada da internet global HTTP e HTTPS (0.0.0.0/0).

SG do Backend (ECS Tasks): Rejeita conexões da internet. Só aceita receber requisições na porta 3000 vindas especificamente do Security Group do ALB.

SG do RDS (PostgreSQL): Rejeita a internet e a rede local de forma ampla. Só aceita tráfego na porta 5432 vindo especificamente do Security Group do Backend.

SG do Redis: Funciona sob a mesma lógica do banco de dados, aceitando tráfego na porta 6379 apenas originado pelo SG do Backend.

AWS IAM (Identity and Access Management) Roles: Sistema de gestão de identidades. Cada tarefa ECS usa duas funções separadas:

Execution Role (safeid-cluster-ecsTaskExecutionRole): o que o ECS precisa para subir o contêiner. Puxa a imagem do repositório (ECR), escreve logs no Amazon CloudWatch e lê os segredos do SSM (ssm:GetParameters restrito a /safeid/prod/* e kms:Decrypt só via SSM).

Task Role (safeid-task-role): o que o código da aplicação chama na AWS. Começa sem nenhuma permissão; o envio de e-mails pelo SES será a primeira a entrar.

Segredos no SSM Parameter Store: DATABASE_URL, JWT_SECRET, REFRESH_TOKEN_SECRET, SESSION_SECRET, HIBP_API_KEY e, quando existirem, AI_API_KEY, GOOGLE_CLIENT_SECRET, MONITORING_UNSUBSCRIBE_SECRET e ADMIN_TOKEN ficam como SecureString em /safeid/prod/<NOME> (tier standard, sem custo). A task definition só guarda a referência (bloco secrets); o ECS injeta os valores como variáveis de ambiente quando o contêiner sobe. Quem tem leitura no ECS não vê nenhum segredo.

6. Frontend e Distribuição de Conteúdo

O SafeID desacopla totalmente a interface de usuário (Frontend em React) da API (Backend). Isso barateia custos e melhora a velocidade de carregamento.

Amazon S3 (Simple Storage Service): Serviço de armazenamento de objetos altamente escalável e durável. Utilizamos um bucket S3 para armazenar os arquivos estáticos gerados pelo build do frontend (arquivos .html, .css, .js, imagens).

Amazon CloudFront: É a Content Delivery Network (CDN) global da AWS. O CloudFront faz o "cache" das páginas do S3 em centenas de data centers ao redor do mundo. Se um usuário no Brasil e outro no Japão acessarem o SafeID, a página será entregue instantaneamente pelo servidor físico mais próximo de cada um, além de garantir suporte nativo a HTTPS para a interface.

Segurança de Origem: Utilizamos um Origin Secret via cabeçalho injetado no CloudFront para que a requisição só seja aceita caso venha obrigatoriamente da nossa CDN, protegendo o acesso direto via S3 ou APIs abertas.

7. Integrações e Serviços Externos

O funcionamento vital da ferramenta de verificação do SafeID depende de consultar provedores terceiros de forma segura. Graças à nossa arquitetura com NAT Gateway, o backend isolado consegue disparar conexões seguras (outbound) para as seguintes integrações:

Azure AI Services: Nossa integração de inteligência artificial (Modelos da OpenAI via Microsoft Azure) para analisar cenários, validar dados e gerar insights em relatórios de segurança.

Have I Been Pwned (HIBP): Utilização da API global V3 do HIBP. O backend consome esses dados para verificar históricos reais de vazamentos de e-mails, credenciais e violações atreladas às buscas dos usuários, garantindo anonimato durante o envio e recebimento dos dados.
8. Cargas em Segundo Plano (Confiabilidade e Operação)

Até aqui a infraestrutura atendia só requisições disparadas pelo usuário: se algo falhava, o usuário via o erro. O monitoramento contínuo de vazamentos acrescenta trabalho autônomo (agendamentos, varreduras, filas de e-mail) que roda sem ninguém olhando. A capacidade atual (1 task Fargate de 0,5 vCPU / 1 GB, RDS db.t3.micro, ElastiCache cache.t3.micro) comporta essa carga com folga até alguns milhares de usuários. O que mudou foram ajustes de confiabilidade, para que uma falha em segundo plano não fique silenciosa:

Redis com noeviction: parameter group safeid-redis-queues (seção 4). O cache de scan já tem TTL e ocupa poucos KB, então deixar de ser despejado por LRU não é um problema; a memória do Redis entra nos alarmes.

Backups do RDS: 7 dias de retenção e snapshot manual antes de migrations (seção 4). O banco passa a guardar estado que não se recupera da HIBP (vazamentos já conhecidos, notificações, consentimento). Perder o banco faria todos os usuários serem notificados de novo, ou perderia um opt-out.

Shutdown gracioso: a aplicação chama enableShutdownHooks e, ao receber o SIGTERM do ECS, fecha o worker do BullMQ (espera o job em andamento terminar e não pega jobs novos), a fila e as conexões Redis. O contêiner tem stopTimeout de 120 s, tempo para terminar a chamada mais longa (IA). Os jobs interrompidos mesmo assim são recuperados pelo BullMQ como "stalled", por isso todo job novo deve ser idempotente.

Pool de conexões do Prisma: a DATABASE_URL de produção leva connection_limit=10&pool_timeout=20. Durante um deploy rodam 2 tasks, ou seja, até 20 conexões, bem abaixo do limite do db.t3.micro.

Logs estruturados e retenção: o código novo escreve uma linha JSON por evento ({ ts, level, ctx, event, ...campos }) pelo logger de server/src/shared/utils/logger.ts, que também oferece maskEmail para nunca registrar e-mail em texto. O log group /ecs/safeid-cluster guarda 30 dias (antes não havia expiração).

Alertas: o tópico SNS safeid-alerts envia e-mail para o endereço do projeto (ALERTS_EMAIL). Alarmes de infraestrutura: safeid-redis-memory (DatabaseMemoryUsagePercentage acima de 80% por 15 min) e safeid-rds-storage (FreeStorageSpace abaixo de 2 GB). Os alarmes da feature de monitoramento serão acrescentados ao mesmo script.

Health check: /api/health checa o banco e o Redis (PING com timeout). O ALB continua recebendo HTTP 200 se o banco estiver ok; se só o Redis falhar, a resposta indica status degraded sem derrubar a task.

Uma task só (DESIRED_COUNT=1): se a task cair, o ECS sobe outra em 1 a 2 minutos e os jobs retomam do Redis. Aceitável na escala atual.

Alternativas avaliadas e descartadas (por enquanto):

| Alternativa | Por que não agora | Quando reconsiderar |
|---|---|---|
| EventBridge Scheduler + Lambda para os agendamentos | Duplicaria o pipeline de deploy (imagem ECS + pacote Lambda) e o rate limit global da HIBP exigiria SQS com concorrência 1, recriando o que o BullMQ já faz. | Se a aplicação deixar de rodar 24x7 (ex.: API escalando para zero). |
| SQS no lugar do BullMQ | Sem prioridade nativa nem limiter global; trocaria uma dependência que já funciona. | Se o Redis virar gargalo ou fonte frequente de incidentes. |
| ElastiCache com réplica / Multi-AZ | Cerca de US$12/mês a mais por um ganho pequeno: o estado essencial fica no banco. | Se o SafeID passar a ter SLA formal. |
| Worker numa service ECS separada (mesma imagem, APP_ROLE=worker) | A carga é baixa e uma task basta. | Primeira evolução recomendada quando a varredura passar de ~1 h, a latência p95 da API subir durante varreduras ou o plano Core 3+ da HIBP for contratado. Custo: ~US$9/mês. |

9. Scripts de Provisionamento

Os scripts PowerShell ficam em server/ e são versionados. Nenhum valor de ambiente fica no código: IDs de VPC, subnets e security groups, senha do banco e e-mail de alertas vêm do server/.env (fora do git; os nomes estão na seção "Scripts AWS" do .env.example). O aws-common.ps1 reúne as funções compartilhadas.

| Script | Para que serve |
|---|---|
| create-nat-gateway.ps1 | NAT Gateway da subnet privada |
| create-bastion-ssm.ps1 / connect-bastion-ssm.ps1 | Bastion via SSM para acessar RDS e Redis |
| create-database.ps1 | RDS PostgreSQL. Ações: Create, Delete, EnableBackups, Snapshot |
| create-redis.ps1 | ElastiCache Redis. Ações: Create, Delete, ApplyParameterGroup |
| push-ecr-image.ps1 | Build e push da imagem para o ECR |
| put-ssm-secrets.ps1 | Envia os segredos de produção para o SSM. Aceita -EnvFile e -DryRun; recusa valores com localhost e nunca imprime valores |
| deploy-ecs-fargate.ps1 | Cluster, ALB, roles, task definition (com secrets do SSM) e service |
| create-alerts.ps1 | Tópico SNS e alarmes. Ações: Create, Test, Delete |

Ordem para aplicar os ajustes de confiabilidade num ambiente que já existe:

1. create-redis.ps1 -Action ApplyParameterGroup (conferir: CacheParameterGroup = safeid-redis-queues, in-sync)
2. create-database.ps1 -Action EnableBackups e depois -Action Snapshot
3. put-ssm-secrets.ps1 -DryRun, conferir a lista, e rodar sem -DryRun
4. deploy-ecs-fargate.ps1 (task role, secrets do SSM, stopTimeout, retenção de logs)
5. create-alerts.ps1, confirmar a assinatura pelo e-mail recebido e rodar create-alerts.ps1 -Action Test
