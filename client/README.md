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
- `npm test`: roda os testes de componente uma vez (o CI roda este)
- `npm run test:watch`: roda os testes e repete a cada alteração

## 🧪 Testes

Os testes de componente usam [Vitest](https://vitest.dev) com [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) em jsdom. A configuração fica em `vitest.config.js`, e a preparação comum (matchers do jest-dom e limpeza entre testes) em `src/test/setup.js`. Os arquivos ficam em `src/components/__tests__/*.test.jsx`.

Os testes interagem como o usuário: encontram campos pelo rótulo e botões pelo nome, e a API é simulada com `vi.mock('../../lib/api')`. Hoje cobrem:

- `RiskCircle`: o rótulo de cada faixa de risco nos limites exatos (26, 51 e 76), as mesmas do `RiskEngine` do backend;
- `Auth`: as validações do cadastro, o envio com e sem os alertas, a tela "Confirme seu email" e o login (sucesso, conta não verificada e erro);
- `NotificationBell`: o contador e o "99+", abrir e ler uma notificação, marcar todas como lidas, fechar com Esc e o aviso ao painel quando chega notificação nova.
- `acessibilidade`: o [axe-core](https://github.com/dequelabs/axe-core) roda em cada tela (página inicial, cadastro, login, textos legais, 404, as três abas do painel e as notificações) com as regras WCAG 2.1 A e AA e exige zero violações; também cobre o teclado nas abas, o foco do sino, o título e o foco ao trocar de tela.

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
    ├── PrintablePlan.jsx # Versão do plano para impressão / PDF
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

## 📄 Exportar o plano em PDF

O botão **Exportar PDF** na aba Plano IA abre a janela de impressão do navegador, e o usuário escolhe **Salvar como PDF**. Não há biblioteca de PDF: o `PrintablePlan.jsx` renderiza uma versão do plano fora do `#root` (num portal no `<body>`), escondida na tela. As regras `@media print` do `main.css` escondem o app e mostram só essa versão, em fundo branco e fonte Arial.

O PDF traz o e-mail da conta, a data da análise e a da impressão, cards com score, classificação, vazamentos e urgência (com uma faixa de cor por nível), o resumo, os passos como checklist para marcar, a tabela de vazamentos com a gravidade de cada um e o contato da parceira ENETSEC. Senhas vazadas nunca aparecem, porque o SafeID não as recebe. O nome sugerido do arquivo é `SafeID-plano-de-acao-AAAA-MM-DD`.

O layout é uma tabela cujo `<thead>` (espaço do topo) e `<tfoot>` (rodapé com site e data) se repetem em cada página, com `@page { margin: 0 }`. Assim as margens saem iguais mesmo se a pessoa escolher "Margens: nenhuma" na janela de impressão. As cores usam `print-color-adjust: exact` e sempre vêm acompanhadas do texto do nível, então o documento continua legível em preto e branco.

## ♿ Acessibilidade

Meta: WCAG 2.1 nível AA.

- **Contraste:** as cores de texto do tema passam de 4,5:1 sobre os fundos (`safe-dim` 5,1:1 e branco sobre `safe-primary` 4,84:1). Ao criar uma cor nova de texto, confira a razão antes de usar.
- **Cor não é a única informação:** a gravidade dos dados expostos também aparece em texto (`SEVERITY_CLASSES[...].label`), e os pontos do gráfico mudam de forma.
- **Teclado:** foco sempre visível (`:focus-visible` em `src/main.css`), atalho "Pular para o conteúdo", abas no padrão WAI-ARIA (setas, Home e End) e Esc fecha as notificações devolvendo o foco ao sino.
- **Leitor de tela:** cada tela tem um `h1` e um título de aba próprio, e o foco vai para o conteúdo ao trocar de tela; mensagens usam `role="alert"`/`role="status"`; o gráfico tem descrição e a opção "Ver como tabela".
- **Movimento:** com "reduzir movimento" ligado no sistema, animações e transições são desligadas.

O teste `acessibilidade.test.jsx` roda no CI junto com os outros. No jsdom o axe não calcula contraste, por isso as cores foram conferidas no navegador com o axe completo.

## 🎨 Estilo

As cores do tema ficam em `tailwind.config.js`, com o prefixo `safe-` (por exemplo, `bg-safe-card` e `text-safe-secondary`).

Monte as classes sempre escritas por inteiro. O Tailwind só gera as classes que aparecem completas no código, então algo como `` bg-${cor}/10 `` não funciona.

## ☁️ Deploy

O build (`npm run build`) gera arquivos estáticos em `dist/`, publicados no S3 + CloudFront:

- `provision-s3-cloudfront.ps1`: cria o bucket privado e a distribuição (uma vez) e mantém os cabeçalhos de segurança do site;
- `deploy-s3-cloudfront.ps1`: faz o build com o `VITE_API_URL` de produção, envia ao S3 e limpa o cache do CloudFront.

Os dois leem o `client/.env.production` (modelo em `.env.production.example`, fora do git). Normalmente eles rodam pelo `deploy.ps1` da raiz, que publica backend e frontend juntos. O passo a passo está em [DEPLOY_PRODUCAO.md](../docs/Backend/DEPLOY_PRODUCAO.md).
