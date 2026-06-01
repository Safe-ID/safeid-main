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
| Cadastro | `Auth.jsx` cria usuário fake no estado | `/api/v1/auth/signup` | `POST` | Body: `email`, `password` | `access_token`, `refresh_token`, `user` |
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

- Endpoint de refresh token, se a sessão precisar ser renovada sem novo login.
- Endpoint de logout, se houver revogação explícita no servidor.
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

## 8) Conclusão prática

Se a meta for fazer o frontend consumir a API atual sem mudar o backend, o caminho mínimo é:

- autenticação real;
- token persistido;
- scan real;
- histórico real;
- remover mocks visuais de dados;
- aceitar que o painel de IA deve passar a usar `recommendation` retornado por `auth/me`.
