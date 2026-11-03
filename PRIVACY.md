# Política de Privacidade do SafeID

Versão publicada em [https://www.safeid.app.br/privacidade](https://www.safeid.app.br/privacidade).

Esta página explica quais dados o SafeID coleta, para que eles são usados, com quem são compartilhados e como você pode controlá-los, de acordo com a Lei Geral de Proteção de Dados (LGPD, Lei nº 13.709/2018).

## 1. Quem é o responsável

O SafeID é um projeto acadêmico, desenvolvido como Trabalho de Conclusão de Curso do curso de Tecnologia em Análise e Desenvolvimento de Sistemas do IFSP São Paulo (2026). Responsáveis pelo tratamento dos dados: João Antônio Chamusca Martins, Kelvyn Gabriel Milu de Oliveira, Lucas Vieira de Souza e Matheus Pereira Pereira.

Para falar sobre os seus dados ou exercer qualquer direito desta política, escreva para safeidifsp@gmail.com.

## 2. Quais dados coletamos

- Seu email, usado para criar a conta, consultar vazamentos e enviar os avisos do serviço.
- Sua senha, guardada apenas como hash (bcrypt). Nem a equipe consegue ver a senha original.
- O identificador da sua conta Google, se você entrar com o Google.
- Os resultados das análises: nomes dos vazamentos, tipos de dado expostos, datas, score de risco e as recomendações geradas.
- O monitoramento e os avisos: vazamentos já conhecidos da sua conta, notificações e a data da última verificação.
- Seus consentimentos: quando você aceitou estes textos, qual versão aceitou e quando ligou os alertas.
- Dados técnicos: o endereço IP, usado temporariamente para limitar tentativas de acesso, e registros de funcionamento do sistema, com o email mascarado.

## 3. Para que usamos

- Verificar se o seu email aparece em vazamentos conhecidos, calcular o score de risco e gerar o plano de ação (execução do serviço que você solicitou, art. 7º, V).
- Monitorar novos vazamentos e avisar você no painel e por email, se você ligar os alertas (consentimento, art. 7º, I). Dá para desligar quando quiser.
- Confirmar o seu email e manter a sua conta e o histórico das análises (execução do serviço).
- Proteger o serviço contra abuso e investigar falhas (legítimo interesse, art. 7º, IX).

O score e o plano de ação são gerados automaticamente e têm caráter informativo: não geram nenhuma decisão sobre você.

## 4. Com quem compartilhamos

- Have I Been Pwned: recebe o seu email para consultar em quais vazamentos ele aparece.
- Azure AI Foundry (Microsoft), provedor de inteligência artificial: recebe os nomes dos vazamentos e os tipos de dado expostos, para gerar as recomendações. O seu email nunca é enviado, e o nome de um vazamento sensível também não (seção 6).
- Amazon Web Services: hospeda o sistema e o banco de dados e envia os emails do serviço (Amazon SES).
- Google: apenas se você escolher entrar com o Google.

Não vendemos seus dados nem os usamos para publicidade. O plano de ação indica a ENETSEC, empresa parceira deste Trabalho de Conclusão de Curso. Não há contrato comercial entre o projeto e ela, e nenhum dado seu é enviado a ela: o contato só acontece se você clicar nos links.

## 5. Transferência internacional

Os dados ficam em servidores da Amazon Web Services nos Estados Unidos, e os serviços da seção 4 também podem processá-los fora do Brasil. Essa transferência é necessária para prestar o serviço que você solicitou e se baseia no seu consentimento ao aceitar esta política (LGPD, art. 33, VIII e IX).

## 6. Vazamentos sensíveis

Alguns vazamentos são marcados como sensíveis pelo Have I Been Pwned, porque o nome do serviço pode revelar algo íntimo sobre a pessoa. O nome deles aparece apenas no seu painel, depois do login: não vai para a inteligência artificial nem para os emails de alerta, que dizem apenas "serviço de natureza sensível".

## 7. Por quanto tempo guardamos

- Conta, análises e notificações: enquanto a conta existir. Ao excluir a conta, tudo isso é apagado na hora.
- Conta que não confirmou o email: apagada automaticamente depois de 7 dias.
- Resultado da análise em cache, para agilizar consultas: até 24 horas.
- Registros de funcionamento do sistema: 30 dias.
- Backups do banco de dados: até 7 dias. Depois de excluída a conta, os dados saem dos backups conforme eles expiram.

## 8. Como protegemos

Usamos conexão criptografada (HTTPS), hash de senha, criptografia dos dados de vazamento no banco (AES-256), autenticação por token com prazo de validade, limite de tentativas de acesso e acesso restrito ao banco de dados. No histórico das análises, o email é guardado apenas como hash. Nenhum sistema é totalmente imune a falhas: se ocorrer um incidente que possa causar risco ou dano relevante a você, avisaremos os titulares afetados e a ANPD.

## 9. Cookies

O SafeID não usa cookies de publicidade nem ferramentas de análise de navegação. Para manter você conectado, guardamos os tokens de sessão no armazenamento local do seu navegador, e eles são apagados quando você sai da conta.

## 10. Seus direitos

- Confirmar se tratamos seus dados e acessar o que está guardado: o painel mostra o resultado e o histórico.
- Corrigir dados incompletos ou desatualizados, e pedir uma cópia dos seus dados em formato estruturado (portabilidade), pelo contato da seção 1.
- Excluir seus dados a qualquer momento, pelo botão "Excluir conta" no painel.
- Revogar o consentimento dos alertas, no painel ou pelo link de cada email de alerta.
- Saber com quem seus dados são compartilhados (seção 4).
- Reclamar à Autoridade Nacional de Proteção de Dados (ANPD).

Esses direitos estão no artigo 18 da LGPD.

## 11. Crianças e adolescentes

O SafeID é destinado a maiores de 18 anos. Se soubermos de uma conta de menor de idade, ela será excluída.

## 12. Alterações nesta política

Se esta política mudar, a nova versão será publicada nesta página e, se a mudança for relevante, avisaremos você. Última atualização: 3 de novembro de 2026.
