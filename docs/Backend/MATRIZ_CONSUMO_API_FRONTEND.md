# 🔌 MATRIZ DE CONSUMO DA API PELO FRONTEND SAFEID

Este documento traduz o frontend atual em uma lista objetiva do que precisa ser consumido na API existente.

---

## 1) Resumo do que o frontend precisa

O frontend atual ainda usa muitos dados locais e estados simulados. Para funcionar com a API real, ele precisa de:

- Base URL configurável para a API.
- Login e cadastro reais.
- Persistência de sessão com `access_token`.
- Consulta do usuário autenticado com `GET /api/v1/auth/me`.
- Submissão de email para análise de vazamento.
- Histórico de scans do usuário.
- Detalhe de um scan por `jobId`.
- Tratamento de erro, loading e revalidação.
- Ajuste no painel de IA para ler `recommendation` vindo de `GET /api/v1/auth/me`.

---

## 2) Matriz por área do frontend

| Área / Tela | O que hoje é local | Endpoint necessário | Método | Payload / Headers | Estado que precisa vir da API |
|---|---|---|---|---|---|
| Login | `Auth.jsx` simula sucesso sem chamar backend | `/api/v1/auth/login` | `POST` | Body: `email`, `password` | `access_token`, `refresh_token`, `user` |
| Cadastro | `Auth.jsx` cria usuário fake no estado | `/api/v1/auth/signup` e `/api/v1/auth/verify-email` | `POST` | Body: `email`, `password`, `acceptTerms`, `acceptMonitoring` (seção 8) | `requiresEmailVerification`; os tokens só vêm no `verify-email` |
| Sessão inicial | `Safe_ID.jsx` mantém `user` só em memória | `/api/v1/auth/me` | `GET` | Header: `Authorization: Bearer <token>` | Usuário autenticado e snapshot do scan |
| Dashboard | `Dashboard.jsx` usa `BREACHES` e `score()` locais | `/api/v1/scan/history` e `/api/v1/scan/:jobId` | `GET` | Header: `Authorization: Bearer <token>` | Histórico real, status dos scans e detalhes |
| Nova análise | Não existe fluxo real de submit hoje | `/api/v1/scan` | `POST` | Body: `email`; Header: Bearer token | `jobId`, `riskScore`, `classification`, `breachesFound`, `recommendation`, `isVerified` |
| Status da API | Não está ligado ao frontend | `/api/health` | `GET` | Sem auth | `status`, `uptime`, dependências, etc. |
| IA do painel | `AIPanel.jsx` depende de IA externa | `GET /api/v1/auth/me` | `GET` | Header: `Authorization: Bearer <token>` | `scanSnapshot.recommendation` pronta para renderizar |

---

## 3) Contratos que o frontend deve respeitar

### Autenticação

O backend atual expõe:

- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`

O frontend precisa guardar o `access_token` e enviar em `Authorization: Bearer ...` nas rotas protegidas.

Observação importante: o backend valida senha mínima de 8 caracteres, enquanto o frontend hoje aceita 6.

### Scan

O backend expõe:

- `POST /api/v1/scan`
- `GET /api/v1/scan/history`
- `GET /api/v1/scan/:jobId`

Essas rotas exigem autenticação com JWT.

`GET /api/v1/scan/history` devolve as últimas 50 análises, da mais nova para a mais antiga: `[{ id, riskScore, classification, breachesFound, source, createdAt }]`. `source` diz a origem de cada uma: `SIGNUP` (cadastro), `MANUAL` (o usuário pediu) ou `MONITORING` (o monitoramento recalculou o score após um vazamento novo). Uma consulta respondida pelo cache não gera análise nova. O componente `ScoreHistoryChart.jsx` usa essa rota para o gráfico "Evolução do risco" na Visão Geral do painel.

### Health

- `GET /api/health` pode ser usado para mostrar disponibilidade da API ou para validação de infraestrutura.

---

## 4) O que precisa mudar no frontend

1. Trocar os mocks de `Auth.jsx` por chamadas reais à API.
2. Criar uma camada de cliente HTTP única, com base URL por ambiente.
3. Persistir o token após login e restaurar a sessão ao abrir a aplicação.
4. Fazer o dashboard buscar dados reais do scan em vez de usar `BREACHES` fixo.
5. Tratar loading, erro e vazio em login, cadastro e dashboard.
6. Ler a recomendação da IA a partir de `scanSnapshot.recommendation` no retorno de `auth/me`.
7. Ajustar as regras de validação do formulário para bater com o backend.

---

## 5) O que falta na API para cobrir o frontend inteiro

A API atual cobre o núcleo de autenticação e scan, e já pode alimentar o painel de IA via `auth/me`. Ainda pode faltar para o frontend ficar completo:

- Endpoint de logout, se houver revogação explícita no servidor. Hoje o logout só apaga os tokens do navegador; um refresh token copiado continua valendo até expirar (7 dias).

A renovação de sessão já existe: veja "Renovação de sessão" na seção 8.
- Possível endpoint de resumo consolidado para o dashboard, para evitar múltiplas chamadas.

---

## 6) Ordem recomendada de implementação

1. Implementar cliente HTTP e configuração de ambiente no frontend.
2. Integrar login e signup reais.
3. Persistir token e restaurar sessão com `/api/v1/auth/me`.
4. Substituir os dados estáticos do dashboard por chamadas de scan.
5. Adicionar estados de loading e erro em todas as telas.
6. Rever o painel de IA para consumir `recommendation` de `auth/me`.

---

## 7) Mapeamento rápido por arquivo atual

| Arquivo | Papel atual | O que deve passar a fazer |
|---|---|---|
| `client/src/Safe_ID.jsx` | Controla navegação e estado em memória | Inicializar sessão, validar token e orquestrar autenticação |
| `client/src/components/Auth.jsx` | Simula login/cadastro local | Consumir `signup` e `login` reais |
| `client/src/components/Dashboard.jsx` | Exibe dataset mockado | Consumir histórico e detalhes da API |
| `client/src/components/AIPanel.jsx` | Chama Anthropic direto | Ler `recommendation` do usuário autenticado |
| `client/src/components/safeidData.js` | Fornece dados estáticos | Virar apenas tema/constantes visuais, ou ser removido |

---

## 8) Monitoramento de vazamentos (contrato atual)

O cadastro por senha mudou: a conta só é ativada depois da confirmação do e-mail, e o usuário pode receber alertas quando o e-mail aparecer num vazamento novo. O cliente HTTP fica em `client/src/lib/api.js`.

### Cadastro com verificação de e-mail

| Endpoint | Método | Payload | Resposta |
|---|---|---|---|
| `/api/v1/auth/signup` | `POST` | `email`, `password` (mín. 8), `acceptTerms` (obrigatório `true`), `acceptMonitoring` (opcional, padrão `true`) | `{ requiresEmailVerification: true, email }`. **Não** devolve tokens nem roda o scan |
| `/api/v1/auth/verify-email` | `POST` | `token` (vem do link do e-mail, `?verify_token=` no frontend) | `access_token`, `refresh_token`, `user`; roda o scan inicial |
| `/api/v1/auth/resend-verification` | `POST` | `email` | `{ message }` genérica (não revela se o e-mail existe); limite de reenvio por cooldown e por dia |
| `/api/v1/auth/login` | `POST` | `email`, `password` | Conta não verificada responde 403 com `code: EMAIL_NOT_VERIFIED` e um link novo é enviado (respeitando o limite); o frontend oferece o reenvio |

Booleanos do corpo são estritos: `"false"` em texto é rejeitado em vez de virar `true`. Contas não verificadas são apagadas depois de `UNVERIFIED_ACCOUNT_TTL_DAYS` (padrão 7).

### Notificações (sino do Navbar)

Todas exigem `Authorization: Bearer <token>`.

| Endpoint | Método | Uso | Resposta |
|---|---|---|---|
| `/api/v1/notifications?cursor=&limit=` | `GET` | Lista paginada por cursor (`limit` até 50) | `{ items: [{ id, type, title, body, breachNames, riskScoreBefore, riskScoreAfter, classification, readAt, createdAt }], nextCursor }` |
| `/api/v1/notifications/unread-count` | `GET` | Contador do sino | `{ count }` |
| `/api/v1/notifications/:id/read` | `PATCH` | Marca uma como lida | `204`; `404` se não for do usuário |
| `/api/v1/notifications/read-all` | `PATCH` | Marca todas como lidas | `204` |

### Preferências de monitoramento

| Endpoint | Método | Auth | Uso | Resposta |
|---|---|---|---|---|
| `/api/v1/monitoring/status` | `GET` | Bearer | Estado nas configurações do painel | `{ enabled, lastMonitoredAt, lastCatalogSyncAt }` |
| `/api/v1/monitoring/preferences` | `PATCH` | Bearer | Body `{ enabled }`; ao ligar agenda uma checagem imediata | Mesmo formato do status |
| `/api/v1/monitoring/unsubscribe?token=` | `GET` | Token do e-mail | Link de opt-out do alerta | `302` para `/?monitoring=disabled` ou `/?monitoring=invalid` |
| `/api/v1/monitoring/unsubscribe?token=` | `POST` | Token do e-mail | One-click (RFC 8058), chamado pelo cliente de e-mail | `200` ou `400` com `code: TOKEN_INVALID` |

### Renovação de sessão

| Endpoint | Método | Payload | Resposta |
|---|---|---|---|
| `/api/v1/auth/refresh` | `POST` | `refresh_token` | `{ access_token, refresh_token }`. O refresh token também é renovado. 401 com `code: REFRESH_INVALID` se o token for inválido, estiver vencido, for um token de acesso, ou se a conta não existir mais ou não estiver verificada |

O token de acesso dura 24 h (`JWT_EXPIRES_IN`) e o refresh token, 7 dias (`REFRESH_TOKEN_EXPIRES_IN`). O refresh token leva `typ: "refresh"` e não vale como token de acesso. O limite é de 20 renovações a cada 15 min por IP.

No cliente, `request()` em `client/src/lib/api.js` trata isso sozinho: quando uma requisição com o token salvo recebe 401, ele chama `refreshSession()` uma vez (várias requisições ao mesmo tempo compartilham a mesma renovação) e repete a requisição. Se a renovação falhar, apaga os tokens e volta ao login com "Sua sessão expirou".

### Operação (não é consumido pelo frontend)

- `GET /api/health/jobs` com header `X-Admin-Token`: estado das filas, schedulers, heartbeats, plano HIBP e última sincronização do catálogo. Sem `ADMIN_TOKEN` configurado responde `403`.

### Funções do cliente (`client/src/lib/api.js`)

`signup(email, password, acceptTerms, acceptMonitoring)`, `refreshSession()`, `verifyEmail(token)`, `resendVerification(email)`, `fetchNotifications(cursor)`, `fetchUnreadCount()`, `markNotificationRead(id)`, `markAllNotificationsRead()`, `fetchMonitoringStatus()` e `updateMonitoringPreferences(enabled)`.

---

## 9) Conclusão prática

Se a meta for fazer o frontend consumir a API atual sem mudar o backend, o caminho mínimo é:

- autenticação real;
- token persistido;
- scan real;
- histórico real;
- remover mocks visuais de dados;
- aceitar que o painel de IA deve passar a usar `recommendation` retornado por `auth/me`.
