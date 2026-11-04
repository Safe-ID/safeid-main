# Plano de resposta a incidentes de segurança com dados pessoais

> **Versão 1.0, aprovada pelo Product Owner em 04/11/2026.**
> Aplica-se a incidentes envolvendo os dados pessoais tratados pelo próprio SafeID. Complementa o [RIPD](RIPD.md) e segue o art. 48 da LGPD e a Resolução CD/ANPD nº 15/2024 (Regulamento de Comunicação de Incidente de Segurança).

## 1. O que é um incidente

Qualquer evento confirmado que afete a confidencialidade, a integridade ou a disponibilidade dos dados pessoais do SafeID. Exemplos:

- acesso não autorizado ao banco (RDS), ao Redis, aos backups ou aos logs do CloudWatch;
- exposição de um segredo do SSM (`ENCRYPTION_KEY`, `EMAIL_HASH_SECRET`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, chave da HIBP ou da IA);
- acesso indevido à conta AWS ou ao repositório do GitHub;
- falha que mostre dados de um usuário a outro;
- envio de e-mail com dados de um titular para o destinatário errado;
- perda de dados sem backup recuperável.

A indisponibilidade da HIBP ou da IA, sem efeito sobre dados pessoais, é falha operacional e segue o fluxo normal de alarmes.

## 2. Equipe e papéis

| Papel | Quem | Responsabilidade |
|---|---|---|
| Coordenação | Matheus Pereira Pereira | Conduz o incidente, registra decisões e prazos, faz as comunicações |
| Contenção técnica | Lucas Vieira de Souza | Isola a infraestrutura, revoga credenciais, preserva evidências |
| Análise de segurança e LGPD | Kelvyn Gabriel Milu de Oliveira | Avalia o escopo e o risco aos titulares e decide, com a coordenação, se há comunicação obrigatória |
| Comunicação na aplicação | João Antônio Chamusca Martins | Publica aviso no site e apoia o texto aos titulares |

Na ausência de alguém, o próximo da tabela assume o papel. Canal da equipe: grupo interno de mensagens; canal com titulares: safeidifsp@gmail.com.

## 3. Detecção

Fontes que podem revelar um incidente:

- alarmes do CloudWatch enviados por e-mail (SNS), como falha de e-mail, chave da HIBP inválida, rejeição e reclamação do SES, memória do Redis e espaço do RDS;
- alertas do GitHub (secret scanning, Dependabot, CodeQL);
- relato de titular pelo e-mail de contato ou de pesquisador pelo `/.well-known/security.txt` do site;
- comportamento anômalo nos logs (picos de 401 ou 429, acessos fora do padrão).

Quem perceber um possível incidente avisa a coordenação **imediatamente** e anota data e hora em UTC. O prazo legal conta a partir do momento em que a equipe sabe que o incidente **afetou dados pessoais**.

## 4. Resposta

### 4.1 Primeira hora: conter

1. Abrir o registro do incidente (modelo na seção 7).
2. Preservar evidências **antes** de mudar qualquer coisa: exportar os logs do CloudWatch do período e anotar a imagem em execução no ECS.
3. Conter conforme o caso:
   - **segredo exposto:** gerar novo valor no SSM e reimplantar a task. Trocar os segredos JWT encerra todas as sessões. Atenção: trocar `ENCRYPTION_KEY` torna ilegíveis os dados já cifrados, e trocar `EMAIL_HASH_SECRET` muda os hashes; avaliar antes de trocar essas duas;
   - **acesso indevido à AWS:** revogar as chaves de acesso do usuário IAM afetado e revisar o CloudTrail;
   - **falha na aplicação:** reverter para a imagem anterior no ECS (rollback descrito em [DEPLOY_PRODUCAO.md](../Backend/DEPLOY_PRODUCAO.md)) ou parar a task, se necessário;
   - **e-mail para o destinatário errado:** suspender a fila de e-mails e pedir ao destinatário a exclusão da mensagem.

### 4.2 Até 24 horas: avaliar

Responder, no registro:

- quais dados foram afetados e de quantos titulares;
- se os dados estavam cifrados (`breachData`) ou pseudonimizados (hash do e-mail) e se a chave também foi exposta;
- se o incidente pode causar **risco ou dano relevante** aos titulares (art. 48 da LGPD; critérios do art. 5º do Regulamento). No SafeID, indicam risco relevante, por exemplo: e-mail associado ao histórico de vazamentos, exposição de vazamento marcado como sensível, ou incidente em larga escala.

Se o risco não for relevante, a decisão e a justificativa ficam no registro (seção 6), sem comunicação obrigatória.

### 4.3 Comunicar

Quando houver risco ou dano relevante:

| Para quem | Prazo | Como |
|---|---|---|
| ANPD | 3 dias úteis do conhecimento (art. 6º do Regulamento) | Formulário de Comunicação de Incidente de Segurança (CIS) no site da ANPD |
| Complemento à ANPD | Até 20 dias úteis após a comunicação | Mesmo processo, com as informações que faltavam |
| Titulares afetados | 3 dias úteis (art. 9º do Regulamento) | E-mail individual pelo SES e aviso no painel; aviso público no site se não for possível falar com cada um |
| Declaração à ANPD de que os titulares foram avisados | 3 dias úteis após o fim do prazo anterior | No processo da CIS |

A equipe se declara agente de tratamento de pequeno porte (Resolução CD/ANPD nº 2/2022), o que conta em dobro os prazos de comunicação: 6 dias úteis para comunicar a ANPD e os titulares. A condição precisa constar, como declaração, em cada comunicação à ANPD. Sempre que possível, comunicar antes, dentro do prazo simples.

A comunicação deve trazer, em linguagem simples: o que aconteceu e quando; quais dados foram afetados; os riscos para o titular; o que a equipe já fez; o que o titular pode fazer (por exemplo, trocar a senha do SafeID e ficar atento a mensagens que citem seus vazamentos); e o contato safeidifsp@gmail.com.

### 4.4 Recuperar e aprender

1. Corrigir a causa e confirmar a correção em produção, com teste automatizado sempre que possível.
2. Restaurar dados pelo backup do RDS (retenção de 7 dias), se necessário.
3. Em até 10 dias úteis após o encerramento, reunir a equipe, registrar a causa raiz e as lições aprendidas e atualizar o [RIPD](RIPD.md) e este plano.

## 5. Contatos

| Contato | Uso |
|---|---|
| safeidifsp@gmail.com | Titulares e relatos externos |
| ANPD, Comunicação de Incidente de Segurança | https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis |
| Suporte AWS | Console da conta |
| Orientadores do projeto | Informar incidentes com comunicação obrigatória |

## 6. Registro

Todo incidente, comunicado ou não, fica registrado por **pelo menos 5 anos** (art. 10 do Regulamento), em issue privada ou arquivo restrito da equipe, nunca com dados pessoais dos titulares em claro.

## 7. Modelo de registro

```text
Incidente nº:
Detectado em (UTC):              Por:
Conhecimento de que afetou dados pessoais em (UTC):
Descrição:
Sistemas afetados:
Dados e número de titulares afetados:
Dados cifrados ou pseudonimizados? A chave foi exposta?
Risco ou dano relevante? (sim/não)  Justificativa:
Medidas de contenção (data e hora):
Comunicação à ANPD: (data, número do processo)  Complemento:
Comunicação aos titulares: (data, meio)  Declaração à ANPD:
Causa raiz:
Correções e lições aprendidas:
Encerrado em:
```

## 8. Vigência e testes do plano

O plano vale enquanto o SafeID estiver em produção. O projeto acadêmico se encerra em 13/11/2026; se o sistema continuar no ar depois disso, a equipe mantém este plano e, em uma eventual continuidade, deve simular um incidente por semestre, por exemplo, um segredo de teste exposto em um PR, percorrendo as etapas 4.1 a 4.4 sem comunicação real.

## Referências

- BRASIL. Lei nº 13.709, de 14 de agosto de 2018 (LGPD), arts. 46 a 49.
- AUTORIDADE NACIONAL DE PROTEÇÃO DE DADOS. Resolução CD/ANPD nº 15, de 24 de abril de 2024. Aprova o Regulamento de Comunicação de Incidente de Segurança.
- AUTORIDADE NACIONAL DE PROTEÇÃO DE DADOS. Resolução CD/ANPD nº 2, de 27 de janeiro de 2022. Regulamento de aplicação da LGPD para agentes de tratamento de pequeno porte.
