# Plano de Implementação de Testes e CI

Este documento transforma o plano de testes e pipeline em uma sequência objetiva de alterações para o backend do SafeID.

O foco é estabilizar a camada de testes antes de criar novos testes para `delete account`.

## 1. Situação atual

- Os arquivos de teste em `server/tests/unit`, `server/tests/integration` e `server/tests/e2e` ainda estão em formato de exemplo.
- O pipeline atual em `server/.github/workflows/ci.yml` executa lint, build e uma única etapa de cobertura, sem separar unit, integração e E2E.
- O Jest está configurado em `server/jest.config.js`, mas os entrypoints específicos de integração e E2E não existem no workspace.
- O código já possui módulos relevantes para risco, AI, HIBP, Redis e BullMQ, então a melhoria deve começar por eles.

## 1.1. Progresso já executado

- Suíte unitária de `RiskEngine` implantada e validada.
- Teste unitário de sanitização do `AIEngine` implantado e validado.
- Utilitário AES-256-GCM adicionado com testes de round-trip e adulteração.
- Configs separados de Jest para unit, integração e E2E criados.
- Pipeline CI dividido em lint, unit, integração e E2E.
- Integração de `ScanService` coberta com mocks de Prisma, Redis e BullMQ.
- Fluxos E2E de `health`, `auth` e `scan` validados com sucesso.
- Teste E2E de delete do usuário implementado e validado.
- Porta de checagem de cobertura adicionada ao Jest unitário, de acordo com a meta de 80% de linhas, 75% de branches e 85% de funções.

> Observação importante: a cobertura atual ainda está abaixo da meta estabelecida, o que representa a próxima lacuna crítica a ser fechada para que o pipeline de CI passe a bloquear builds abaixo da baseline exigida.

## 2. Objetivo

Estruturar a suíte de testes em três níveis e refletir essa separação no CI/CD:

- testes unitários para regra de negócio pura;
- testes de integração para módulos que conversam com Prisma, Redis e BullMQ;
- testes E2E para os fluxos completos da API;
- validação de cobertura com trava mínima de 80%.

## 3. Ordem de implementação

### Fase 1 - Fundamento da suíte

1. Substituir os testes exemplo por suites reais.
2. Criar factories e mocks compartilhados para Prisma, Redis, BullMQ e serviços externos.
3. Separar o que é teste unitário, integração e E2E em pastas e nomes consistentes.
4. Corrigir ou criar os configs faltantes de integração e E2E para que os scripts apontem para arquivos reais.

### Fase 2 - Testes unitários prioritários

1. Cobrir `server/src/core/engines/risk.engine.ts` com foco em pesos, temporalidade e classificação.
2. Cobrir o módulo de criptografia quando ele estiver presente no código-base ou for criado como parte da suíte de segurança.
3. Cobrir o tradutor/normalizador de IA para sanitização de PII, LGPD e mascaramento de campos sensíveis.
4. Garantir que cada teste unitário use mocks mínimos e não dependa de banco, fila ou rede.

### Fase 3 - Testes de integração

1. Exercitar a orquestração de `Prisma + Redis + BullMQ` no fluxo de scan.
2. Validar os serviços mockados de HIBP e de qualquer dependência externa já isolada no código.
3. Cobrir fluxos de auth e scan que dependem de persistência real, mas com provedores externos simulados.
4. Validar efeitos colaterais, como criação de registro, enfileiramento e leitura do estado salvo.

### Fase 4 - E2E

1. Cobrir primeiro um fluxo HTTP real simples, como health check.
2. Evoluir para autenticação e recuperação de sessão.
3. Cobrir o fluxo completo de scan, histórico e detalhe.
4. Cobrir cenários de erro, vazio e recuperação de sessão.
5. Manter E2E o mais próximo possível do contrato HTTP real da API.

### Fase 5 - CI/CD

1. Manter lint e build como primeira barreira.
2. Adicionar stage dedicado para testes unitários.
3. Adicionar stage dedicado para integração.
4. Adicionar stage dedicado para E2E e carga, se houver massa de teste suficiente.
5. Inserir checagem de cobertura com falha explícita quando ficar abaixo de 80%.

## 4. Alterações por arquivo

### Testes

- `server/tests/unit/example.spec.ts`
  - substituir o placeholder por testes reais ou mover o conteúdo para arquivos por domínio;
  - criar suites específicas para risco, crypto e sanitização.

- `server/tests/integration/example.spec.ts`
  - trocar o exemplo por um caso real que use módulos com Prisma, Redis e BullMQ;
  - organizar fixtures e setup/teardown de banco e fila.

- `server/tests/e2e/example.spec.ts`
  - trocar o exemplo por um fluxo HTTP real com bootstrap da aplicação;
  - iniciar pelo health check e depois avançar para auth/scan;
  - preparar o ambiente para rodar com serviços mockados.

### Configuração de testes

- `server/jest.config.js`
  - revisar a coleta de cobertura;
  - separar os alvos de execução conforme o tipo de suíte;
  - evitar que unit, integração e E2E disputem o mesmo padrão de execução.

- `server/package.json`
  - ajustar scripts para `test:unit`, `test:integration` e `test:e2e` se necessário;
  - manter `test:cov` como porta de cobertura total;
  - preservar scripts manuais existentes.

- `server/jest.integration.config.js`
  - criar este arquivo se a integração for isolada em config próprio;
  - apontar para `server/tests/integration`.

- `server/jest.e2e.config.js`
  - criar este arquivo se o E2E for isolado em config próprio;
  - apontar para `server/tests/e2e`.

### Pipeline

- `server/.github/workflows/ci.yml`
  - dividir a execução em lint, unit, integração e E2E;
  - adicionar trava de cobertura mínima;
  - publicar cobertura apenas após o estágio unit/integration principal.

### Serviços isolados

- criar ou consolidar mocks para:
  - SMTP;
  - OpenAI / Azure;
  - HIBP API.
- centralizar essas simulações em um local único, reutilizável por unit e integração.

## 5. Estratégia de cobertura por domínio

### Sanitização

- validar que o tradutor de IA remove PII antes de enviar texto para provider externo;
- cobrir email, CPF, telefone, nome e trechos livres com dados sensíveis;
- garantir que o mock reproduza entradas e saídas previsíveis.

### Criptografia

- validar AES-256-GCM com cifragem, autenticação e erro por payload adulterado;
- cobrir geração de IV, tag e serialização do envelope criptográfico;
- bloquear qualquer uso de modo inseguro.

### RiskEngine

- validar pesos, fatores temporais, score final e classificação;
- cobrir faixas de risco e limites da regra de negócio;
- proteger contra regressão na fórmula do score.

## 6. Serviços externos isolados

- Mock Provider SMTP: usado para fluxos de notificação e recuperação, sem enviar email real.
- Mock OpenAI / Azure: usado para análise e tradução sem consumir chave real.
- Mock HIBP API: usado para risco, scan e integração sem bater na API pública.

## 7. Critérios de aceite

- Os testes exemplo deixam de existir ou passam a ser apenas bootstrap de apoio.
- A execução local consegue separar unit, integração e E2E.
- O pipeline falha se a cobertura ficar abaixo de 80%.
- Nenhum teste de integração ou E2E depende de serviço externo real por padrão.
- Os testes de delete account só entram depois que a base de teste estiver consolidada.

## 8. Próxima sequência recomendada

1. Criar a base de mocks compartilhados.
2. Implementar o primeiro E2E real para health check.
3. Evoluir os E2E para auth e scan.
4. Adicionar os testes do `DELETE /api/v1/auth/me` depois da base consolidada.