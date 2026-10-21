# Política de Privacidade do SafeID

Esta página explica quais dados o SafeID ([safeid.app.br](https://safeid.app.br)) coleta, para que eles são usados e como você pode controlá-los, de acordo com a Lei Geral de Proteção de Dados (LGPD).

## 1. Quem somos

O SafeID é um projeto acadêmico, desenvolvido como Trabalho de Conclusão de Curso do curso de Tecnologia em Análise e Desenvolvimento de Sistemas do IFSP São Paulo (2026). A equipe do projeto é responsável pelo tratamento dos dados descritos aqui.

## 2. Quais dados coletamos

- Seu email, usado para criar a conta e para consultar vazamentos.
- Sua senha, guardada apenas como hash (bcrypt). Nem a equipe consegue ver a senha original.
- O identificador da sua conta Google, se você entrar com o Google.
- Os resultados dos scans: nomes dos vazamentos, tipos de dado expostos, datas, score de risco e as recomendações geradas.
- A data em que você aceitou esta política.

## 3. Para que usamos

- Verificar se o seu email aparece em vazamentos de dados conhecidos.
- Calcular o score de risco e gerar o plano de ação.
- Manter sua conta e o histórico dos seus scans.

O tratamento se baseia no seu consentimento e na execução do serviço que você solicitou (LGPD, art. 7º, incisos I e V).

## 4. Com quem compartilhamos

- Have I Been Pwned: recebe o seu email para consultar em quais vazamentos ele aparece.
- Provedor de inteligência artificial (Azure AI Foundry): recebe apenas os nomes dos vazamentos e os tipos de dado expostos, para gerar as recomendações. O seu email nunca é enviado para a IA.
- Google: apenas se você escolher entrar com o Google.
- Provedores de hospedagem, que armazenam o sistema e o banco de dados.

Não vendemos nem compartilhamos seus dados para publicidade.

## 5. Por quanto tempo guardamos

Seus dados ficam guardados enquanto a sua conta existir. O resultado mais recente do scan também fica em cache por até 24 horas para agilizar novas consultas, e os dados temporários de processamento são apagados automaticamente.

Quando você exclui a conta, apagamos a conta e todo o histórico de scans.

## 6. Como protegemos

Usamos hash de senha, autenticação por token com prazo de validade, limite de tentativas de login e acesso restrito ao banco de dados. No histórico de scans, o email é guardado apenas como hash.

## 7. Seus direitos

- Confirmar se tratamos seus dados e acessar o que está guardado (o painel mostra o seu resultado e o histórico).
- Corrigir dados incompletos ou desatualizados.
- Excluir seus dados e revogar o consentimento a qualquer momento, pelo botão "Excluir conta" no painel.
- Saber com quem seus dados são compartilhados (seção 4).

Esses direitos estão no artigo 18 da LGPD (Lei nº 13.709/2018). Para qualquer outra solicitação, fale com a equipe pelas [issues do repositório no GitHub](https://github.com/Safe-ID/safeid-main/issues).

## 8. Alterações nesta política

Se esta política mudar, a nova versão será publicada nesta página. Última atualização: 30 de setembro de 2026.

> Este arquivo reproduz a política exibida no site, em [`client/src/components/Privacy.jsx`](client/src/components/Privacy.jsx). Ao alterar um, atualize o outro.
