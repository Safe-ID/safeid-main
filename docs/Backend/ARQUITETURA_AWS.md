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

Amazon RDS (Relational Database Service) c/ PostgreSQL: O RDS automatiza tarefas administrativas do banco de dados relacional (PostgreSQL). Ele é provisionado em um Subnet Group isolado nas subnets privadas. O banco opera em uma instância otimizada (db.t3.micro) com armazenamento SSD (gp2). Não há rota de internet para ele, impedindo ataques diretos externos.

Amazon ElastiCache c/ Redis: O ElastiCache é um armazenamento de dados em memória totalmente gerenciado. Utilizamos o motor Redis para atuar como cache ultrarrápido, gerenciar sessões ativas dos usuários e absorver picos de acesso, aliviando a carga no banco de dados primário (RDS). Fica, também, blindado na subnet privada.

5. Segurança e Isolamento (Security Groups)

Nossa infraestrutura aplica o princípio do Menor Privilégio e utiliza uma "Corrente de Confiança" (Chain of Trust). Isso significa que as regras não são abertas por "IP", mas sim pela referência mútua de grupos de segurança.

Security Groups (SGs): São firewalls virtuais de rede com estado (stateful) que controlam o tráfego de entrada e saída.

SG do ALB: Permite tráfego de entrada da internet global HTTP e HTTPS (0.0.0.0/0).

SG do Backend (ECS Tasks): Rejeita conexões da internet. Só aceita receber requisições na porta 3000 vindas especificamente do Security Group do ALB.

SG do RDS (PostgreSQL): Rejeita a internet e a rede local de forma ampla. Só aceita tráfego na porta 5432 vindo especificamente do Security Group do Backend.

SG do Redis: Funciona sob a mesma lógica do banco de dados, aceitando tráfego na porta 6379 apenas originado pelo SG do Backend.

AWS IAM (Identity and Access Management) Roles: Sistema de gestão de identidades. Nossas tarefas ECS assumem uma "Função de Execução" (Task Execution Role). Ela dá permissão limitada exclusivamente para o contêiner puxar a imagem do repositório (ECR) e escrever logs no console centralizado da AWS (Amazon CloudWatch). Nenhuma outra ação destrutiva na conta é permitida.

6. Frontend e Distribuição de Conteúdo

O SafeID desacopla totalmente a interface de usuário (Frontend em React) da API (Backend). Isso barateia custos e melhora a velocidade de carregamento.

Amazon S3 (Simple Storage Service): Serviço de armazenamento de objetos altamente escalável e durável. Utilizamos um bucket S3 para armazenar os arquivos estáticos gerados pelo build do frontend (arquivos .html, .css, .js, imagens).

Amazon CloudFront: É a Content Delivery Network (CDN) global da AWS. O CloudFront faz o "cache" das páginas do S3 em centenas de data centers ao redor do mundo. Se um usuário no Brasil e outro no Japão acessarem o SafeID, a página será entregue instantaneamente pelo servidor físico mais próximo de cada um, além de garantir suporte nativo a HTTPS para a interface.

Segurança de Origem: Utilizamos um Origin Secret via cabeçalho injetado no CloudFront para que a requisição só seja aceita caso venha obrigatoriamente da nossa CDN, protegendo o acesso direto via S3 ou APIs abertas.

7. Integrações e Serviços Externos

O funcionamento vital da ferramenta de verificação do SafeID depende de consultar provedores terceiros de forma segura. Graças à nossa arquitetura com NAT Gateway, o backend isolado consegue disparar conexões seguras (outbound) para as seguintes integrações:

Azure AI Services: Nossa integração de inteligência artificial (Modelos da OpenAI via Microsoft Azure) para analisar cenários, validar dados e gerar insights em relatórios de segurança.

Have I Been Pwned (HIBP): Utilização da API global V3 do HIBP. O backend consome esses dados para verificar históricos reais de vazamentos de e-mails, credenciais e violações atreladas às buscas dos usuários, garantindo anonimato durante o envio e recebimento dos dados.