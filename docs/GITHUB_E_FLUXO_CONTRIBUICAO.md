# Manual de Git e GitHub do SafeID

Este manual explica, passo a passo e sem exigir conhecimento avançado, como alterar o projeto SafeID com segurança.

## 1. Como o repositório está configurado

O repositório é `Safe-ID/safeid-main` e a branch principal é `main`.

### Equipe de revisão

A equipe `Safe-ID/maintainers` possui quatro desenvolvedores:

- `Farizaku`
- `ucasvieira`
- `PMathsP`
- `KelScrr`

O arquivo `.github/CODEOWNERS` aponta o projeto para essa equipe. Isso significa que alterações no repositório solicitam revisão de alguém da equipe.

### Proteção da `main`

O ruleset `Protect main` está ativo e exige:

- Pull Request para qualquer alteração;
- pelo menos uma aprovação;
- aprovação de outra pessoa depois do último push;
- revisão de Code Owner;
- resolução das conversas do PR;
- todos os checks obrigatórios aprovados;
- histórico sem force push;
- merge, squash merge ou rebase merge;
- nenhum bypass configurado para desenvolvedores.

A aprovação do próprio autor não atende à regra. Se o autor fizer um novo push depois da aprovação, uma nova aprovação será necessária.

### Checks obrigatórios

O ruleset exige estes quatro checks:

- `Frontend lint and build`
- `Backend lint, build and unit tests`
- `Backend integration tests`
- `Backend E2E tests`

Há também verificações adicionais:

- CodeQL para JavaScript/TypeScript;
- Dependency Review para dependências novas ou alteradas.

### Segurança do GitHub

Estão ativos no repositório:

- Dependency Graph;
- Dependabot security updates;
- Secret scanning;
- secret push protection;
- CodeQL;
- Dependency Review com falha para vulnerabilidades altas.

## 2. O caminho de uma alteração

A alteração percorre este caminho:

```text
Editar arquivos
    |
    v
Rodar validações locais
    |
    v
Criar branch de trabalho
    |
    v
Commitar a alteração
    |
    v
Enviar a branch para o GitHub
    |
    v
Abrir Pull Request para main
    |
    v
GitHub executa lint, build, testes, CodeQL e dependências
    |
    v
Outro desenvolvedor revisa e aprova ou solicita mudanças
    |
    v
Todos os checks verdes + aprovação
    |
    v
Merge do Pull Request
    |
    v
main recebe a alteração
```

Nunca é necessário enviar alterações diretamente para `main`. Esse push é bloqueado de propósito.

## 3. Preparação inicial do computador

Instale:

- Git;
- Node.js 20 ou versão compatível;
- Docker Desktop, se for executar PostgreSQL e Redis localmente;
- GitHub CLI, opcional, para abrir PRs pelo terminal.

Configure seu nome e email do Git uma única vez:

```powershell
git config --global user.name "Seu Nome"
git config --global user.email "seu-email@exemplo.com"
```

Confira:

```powershell
git config --global --list
git --version
node --version
npm --version
```

Se usar o GitHub CLI:

```powershell
gh auth login
```

## 4. Baixar o projeto

Na primeira vez:

```powershell
git clone https://github.com/Safe-ID/safeid-main.git
cd safeid-main
git switch main
git pull origin main
```

Se o projeto já estiver no computador:

```powershell
cd C:\caminho\para\safeid-main
git switch main
git pull origin main
```

## 5. Criar uma branch

Sempre crie uma branch nova a partir da `main` atualizada.

Exemplos:

```powershell
git switch -c feature/nova-tela
git switch -c fix/erro-no-login
git switch -c chore/atualizar-documentacao
```

Sugestões de nomes:

- `feature/` para funcionalidade nova;
- `fix/` para correção de erro;
- `test/` para testes;
- `docs/` para documentação;
- `chore/` para configuração e manutenção.

Confira em qual branch está:

```powershell
git branch --show-current
git status
```

## 6. Instalar dependências e preparar o projeto

Backend:

```powershell
cd server
npm ci
npm run prisma:generate
```

Frontend, em outro terminal ou depois:

```powershell
cd client
npm ci
```

Não faça commit de `.env`, `node_modules`, `dist` ou `coverage`. Esses arquivos já estão protegidos pelo `.gitignore`.

Para usar Docker Compose localmente, defina uma senha apenas na sessão atual do PowerShell:

```powershell
$env:POSTGRES_PASSWORD = "uma-senha-local"
docker compose -f server/docker-compose.yml up -d postgres redis
```

Nunca coloque senha real no arquivo de workflow, no `docker-compose.yml` ou em um commit.

## 7. Validar antes de commitar

### Backend

```powershell
cd server
npm run lint
npm run build
npm run test:cov -- --runInBand
```

Resultado esperado atual da cobertura:

- statements: pelo menos 80%;
- branches: pelo menos 68%;
- functions: pelo menos 85%;
- lines: pelo menos 80%.

A execução validada mais recente alcançou 69,23% de branches.

Testes específicos:

```powershell
npm run test:unit -- --runInBand
npm run test:integration -- --runInBand
npm run test:e2e -- --runInBand
```

### Frontend

```powershell
cd client
npm run lint
npm run build
```

### Verificação do Git

Na raiz do projeto:

```powershell
git diff --check
git status
```

Se aparecerem arquivos secretos ou gerados, não os adicione.

## 8. Criar o commit

Volte para a raiz do projeto e veja o que será enviado:

```powershell
cd ..
git status
git diff --stat
git diff
```

Adicione somente os arquivos da alteração:

```powershell
git add caminho/do/arquivo.ts
```

Ou, se todos os arquivos mostrados forem realmente parte da alteração:

```powershell
git add .
```

Confira o que está preparado:

```powershell
git diff --cached --stat
git diff --cached
```

Crie o commit:

```powershell
git commit -m "Adiciona validação de risco no scan"
```

Mensagens recomendadas:

- `Adiciona ...`
- `Corrige ...`
- `Testa ...`
- `Documenta ...`
- `Atualiza ...`

## 9. Enviar a branch

Na primeira publicação da branch:

```powershell
git push --set-upstream origin feature/nova-tela
```

Nas próximas vezes:

```powershell
git push
```

Não use:

```powershell
git push origin main
```

Esse comando será bloqueado pelas regras do repositório.

## 10. Abrir o Pull Request

### Pelo navegador

Depois do push, abra o repositório no GitHub e clique em `Compare & pull request`.

Preencha:

- base: `main`;
- compare: sua branch;
- título que explique a alteração;
- descrição com o que foi feito e como foi validado.

### Pelo GitHub CLI

```powershell
gh pr create --base main --head feature/nova-tela --title "Adiciona nova tela" --body "Descreve aqui a alteração e os testes executados."
```

Veja o PR criado:

```powershell
gh pr view --web
```

## 11. O que acontece depois do PR

O GitHub executa automaticamente:

1. lint e build do frontend;
2. lint, build e testes unitários do backend;
3. testes de integração com PostgreSQL temporário;
4. testes E2E com PostgreSQL temporário;
5. CodeQL;
6. Dependency Review.

Enquanto algum check estiver pendente ou falhar, o merge fica bloqueado.

Para acompanhar pelo terminal:

```powershell
gh pr checks
```

Para acompanhar em tempo real:

```powershell
gh pr checks --watch
```

## 12. Como revisar um Pull Request

A pessoa revisora deve:

1. abrir a aba `Files changed`;
2. entender o objetivo da alteração;
3. verificar possíveis efeitos colaterais;
4. conferir se existem testes suficientes;
5. verificar se não há segredos ou arquivos gerados;
6. conferir os checks do CI;
7. aprovar ou solicitar mudanças.

Opções de revisão:

- `Approve`: alteração aprovada;
- `Request changes`: mudanças obrigatórias antes do merge;
- `Comment`: observação sem bloquear necessariamente o merge.

O autor do PR não deve aprovar o próprio trabalho. Um dos outros três desenvolvedores deve revisar e aprovar.

## 13. Corrigir um PR após comentários

Continue usando a mesma branch do PR:

```powershell
git switch feature/nova-tela
```

Faça a correção, valide novamente e crie outro commit:

```powershell
git add caminho/do/arquivo.ts
git commit -m "Corrige comentário da revisão"
git push
```

O PR será atualizado automaticamente. Como o último push muda, uma nova aprovação poderá ser exigida.

## 14. Fazer o merge

O merge só deve ser feito quando:

- os quatro checks obrigatórios estiverem verdes;
- CodeQL e Dependency Review não tiverem problemas bloqueantes;
- pelo menos uma pessoa diferente do autor tiver aprovado;
- todas as conversas obrigatórias estiverem resolvidas.

O merge pode ser feito pelo botão do GitHub usando merge, squash ou rebase, conforme a preferência do time.

Depois do merge:

```powershell
git switch main
git pull origin main
git branch -d feature/nova-tela
```

Para remover também a branch remota, se ela não for mantida:

```powershell
git push origin --delete feature/nova-tela
```

## 15. Problemas comuns

### `Changes must be made through a pull request`

Você tentou enviar direto para `main`. Crie uma branch e abra um PR:

```powershell
git switch -c fix/minha-correcao
git push --set-upstream origin fix/minha-correcao
```

### `required status checks are expected`

Os checks configurados ainda não foram executados para o commit. Confirme que os workflows estão publicados na branch e aguarde o Actions.

### O check de backend falha por variável ausente

Use as variáveis de teste do workflow ou configure o `.env` local. Nunca publique valores reais no Git.

### O CI falha no lint

Execute localmente:

```powershell
cd server
npm run lint
```

Corrija os erros, crie um novo commit e faça `git push` na mesma branch.

### O CI falha nos testes

Execute o teste localmente com o mesmo comando indicado no workflow:

```powershell
cd server
npm run test:cov -- --runInBand
```

Leia o primeiro teste que falhou; os demais erros podem ser consequência dele.

### O push foi rejeitado

Não force o push. Verifique:

```powershell
git status
 git branch --show-current
git log --oneline -3
gh pr checks
```

Se estiver na `main`, volte para uma branch de trabalho e abra um PR.

## 16. Regra simples para lembrar

```text
main atualizada
-> branch nova
-> alteração
-> testes locais
-> commit
-> push da branch
-> Pull Request
-> checks verdes
-> revisão de outra pessoa
-> merge
```
