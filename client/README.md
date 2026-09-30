# SafeID Frontend

Interface web do **SafeID**, feita com **React 19 + Vite + Tailwind CSS**.

O usuário cria a conta (com email e senha ou com Google), e o painel mostra o score de risco, os vazamentos em que o email dele apareceu e o plano de ação gerado pela IA. Todos os dados vêm da API do backend (`server/`).

## 🚀 Como rodar

### Pré-requisitos

- Node.js 20+
- Backend rodando (veja o [README do backend](../server/README.md))

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar a URL da API

```bash
cp .env.example .env
```

No `.env`, aponte para o backend:

```env
VITE_API_URL=http://localhost:3000
```

Sem essa variável, o front usa `http://localhost:3000`.

### 3. Iniciar em desenvolvimento

```bash
npm run dev
```

O front abre em **http://localhost:3001** (a porta é fixa no `vite.config.js`).

No backend, o `CORS_ORIGIN` precisa ser `http://localhost:3001`, senão o navegador bloqueia as chamadas para a API.

## 📝 Scripts

- `npm run dev`: servidor de desenvolvimento com hot reload
- `npm run build`: build de produção em `dist/`
- `npm run preview`: serve o build localmente na porta 3001
- `npm run lint`: verifica o código com ESLint

## 🗂️ Estrutura

```
src/
├── main.jsx              # Ponto de entrada
├── Safe_ID.jsx           # Componente raiz: sessão, navegação entre páginas e rodapé
├── lib/
│   └── api.js            # Chamadas à API e tokens salvos no localStorage
└── components/
    ├── Landing.jsx       # Página inicial
    ├── Auth.jsx          # Login e cadastro (email/senha e Google)
    ├── Navbar.jsx        # Barra superior
    ├── Dashboard.jsx     # Painel com as abas Visão Geral, Vazamentos e Plano IA
    ├── RiskCircle.jsx    # Gráfico do score de risco
    ├── BreachCard.jsx    # Card de cada vazamento
    ├── AIPanel.jsx       # Plano de ação gerado pela IA
    └── safeidData.js     # Pesos, cores e tradução dos tipos de dado
```

## 🔌 Rotas da API usadas

| Tela | Rota |
|---|---|
| Cadastro | `POST /api/v1/auth/signup` |
| Login | `POST /api/v1/auth/login` |
| Login com Google | `GET /api/v1/auth/google` (o backend devolve o token no hash da URL) |
| Painel | `GET /api/v1/auth/me` |
| Excluir conta | `DELETE /api/v1/auth/me` |

O token de acesso é enviado no header `Authorization: Bearer <token>`.

## 🎨 Estilo

As cores do tema ficam em `tailwind.config.js`, com o prefixo `safe-` (por exemplo, `bg-safe-card` e `text-safe-secondary`).

Monte as classes sempre escritas por inteiro. O Tailwind só gera as classes que aparecem completas no código, então algo como `` bg-${cor}/10 `` não funciona.

## ☁️ Deploy

O build (`npm run build`) gera arquivos estáticos em `dist/`, que podem ser publicados em S3 + CloudFront. Para isso, gere o build com `VITE_API_URL` apontando para a URL pública do backend. O passo a passo da AWS está no [README do backend](../server/README.md#️-aws-deploy).
