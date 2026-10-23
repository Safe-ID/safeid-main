# 🔌 Matriz de consumo da API pelo frontend

Referência do contrato entre o frontend (`client/`) e a API (`server/`): qual tela usa qual rota, o que cada rota recebe e devolve, e qual função do cliente faz a chamada. O frontend já consome a API real em todas as telas; não há mais dados simulados.

---

## 1) Como o cliente fala com a API

- **Cliente HTTP único:** `client/src/lib/api.js`, função `request()`.
- **Base URL:** `VITE_API_URL` (padrão `http://localhost:3000`).
- **Autenticação:** o `access_token` e o `refresh_token` ficam no `localStorage`; o token de acesso vai em `Authorization: Bearer <token>`.
- **Sessão vencida:** em 401, `request()` chama `refreshSession()` uma vez e repete a requisição. Se a renovação falhar, apaga os tokens e dispara `safeid:session-expired`, e o app volta ao login com "Sua sessão expirou".
- **Erros:** respostas de erro viram `ApiError` com `status` e `code`, por exemplo `EMAIL_NOT_VERIFIED`, `TOKEN_EXPIRED`, `TOKEN_INVALID` ou `REFRESH_INVALID`. A tela decide o que mostrar pelo código, não pelo texto.

---

## 2) Matriz por tela

| Tela / componente | Rotas | Funções do `api.js` |
|---|---|---|
| Cadastro (`Auth.jsx`) | `POST /api/v1/auth/signup`, `POST /api/v1/auth/resend-verification` | `signup`, `resendVerification` |
| Login (`Auth.jsx`) | `POST /api/v1/auth/login`, `GET /api/v1/auth/google` | `login` (Google é um redirecionamento) |
| Link de verificação (`Safe_ID.jsx`, `?verify_token=`) | `POST /api/v1/auth/verify-email` | `verifyEmail` |
| Abertura do app / painel (`Safe_ID.jsx`, `Dashboard.jsx`) | `GET /api/v1/auth/me` | `fetchMe` |
| Evolução do risco (`ScoreHistoryChart.jsx`) | `GET /api/v1/scan/history` | `fetchScanHistory` |
| Plano de ação e PDF (`AIPanel.jsx`, `PrintablePlan.jsx`) | dados de `auth/me` (`scanSnapshot`) | — |
| Excluir conta (`Dashboard.jsx`) | `DELETE /api/v1/auth/me` | `deleteAccount` |
| Sino (`NotificationBell.jsx`, `NotificationsPanel.jsx`) | `/api/v1/notifications/*` | `fetchUnreadCount`, `fetchNotifications`, `markNotificationRead`, `markAllNotificationsRead` |
| Alertas de vazamento (`MonitoringSettings.jsx`) | `GET /api/v1/monitoring/status`, `PATCH /api/v1/monitoring/preferences` | `fetchMonitoringStatus`, `updateMonitoringPreferences` |
| Aviso do descadastro (`Safe_ID.jsx`, `?monitoring=`) | redirecionamento de `GET /api/v1/monitoring/unsubscribe` | — |
| Renovação de sessão (automática) | `POST /api/v1/auth/refresh` | `refreshSession` |

---

## 3) Autenticação

| Endpoint | Método | Payload | Resposta |
|---|---|---|---|
| `/api/v1/auth/signup` | `POST` | `email`, `password` (mín. 8), `acceptTerms` (obrigatório `true`), `acceptMonitoring` (opcional, padrão `true`) | `{ requiresEmailVerification: true, email }`. **Não** devolve tokens nem roda o scan |
| `/api/v1/auth/verify-email` | `POST` | `token` (vem do link do e-mail, `?verify_token=` no frontend) | `access_token`, `refresh_token`, `user`; roda o scan inicial. 410 `TOKEN_EXPIRED` se já usado ou vencido |
| `/api/v1/auth/resend-verification` | `POST` | `email` | `202 { message }` genérica (não revela se o e-mail existe); 60 s entre envios e até 5 por dia |
| `/api/v1/auth/login` | `POST` | `email`, `password` | `access_token`, `refresh_token`, `user`. Conta não verificada: 403 `EMAIL_NOT_VERIFIED`, e um link novo é enviado (respeitando o limite) |
| `/api/v1/auth/refresh` | `POST` | `refresh_token` | `{ access_token, refresh_token }` (o refresh também é renovado). 401 `REFRESH_INVALID` se inválido, vencido, se for um token de acesso, ou se a conta não existir mais ou não estiver verificada |
| `/api/v1/auth/google` | `GET` | — | Redireciona para o Google; no fim, volta ao frontend com os tokens no hash da URL |
| `/api/v1/auth/me` | `GET` | Bearer | `{ id, email, emailVerified, monitoringEnabled, lastMonitoredAt, scanSnapshot, scanSnapshotUpdatedAt }` |
| `/api/v1/auth/me` | `DELETE` | Bearer | Apaga a conta e tudo ligado a ela (cascata) e limpa o cache |

- Token de acesso: 24 h (`JWT_EXPIRES_IN`). Refresh token: 7 dias (`REFRESH_TOKEN_EXPIRES_IN`), com `typ: "refresh"`, que não vale como token de acesso.
- Booleanos do corpo são estritos: `"false"` em texto é rejeitado em vez de virar `true`.
- Contas não verificadas são apagadas depois de `UNVERIFIED_ACCOUNT_TTL_DAYS` (padrão 7).

O `scanSnapshot` do `auth/me` traz o último resultado para o painel: `riskScore`, `classification`, `breachesFound`, `breachData` (lista de vazamentos), `recommendation`, `mitigationSteps`, `urgencyLevel`, `isVerified` e `processedAt`.

---

## 4) Scan

Todas exigem Bearer.

| Endpoint | Método | Resposta |
|---|---|---|
| `/api/v1/scan/history` | `GET` | Últimas 50 análises, da mais nova para a mais antiga: `[{ id, riskScore, classification, breachesFound, source, createdAt }]` |
| `/api/v1/scan/:jobId` | `GET` | Detalhe de uma análise do próprio usuário, com `breachData` descriptografado |

- **Não há rota para o usuário disparar um scan.** Ele roda sozinho no cadastro (verificação do e-mail ou primeiro login pelo Google), quando o monitoramento acha um vazamento novo e, se o do cadastro falhar, de novo a cada hora pela reconciliação. Sempre com o e-mail da conta. Com os alertas desligados, o resultado fica parado, e o painel avisa
- `classification`: `LOW`, `MODERATE`, `HIGH` ou `CRITICAL` (faixas 0–25, 26–50, 51–75, 76–100).
- `source` no histórico: `SIGNUP` (cadastro), `MANUAL` (o usuário pediu) ou `MONITORING` (recálculo após um vazamento novo). Uma consulta respondida pelo cache não gera análise nova.
- Limite: 5 scans a cada 15 min por IP.

---

## 5) Notificações (sino)

Todas exigem Bearer.

| Endpoint | Método | Uso | Resposta |
|---|---|---|---|
| `/api/v1/notifications?cursor=&limit=` | `GET` | Lista paginada por cursor (`limit` até 50) | `{ items: [{ id, type, title, body, breachNames, riskScoreBefore, riskScoreAfter, classification, readAt, createdAt }], nextCursor }` |
| `/api/v1/notifications/unread-count` | `GET` | Contador do sino | `{ count }` |
| `/api/v1/notifications/:id/read` | `PATCH` | Marca uma como lida | `204`; `404` se não for do usuário |
| `/api/v1/notifications/read-all` | `PATCH` | Marca todas como lidas | `204` |

O sino consulta o contador ao abrir o app e a cada 60 s com a aba visível. Quando o número sobe, dispara `safeid:notifications-updated` e o painel recarrega o `auth/me`, porque o score mudou.

---

## 6) Monitoramento e descadastro

| Endpoint | Método | Auth | Uso | Resposta |
|---|---|---|---|---|
| `/api/v1/monitoring/status` | `GET` | Bearer | Estado nas configurações do painel | `{ enabled, lastMonitoredAt, lastCatalogSyncAt }` |
| `/api/v1/monitoring/preferences` | `PATCH` | Bearer | Body `{ enabled }`; ao ligar, grava o consentimento e agenda uma checagem imediata | Mesmo formato do status |
| `/api/v1/monitoring/unsubscribe?token=` | `GET` | Token do e-mail | Link de descadastro do alerta | `302` para `/?monitoring=disabled` ou `/?monitoring=invalid` |
| `/api/v1/monitoring/unsubscribe?token=` | `POST` | Token do e-mail | Descadastro em 1 clique (RFC 8058), chamado pelo cliente de e-mail | `200` ou `400` `TOKEN_INVALID` |

O frontend mostra o aviso de `?monitoring=disabled|invalid` na página inicial e no painel.

---

## 7) Saúde e operação

| Endpoint | Auth | Uso |
|---|---|---|
| `GET /api/health` | — | `{ status, timestamp, database, redis }`; `503` se o banco ou o Redis falharem |
| `GET /api/health/jobs` | `X-Admin-Token` | Filas, agendamentos, heartbeats dos workers, plano HIBP e última sincronização do catálogo; `403` se `ADMIN_TOKEN` não estiver configurado. Não é usado pelo frontend |

---

## 8) Limites por IP

| Rota | Limite |
|---|---|
| Login | 5 por minuto |
| Cadastro, reenvio da verificação | 5 a cada 15 min |
| Confirmação do e-mail | 10 a cada 15 min |
| Refresh, descadastro | 20 a cada 15 min |
| Demais | 100 a cada 15 min |

Acima do limite, a API responde `429`.

---

## 9) Pendências conhecidas

- **Logout no servidor:** hoje o logout só apaga os tokens do navegador; um refresh token copiado vale até expirar (7 dias).
- **Resumo consolidado do painel:** o painel faz algumas chamadas ao abrir (`auth/me`, histórico, status do monitoramento e contador do sino). Um endpoint único é uma otimização possível, mas não necessária na escala atual.

---

**Atualizado em:** 17/10/2026
