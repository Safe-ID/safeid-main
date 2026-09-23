# Guia de testes e fluxo de desenvolvimento do SafeID

Este documento tem uma proposta simples: explicar como o projeto usa testes como ferramenta de segurança, qualidade e velocidade, sem transformar testes em burocracia.

A ideia central é esta:

- testes ajudam a evitar regressões;
- testes deixam claro o comportamento esperado da feature;
- testes guiam a implementação e reduzem retrabalho;
- testes permitem evoluir o sistema com mais confiança.

Se a equipe seguir este fluxo, novas funcionalidades entram com menos risco e menos “surpresa” em produção.

---

## 1. Como o projeto pensa em testes

O SafeID usa a pirâmide de testes:

- Testes unitários: validam uma função ou classe isolada.
- Testes de integração: validam a comunicação entre módulos e banco/serviços internos.
- Testes E2E: validam o comportamento da API em nível de fluxo real, simulando uso do sistema.

Isso significa que o ideal não é apenas “ter testes”, e sim ter o teste certo no nível certo.

Exemplo prático:

- Se a regra de risco diz que um vazamento recente deve aumentar o score, isso vai em teste unitário.
- Se a aplicação consegue salvar o scan no Prisma e atualizar o snapshot do usuário, isso vai em teste de integração.
- Se a rota POST /api/v1/scan responde corretamente com autenticação e retorno esperado, isso vai em teste E2E.

---

## 2. Como rodar os testes no backend

No diretório do backend:

```bash
cd server
```

### Testes unitários

```bash
npm run test:unit
```

ou diretamente:

```bash
npx jest --config jest.unit.config.js --runInBand
```

### Testes de integração

```bash
npm run test:integration
```

### Testes E2E

```bash
npm run test:e2e
```

ou diretamente:

```bash
npx jest --config jest.e2e.config.js --runInBand
```

### Cobertura

```bash
npm run test:cov
```

Esse comando gera relatório de cobertura para verificar se as áreas críticas estão sendo exercitadas.

---

## 3. Quando usar cada tipo de teste

### Teste unitário
Use quando:

- a regra é simples e isolada;
- você quer verificar um cálculo ou comportamento sem depender de banco;
- a lógica pode ser testada em uma função ou classe.

Exemplo:

- cálculo de risco;
- validação de payload;
- sanitização de texto;
- criptografia e descriptografia.

### Teste de integração
Use quando:

- o código precisa conversar com Prisma, Redis, fila ou serviços de infraestrutura;
- você quer validar que a operação real funciona, mesmo que em ambiente controlado.

Exemplo:

- salvar snapshot do usuário após scan;
- registrar histórico em banco;
- integrar com fila de monitoramento.

### Teste E2E
Use quando:

- você quer testar o fluxo completo da API;
- a rota precisa responder corretamente em HTTP;
- o comportamento do sistema precisa ser validado do ponto de vista do cliente/consumidor.

Exemplo:

- signup e login;
- request para /api/v1/scan;
- health check da aplicação.

---

## 4. Exemplos práticos do projeto

### Exemplo 1: teste unitário simples

O projeto já usa testes unitários para validação de regras de negócio, como cálculo de score e sanitização de payload.

Exemplo de ideia:

```ts
it('calcula score máximo quando há vazamento crítico recente', () => {
  const score = calculateRiskScore([
    { category: 'PASSWORD', leakedAt: new Date() }
  ]);

  expect(score).toBe(100);
});
```

Esse tipo de teste responde à pergunta:

- “A regra está correta?”

### Exemplo 2: teste de integração

Valida que o serviço de scan grava corretamente o snapshot no banco ou usa uma fila com comportamento esperado.

Exemplo de ideia:

```ts
it('salva o snapshot do usuário após o scan', async () => {
  await service.submitScan(userId, { email: 'user@example.com' });

  expect(prisma.user.update).toHaveBeenCalled();
});
```

Esse tipo de teste responde:

- “O sistema está integrando corretamente com o banco e os módulos?”

### Exemplo 3: teste E2E da API

O projeto usa também fluxos HTTP reais, sem depender do navegador, para validar endpoints.

Exemplo de ideia:

```ts
it('responds to GET /api/health with database status ok', async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  expect(response.status).toBe(200);
  expect((await response.json()).status).toBe('ok');
});
```

Esse tipo de teste responde:

- “A rota funciona na prática?”

---

## 5. Como usar o fluxo de implementação com testes

### Cobertura mínima e gate de CI

O projeto também define uma regra de qualidade para a suíte de testes: a cobertura mínima de código precisa ser respeitada pela CI.

A meta atual definida para a suíte unitária é:

- 80% de linhas
- 75% de branches
- 85% de funções

Essa regra já foi introduzida na configuração do Jest para que o pipeline passe a falhar quando a base estiver abaixo da meta. Isso evita que a equipe entregue features sem manter a qualidade mínima da base de testes.

> Importante: nesta fase, a cobertura ainda está abaixo da meta, o que mostra claramente que o próximo trabalho do projeto é expandir a suíte de testes, especialmente para módulos ainda não cobertos como autenticação, scan e APIs internas.

A forma correta de trabalhar no SafeID é começar pelo teste.

### Fluxo recomendado

#### Passo 1: entender o requisito
Antes de escrever código, pergunta-se:

- o que exatamente a funcionalidade precisa fazer?
- quais são os casos válidos e inválidos?
- o que acontece em erro?

#### Passo 2: escrever o teste primeiro
Crie o teste para a regra esperada antes da implementação.

Isso faz duas coisas:

- deixa o comportamento esperado claro;
- impede que a feature seja entregue “de olho” sem validação.

Exemplo:

```ts
it('returns 401 when credentials are invalid', async () => {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'x@x.com', password: 'wrong' }),
  });

  expect(response.status).toBe(401);
});
```

#### Passo 3: rodar o teste específico
Executar apenas o teste relevante economiza tempo e deixa mais fácil detectar o problema.

```bash
npx jest --config jest.e2e.config.js --runInBand tests/e2e/auth.spec.ts
```

#### Passo 4: implementar a funcionalidade mínima
Agora sim, escreva o código que faz o teste passar.

Importante: não “colocar um monte de funcionalidade sem teste”. O ideal é resolver apenas o que foi validado.

#### Passo 5: rodar a camada correta

- regra simples: teste unitário
- integração: teste de integração
- fluxo da API: teste E2E

#### Passo 6: validar a suíte mais relevante
Depois de um teste específico passar, rode os testes da camada relevante.

Exemplo:

```bash
npx jest --config jest.e2e.config.js --runInBand
```

#### Passo 7: só então abrir PR ou entregar a feature
Se a feature passou no teste que a descreve e nas camadas impactadas, ela está pronta para continuar.

---

## 6. Regra para novas features no projeto

Toda nova feature deve seguir este padrão:

1. Definir requisito de negócio.
2. Escrever teste(s) que descrevem o comportamento esperado.
3. Fazer o teste falhar primeiro.
4. Implementar a solução mínima.
5. Rodar os testes do nível relevante.
6. Validar regressões na camada impactada.
7. Documentar mudança se necessário.

Em outras palavras:

- não é “implementa e depois vê se funciona”;
- é “implementa sabendo exatamente o que o teste garante”.

---

## 7. Boas práticas do SafeID

- manter mocks limitados ao necessário;
- testar comportamento real do código, não apenas o mock;
- evitar testes fracos que só afirmam que uma função foi chamada sem validar resultado;
- separar teste unitário, integração e E2E;
- usar nomes claros nos testes;
- priorizar a simplicidade do cenário;
- falhar antes e corrigir depois.

---

## 8. Exemplo de fluxo completo para uma nova feature

Imagine que o time precisa criar uma nova rota para excluir a conta do usuário.

### Fluxo correto

1. Definir o requisito:
   - autenticar o usuário;
   - verificar se o usuário existe;
   - remover a conta;
   - retornar mensagem de sucesso.

2. Escrever teste E2E:
   - requisição DELETE /api/v1/auth/me
   - com JWT válido
   - retorno esperado 200 e mensagem correta

3. Escrever teste unitário para o serviço, se houver regra extra.

4. Rodar o teste específico e confirmar a falha.

5. Implementar a lógica no AuthService.

6. Rodar novamente o teste relacionado.

7. Rodar a suíte E2E da área do auth.

8. Fechar com algum exemplo de documentação e revisão.

Esse processo reduz o risco de bug e ajuda a manter a base estável.

---

## 9. Resumo em uma frase

No SafeID, testes não são apenas uma checagem final: eles fazem parte do caminho de desenvolvimento, ajudando a definir, validar e proteger cada nova funcionalidade.

Se uma feature não tem teste, ela não está totalmente pronta para entrar no fluxo de entregas.

---

## 10. Comandos úteis para o dia a dia

```bash
# rodar unitários
npm run test:unit

# rodar integração
npm run test:integration

# rodar E2E
npm run test:e2e

# rodar cobertura
npm run test:cov
```

Esses comandos são a base do ciclo de garantia de qualidade do projeto e devem ser usados como parte natural do processo.
