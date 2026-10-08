# Cobertura Atual dos Testes

**Projeto:** SafeID Backend  
**Data da medição:** 06/10/2026  
**Comando utilizado:** `npm run test:cov -- --runInBand`

## Resultado geral

A medição atual da suíte unitária apresentou:

| Métrica | Resultado | Threshold | Situação |
|---|---:|---:|---|
| Statements | 96,42% | 80% | Aprovado |
| Branches | 81,90% | 80% | Aprovado |
| Functions | 91,17% | 85% | Aprovado |
| Lines | 96,66% | 80% | Aprovado |

Na contagem instrumentada desta execução, foram encontrados **221 branches**: **181 cobertos** e **40 não cobertos**. A cobertura já ultrapassa a meta de 80%, que exigia pelo menos **177 branches cobertos**.

Também foram confirmados:

- 12 suítes de teste aprovadas;
- 77 testes aprovados;
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
    branches: 68,
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

A baseline de branches havia sido fixada em 68% porque a suíte anterior alcançava 69,23%, enquanto os branches restantes estavam concentrados principalmente em infraestrutura, integrações externas, circuit breaker e bootstrap da aplicação. Após a expansão dos testes, a suíte alcançou 81,90% e superou a meta de 80%.

## Principais áreas de atenção

Na última execução detalhada, os maiores pontos de melhoria estavam em:

- `ExecuteRiskScanUseCase`: caminhos alternativos de espera de jobs, timeout e persistência;
- `HibpClient`: fallback por range, erros HTTP e estados do circuit breaker;
- `AuthService`: OAuth, validações, fallback do scan inicial e estados de conta;
- `ScanService`: snapshot existente, snapshot vazio e tratamento de JSON inválido;
- workers e bootstrap: ramos condicionais de infraestrutura.

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

A cobertura global deste documento é gerada pela configuração unitária:

```powershell
cd server
npm run test:unit -- --runInBand
```

As outras camadas podem ser executadas separadamente:

```powershell
npm run test:integration -- --runInBand
npm run test:e2e -- --runInBand
```

Integração e E2E validam fluxos mais amplos e não substituem o gate de cobertura unitária.

## Execução no CI

O workflow principal está em:

```text
.github/workflows/ci.yml
```

O job `Backend lint, build and unit tests` executa:

1. `npm ci`;
2. `npm run lint`;
3. `npm run build`;
4. `npm run test:cov -- --runInBand`.

Se qualquer threshold ficar abaixo do configurado, o job falha e o Pull Request não pode ser integrado à `main`.

## Próxima meta recomendada

A próxima evolução deve ser incremental:

1. manter todos os testes atuais passando;
2. adicionar testes para os 40 branches de infraestrutura ainda não exercitados;
3. avaliar a elevação do threshold de branches de 68% para 80%;
4. repetir a medição no CI;
5. continuar cobrindo caminhos de baixo risco de regressão até se aproximar de 90%.

Não é recomendado aumentar o threshold apenas por decisão administrativa, sem que a suíte consiga demonstrar a nova cobertura.
