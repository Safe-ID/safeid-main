# Cobertura Atual dos Testes

**Projeto:** SafeID Backend  
**Data da medição:** 17/10/2026 (commit da `main` com os PRs até o #88)  
**Comando utilizado:** `npm run test:cov -- --runInBand`

## Resultado geral

A medição atual da suíte unitária apresentou:

| Métrica | Resultado | Threshold | Situação |
|---|---:|---:|---|
| Statements | 98,88% | 80% | Aprovado |
| Branches | 90,25% | 80% | Aprovado |
| Functions | 96,96% | 85% | Aprovado |
| Lines | 99,05% | 80% | Aprovado |

Na contagem instrumentada desta execução, foram encontrados **811 branches**: **732 cobertos** e **79 não cobertos**. A meta de 80% exige pelo menos **649 branches cobertos**.

Também foram confirmados:

- 32 suítes de teste aprovadas;
- 349 testes aprovados;
- nenhum snapshot utilizado;
- nenhum teste falhando na execução validada.

## Onde a cobertura é configurada

Os thresholds estão definidos em:

```text
server/jest.unit.config.js
```

Configuração atual:

```javascript
coverageThreshold: {
  global: {
    statements: 80,
    branches: 80,
    functions: 85,
    lines: 80,
  },
}
```

A coleta considera os arquivos de produção em `server/src` e exclui arquivos de declaração TypeScript (`.d.ts`).

## Interpretação dos números

A cobertura de statements, functions e lines está acima dos limites com margem confortável. O principal ponto de atenção é branches, porque essa métrica exige exercitar caminhos alternativos, como:

- sucesso e erro;
- cache hit e cache miss;
- fallback e resposta principal;
- circuit breaker fechado, aberto e em recuperação;
- job concluído, falho e expirado;
- dependência externa disponível e indisponível;
- dados válidos, vazios ou inválidos.

O limite de branches começou em 68% e subiu para 80% depois da expansão dos testes. Hoje a suíte está em 90,25%, com folga sobre todos os limites.

## Principais áreas de atenção

Os 79 branches não cobertos estão concentrados em caminhos difíceis de reproduzir em teste unitário:

- `ExecuteRiskScanUseCase`: espera de jobs da fila, timeout e falhas de persistência;
- bootstrap e workers: ramos de `APP_ROLE`, shutdown e reconexão do Redis;
- `HibpClient` e `HibpPlanService`: combinações de erro HTTP e estados do circuit breaker;
- serviços de monitoramento: falhas parciais durante a varredura e a reconciliação.

Esses pontos devem ser cobertos com testes de comportamento, sem testar detalhes internos desnecessários.

## Como reproduzir a medição

No PowerShell:

```powershell
cd C:\caminho\para\safeid-main\server
npm ci
npm run test:cov -- --runInBand
```

A saída será exibida no terminal e o relatório detalhado será criado em:

```text
server/coverage/
```

Arquivos úteis do relatório:

- `server/coverage/lcov-report/index.html`: relatório navegável no navegador;
- `server/coverage/lcov.info`: formato utilizado por ferramentas de CI e Codecov.

## Testes por camada

A cobertura deste documento vem só da suíte unitária. As outras camadas são medidas pela quantidade de testes:

| Camada | Comando | Suítes | Testes |
|---|---|---:|---:|
| Unitários (com cobertura) | `npm run test:cov -- --runInBand` | 32 | 349 |
| Integração (fluxos com Prisma em memória) | `npm run test:integration` | 3 | 5 |
| E2E da API | `npm run test:e2e` | 5 | 23 |
| Componentes do frontend (Vitest) | `cd client && npm test` | 3 | 26 |

Integração e E2E validam fluxos mais amplos e não substituem o limite de cobertura unitária.

### Fuzz testing do motor de risco

`tests/unit/risk.engine.fuzz.spec.ts` usa o [fast-check](https://fast-check.dev) para gerar vazamentos aleatórios (nomes reais do HIBP, nomes desconhecidos, datas válidas, futuras e inválidas) e conferir propriedades que valem para qualquer entrada:

- o score é sempre um inteiro entre 0 e 100 e o cálculo nunca lança erro;
- a classificação segue as faixas LOW < 26 ≤ MODERATE < 51 ≤ HIGH < 76 ≤ CRITICAL;
- o fator temporal é sempre 1,0, 0,7 ou 0,4, e data inválida conta como recente;
- a ordem dos vazamentos e as maiúsculas dos nomes não mudam o resultado;
- expor mais um dado ou encontrar mais um vazamento nunca diminui o score;
- um vazamento mais antigo nunca pesa mais que um mais novo.

Cada propriedade roda 300 casos por execução. Se falhar, o fast-check mostra a seed e o menor contraexemplo. Foi assim que apareceu um defeito: um tipo de dado chamado `__proto__` (ou `constructor`, `toString`) deixava o score como NaN, porque a busca do peso achava uma propriedade herdada do objeto. Os pesos passaram a ficar num `Map`.

## Execução no CI

O workflow principal está em `.github/workflows/ci.yml` e roda em todo PR e na fila de merge. Os quatro jobs são checks obrigatórios da `main`:

| Job | O que roda |
|---|---|
| `Frontend lint and build` | `npm ci`, `npm run lint`, `npm test` (Vitest), `npm run build` |
| `Backend lint, build and unit tests` | `npm ci`, `npm run lint`, `npm run build`, `npm run test:cov -- --runInBand` e envio do relatório de cobertura |
| `Backend integration tests` | aplica as migrations num PostgreSQL 16 real (valida que elas rodam) e `npm run test:integration` |
| `Backend E2E tests` | migrations num PostgreSQL 16 e `npm run test:e2e` |

Se qualquer limite de cobertura ficar abaixo do configurado, o job do backend falha e o PR não entra na `main`.

## Próxima meta recomendada

Os limites atuais (80/80/85/80) estão bem abaixo da cobertura real. Sugestões:

1. manter todos os testes passando e a cobertura acima de 90% de branches;
2. avaliar subir o limite de branches para 85%, deixando folga para mudanças futuras;
3. cobrir os caminhos de erro da fila e do bootstrap listados acima;
4. acrescentar testes e2e no navegador e testes de carga, que hoje não existem.

Não é recomendado aumentar o limite apenas por decisão administrativa, sem que a suíte consiga demonstrar a nova cobertura.

