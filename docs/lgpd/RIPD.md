# Relatório de Impacto à Proteção de Dados Pessoais (RIPD) do SafeID

> **Versão 1.0, aprovada pelo Product Owner em 04/11/2026.**
> Documento preparado pela equipe do projeto com base no código, na infraestrutura e na [Política de Privacidade](../../PRIVACY.md) vigentes em 04/11/2026 (commit `5d53dd4` da `main`). Não substitui avaliação jurídica especializada.

## 1. Identificação

| Item | Descrição |
|---|---|
| Sistema | SafeID, plataforma web de diagnóstico de exposição de dados pessoais (https://www.safeid.app.br) |
| Natureza | Projeto acadêmico de extensão do curso de Tecnologia em Análise e Desenvolvimento de Sistemas do IFSP — Campus São Paulo, em parceria com a Enetsec |
| Controladores | João Antônio Chamusca Martins, Kelvyn Gabriel Milu de Oliveira, Lucas Vieira de Souza e Matheus Pereira Pereira (Política de Privacidade, seção 1) |
| Contato para titulares | safeidifsp@gmail.com |
| Operadores | Amazon Web Services (hospedagem, banco, cache, e-mail), Have I Been Pwned (consulta de vazamentos), Microsoft Azure AI Foundry (geração do plano de ação), Google (login opcional) |
| Base normativa | LGPD, arts. 5º, XVII, 10, § 3º, e 38 |

### 1.1 Por que elaborar o RIPD

O SafeID não trata dados sensíveis no sentido do art. 5º, II, da LGPD e não toma decisões automatizadas sobre o titular: o score e o plano de ação são informativos (Política, seção 3). Mesmo assim, o tratamento tem três características que justificam a avaliação:

1. o sistema lida com o histórico de vazamentos de cada titular, informação que, se exposta, facilitaria golpes direcionados contra pessoas já vulneráveis;
2. o nome de um vazamento pode revelar algo íntimo (por exemplo, a inscrição em um serviço de relacionamento), e o HIBP marca esses casos como sensíveis;
3. há transferência internacional para os Estados Unidos e uso de inteligência artificial de terceiros.

## 2. Descrição do tratamento

### 2.1 Fluxo

1. **Cadastro.** O titular informa e-mail e senha (ou entra com o Google) e aceita os Termos de Uso e a Política, declarando ter 18 anos ou mais.
2. **Verificação.** O sistema envia um link de uso único, válido por 24 horas. Contas não verificadas em 7 dias são apagadas.
3. **Consulta.** Com o e-mail verificado, um job da fila consulta a API do HIBP com o e-mail da conta. Não existe rota para consultar outro e-mail.
4. **Diagnóstico.** O Motor de Risco calcula o score a partir dos tipos de dado expostos e da data de cada vazamento.
5. **Plano de ação.** O modelo de linguagem recebe nome, data e classes de dados dos vazamentos, o score e a classificação, sem o e-mail do titular e sem o nome de vazamentos sensíveis.
6. **Monitoramento (opcional, por consentimento).** Jobs periódicos verificam vazamentos novos e avisam no painel e por e-mail.
7. **Encerramento.** O titular pode baixar seus dados, revogar o monitoramento ou excluir a conta a qualquer momento.

### 2.2 Inventário de dados

| Dado | Onde fica | Finalidade | Base legal (Política, seção 3) | Retenção |
|---|---|---|---|---|
| E-mail | Tabela `User`, em texto claro | Conta, consulta ao HIBP e avisos | Execução do serviço (art. 7º, V) | Enquanto a conta existir |
| Hash do e-mail (HMAC-SHA256) | `ScanHistory` e chaves do Redis | Associar análises e cache sem expor o e-mail | Execução do serviço | Com a conta; cache até 24 h |
| Hash da senha (bcrypt, custo 10) | `User` | Autenticação | Execução do serviço | Enquanto a conta existir |
| Identificador Google | `User` | Login com Google | Execução do serviço | Enquanto a conta existir |
| Resultado das análises (vazamentos, classes, datas, score, plano) | `ScanHistory`, com `breachData` cifrado (AES-256-GCM) | Diagnóstico e histórico | Execução do serviço | Enquanto a conta existir |
| Vazamentos conhecidos e notificações | `UserBreach` e `Notification` | Monitoramento sem alertas repetidos | Consentimento (art. 7º, I) | Enquanto a conta existir |
| Datas e versão dos aceites e do consentimento | `User` (`termsAcceptedAt`, `termsVersion`, `monitoringConsentAt`) | Prestação de contas | Cumprimento de obrigação (art. 6º, X) | Enquanto a conta existir |
| Tokens de verificação e de nova senha | Tabelas próprias, só o hash SHA-256 | Confirmar o e-mail e redefinir a senha | Execução do serviço | 24 h e 60 min de validade; apagados com a conta |
| Endereço IP | Memória e Redis do limitador | Limitar tentativas de acesso | Legítimo interesse (art. 7º, IX) | Janela do limite (até 15 min) |
| Registros técnicos | CloudWatch Logs | Operação e investigação de falhas | Legítimo interesse | 30 dias |
| Backups do banco | Amazon RDS | Recuperação de desastres | Legítimo interesse | 1 dia |

O SafeID **não** recebe nem guarda as senhas vazadas: o HIBP informa apenas que a classe `Passwords` foi exposta.

### 2.3 Titulares

Cidadãos brasileiros, maiores de 18 anos, usuários de serviços digitais, em geral sem formação técnica em segurança. O tratamento é de pequena escala na fase acadêmica.

### 2.4 Compartilhamento e transferência internacional

| Destinatário | O que recebe | Onde |
|---|---|---|
| Have I Been Pwned | O e-mail da conta, para a consulta | Fora do Brasil |
| Microsoft Azure AI Foundry | Metadados dos vazamentos, score e classificação; nunca o e-mail nem o nome de vazamento sensível | Fora do Brasil |
| Amazon Web Services | Todos os dados do sistema (hospedagem, banco, cache, e-mail) | Estados Unidos (`us-east-2`) |
| Google | Dados do login, só para quem escolhe entrar com o Google | Fora do Brasil |

A transferência é necessária para o serviço e se apoia no consentimento dado ao aceitar a Política (art. 33, VIII e IX). Nenhum dado é enviado à Enetsec.

## 3. Necessidade e proporcionalidade

- **Necessidade:** só o e-mail da própria conta é consultado. A exigência de conta verificada impede consultar e-mails de terceiros e enumerar endereços.
- **Minimização na IA:** o modelo recebe apenas os metadados necessários para o plano; a ausência do e-mail no payload é verificada em teste unitário.
- **Finalidade:** sem publicidade, sem venda de dados, sem perfil de navegação e sem cookies de rastreamento (Política, seção 9).
- **Transparência:** o score é explicável (pesos e fórmula publicados no trabalho escrito) e o plano está em linguagem simples.
- **Direitos do titular (art. 18):** acesso no painel; portabilidade pelo botão "Baixar meus dados" (JSON); eliminação pelo botão "Excluir conta", com exclusão em cascata e limpeza do cache; revogação do monitoramento nas preferências ou pelo link de cada e-mail.

## 4. Identificação e avaliação de riscos

Escala: probabilidade (P) e impacto (I) de 1 a 5; nível = P × I. A probabilidade considera os controles já existentes.

| ID | Risco ao titular | P | I | Nível | Controles existentes |
|---|---|---|---|---|---|
| R1 | Vazamento do banco do próprio SafeID, expondo e-mails e o histórico de vazamentos de cada titular | 2 | 5 | 10 | Banco em sub-rede privada, acesso só pelo contêiner; `breachData` cifrado com AES-256-GCM; e-mail pseudonimizado no histórico; criptografia em repouso no RDS |
| R2 | Comprometimento das chaves (`ENCRYPTION_KEY`, `EMAIL_HASH_SECRET`, segredos JWT) | 2 | 5 | 10 | Segredos no SSM Parameter Store, injetados no contêiner, fora do repositório; secret scanning e push protection no GitHub; IAM com menor privilégio |
| R3 | Acesso de um usuário aos dados de outro | 1 | 4 | 4 | Todas as rotas de dados exigem JWT e filtram por `userId`; 11 de 11 testes de autorização aprovados no pentest de 03/11/2026 |
| R4 | Tomada de conta por força bruta ou senha vazada | 2 | 4 | 8 | bcrypt; login limitado a 5 tentativas por minuto por IP, com o IP do ALB (correção S07); troca de senha encerra as outras sessões |
| R5 | Uso do SafeID para descobrir vazamentos de outra pessoa | 1 | 4 | 4 | Sem consulta pública; verificação de titularidade do e-mail; respostas iguais no reenvio de verificação e na recuperação de senha |
| R6 | Exposição de vazamento sensível a terceiros (IA, caixa de e-mail compartilhada) | 2 | 4 | 8 | Nome de vazamento sensível não vai para a IA nem para o e-mail de alerta, só para o painel após login |
| R7 | Tratamento pelo provedor de IA além da finalidade | 2 | 3 | 6 | Nenhum identificador pessoal no payload; cache de recomendações de 7 dias reduz chamadas |
| R8 | E-mail do titular em registros técnicos | 2 | 2 | 4 | Logs com `userId` e e-mail mascarado (8 caracteres do SHA-256); retenção de 30 dias; acesso restrito à conta AWS da equipe |
| R9 | Chave de hash ausente em produção, tornando o hash do e-mail reversível por dicionário | 1 | 3 | 3 | Chave definida no arquivo de ambiente de produção e enviada ao SSM pelo script de implantação (confirmado em 05/11/2026); aviso no log quando a variável falta |
| R10 | Menores de idade usando o serviço | 2 | 3 | 6 | Declaração de idade no cadastro; exclusão da conta ao saber de menor (Política, seção 11) |
| R11 | Dados mantidos após a exclusão da conta | 2 | 2 | 4 | Exclusão física em cascata e limpeza do cache; backups expiram em 1 dia |
| R12 | Cache Redis sem TLS nem criptografia em repouso | 2 | 2 | 4 | Rede privada; chaves do cache usam o hash do e-mail (achado S06 do pentest, aceito) |

## 5. Medidas adicionais

O projeto se encerra com a apresentação final, em 13/11/2026. Por isso, as medidas abaixo estão divididas entre as que têm prazo até essa data e as que ficam como recomendação, com o risco correspondente aceito.

### 5.1 Até a apresentação final

| Medida | Riscos | Responsável | Prazo | Situação |
|---|---|---|---|---|
| Publicar o [plano de resposta a incidentes](PLANO_RESPOSTA_INCIDENTES.md) | R1, R2 | Matheus Pereira | 04/11/2026 | Concluído |
| Confirmar a presença de `EMAIL_HASH_SECRET` em produção | R9 | Lucas Vieira | 12/11/2026 | Concluído em 05/11/2026 |
| Conferir os termos de tratamento de dados dos operadores (AWS, Microsoft e HIBP) e registrar a região de processamento da IA | R7 | Matheus Pereira | 12/11/2026 | Pendente |

### 5.2 Recomendações para uma eventual continuidade

Sem responsável nem prazo. Enquanto não forem feitas, o risco correspondente fica aceito, no nível da seção 4.

| Medida | Riscos |
|---|---|
| Tornar `EMAIL_HASH_SECRET` obrigatória no script de implantação | R9 |
| Trocar o `maskEmail` (SHA-256 sem chave) por HMAC truncado nos logs | R8 |
| Rotação periódica dos segredos JWT, com procedimento documentado | R2, R4 |
| Redis com TLS e criptografia em repouso | R12 |
| Responder 404 para a análise de outro usuário, hoje 200 com corpo vazio (S04) | R3 |
| Revisar este RIPD a cada mudança relevante de tratamento | Todos |

## 6. Risco residual

Com os controles da seção 4, os riscos mais altos (R1 e R2, nível 10) decorrem do impacto, e não da probabilidade: um vazamento do próprio SafeID atingiria justamente pessoas já expostas. Por isso, o plano de resposta a incidentes é a principal medida pendente. Os demais riscos têm nível igual ou inferior a 9 e medidas definidas. A equipe considera o risco residual **aceitável para a fase acadêmica**, condicionado à conclusão das medidas da seção 5.1 até 12/11/2026.

## 7. Aprovação

| Integrante | Papel | Data | Aprovação |
|---|---|---|---|
| Matheus Pereira Pereira | Product Owner | 04/11/2026 | Aprovado |
| Kelvyn Gabriel Milu de Oliveira | Segurança e LGPD | | |
| Lucas Vieira de Souza | Back-end e infraestrutura | | |
| João Antônio Chamusca Martins | Front-end | | |

## Referências

- BRASIL. Lei nº 13.709, de 14 de agosto de 2018 (LGPD), arts. 5º, 6º, 7º, 18, 33, 38 e 48.
- Política de Privacidade do SafeID ([PRIVACY.md](../../PRIVACY.md)) e Termos de Uso ([TERMS.md](../../TERMS.md)).
- Relatório de pentest de 03/11/2026 ([docs/testes](../testes/README.md)).
