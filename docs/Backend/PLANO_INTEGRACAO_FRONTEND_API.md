# 🧭 PLANO DE INTEGRAÇÃO FRONTEND ↔ API SAFEID

Este plano organiza a implementação do consumo da API atual pelo frontend em fases curtas e verificáveis.

---

## Objetivo

Sair do fluxo mockado do frontend e chegar a uma interface que:

- autentica usuários de verdade;
- persiste sessão com JWT;
- consulta o usuário autenticado;
- consome scans e histórico reais;
- trata loading, erro e vazio corretamente;
- usa a recomendação de IA já retornada pela API no `auth/me`.

---

## Fase 1: Base de integração

### Entregas

- Criar cliente HTTP único no frontend.
- Configurar `VITE_API_URL` por ambiente.
- Definir estratégia de armazenamento do token.

### Critério de aceite

- O frontend consegue apontar para localhost, homologação e produção sem alterar código.
- Todas as chamadas passam por uma única abstração.

---

## Fase 2: Autenticação real

### Entregas

- Trocar login fake por `POST /api/v1/auth/login`.
- Trocar cadastro fake por `POST /api/v1/auth/signup`.
- Salvar `access_token` após sucesso.
- Restaurar sessão com `GET /api/v1/auth/me` ao carregar a aplicação.

### Critério de aceite

- Usuário loga, recarrega a página e continua autenticado.
- Erros de credencial inválida aparecem na interface.
- Validação de senha bate com a regra do backend.

---

## Fase 3: Dashboard com dados reais

### Entregas

- Substituir `BREACHES` estático por dados vindos da API.
- Consumir `GET /api/v1/scan/history`.
- Consumir `GET /api/v1/scan/:jobId` para detalhe.
- Recalcular os indicadores da tela a partir da resposta real.

### Critério de aceite

- O dashboard mostra dados do usuário autenticado.
- A lista de vazamentos não depende mais de mock local.
- O estado vazio é tratado quando não houver histórico.

---

## Fase 4: Nova análise de scan

### Entregas

- Conectar o formulário de análise a `POST /api/v1/scan`.
- Exibir `jobId`, `riskScore`, `classification` e `recommendation`.
- Recarregar o histórico após uma nova análise.

### Critério de aceite

- O usuário consegue disparar uma nova análise sem sair da aplicação.
- O resultado novo aparece no histórico e no resumo.

---

## Fase 5: IA e observabilidade

### Entregas

- Ler `scanSnapshot.recommendation` do retorno de `GET /api/v1/auth/me`.
- Exibir a recomendação da IA no painel sem chamada externa no browser.
- Consumir `GET /api/health` para exibir status técnico, se útil.

### Critério de aceite

- Nenhuma chave sensível fica exposta no cliente.
- O painel de IA mostra a recomendação já entregue pela API.

---

## Dependências e riscos

- O backend atual não expõe endpoint de refresh token.
- O backend atual não expõe endpoint de logout.
- O painel de IA hoje precisa ler a recomendação entregue no `auth/me`.
- O frontend aceita senha com 6 caracteres, mas o backend exige 8.

---

## Ordem recomendada de implementação

1. Cliente HTTP e configuração de ambiente.
2. Login, cadastro e persistência de token.
3. Restauração de sessão com `/me`.
4. Dashboard com dados reais.
5. Nova análise de scan.
6. Ajuste do painel de IA e observabilidade.

---

## Resultado esperado

Ao final deste plano, o frontend deixa de ser um mock visual e passa a operar sobre o contrato real da API atual, com sessões autenticadas e telas orientadas a dados.
