# Relatórios de teste

Campanha de 03/11/2026, sobre o commit `fbc4e58` da `main`, com as correções S01 (PR #123) e S07 (PR #127) em produção.

| Relatório | Resultado |
|---|---|
| [Alerta real por e-mail](relatorio-alerta-email.pdf) | Aprovado, em produção |
| [Segurança (pentest)](relatorio-pentest.pdf) | Todos os achados corrigidos ou aceitos (S01 e S07 resolvidos e reconfirmados em produção) |
| [Carga com k6](relatorio-carga-k6.pdf) | Metas medidas atingidas; parte da Tabela 2 não é mensurável |
| [E2E com Playwright](relatorio-e2e-playwright.pdf) | Aprovado, em cópia local |

Os dados brutos ficam em `dados/`, sem credenciais, caminhos locais nem o e-mail da conta de teste.

## Como repetir

**Segurança em produção.** Rodar só nos domínios do projeto:

```bash
python tests/security/verificacoes.py saida.json
```

```bash
docker run --rm -v "$PWD:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://www.safeid.app.br -m 2 -J saida.json -I
```

**Carga em produção.** A campanha leva 11 minutos e para sozinha se a taxa de erro passar de 10%:

```bash
k6 run --env SAIDA=saida.json tests/load/k6-producao.js
```

**Cópia local.** A varredura ativa, a autorização e o E2E precisam da cópia descrita em [`e2e/README.md`](../../e2e/README.md). Na varredura ativa, exclua `/api/v1/auth/google` do OpenAPI: o ZAP segue o redirecionamento para fora do escopo.

```bash
python tests/security/autorizacao_local.py caminho/do/log/da/api.log saida.json
```

**PDFs.** Geram os relatórios a partir de `dados/`:

```bash
python tests/relatorios/gerar.py
```

```bash
cd e2e && node ../tests/relatorios/pdf.js
```
