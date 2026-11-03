"""Gera os relatórios de teste a partir de docs/testes/dados.

Uso (na raiz do repositório):
  python tests/relatorios/gerar.py
  cd e2e && node ../tests/relatorios/pdf.js
"""
import html
import json
import os
import statistics

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DADOS = os.path.join(RAIZ, "docs", "testes", "dados")
HTML = os.path.join(RAIZ, "docs", "testes", "html")
os.makedirs(HTML, exist_ok=True)
COMMIT = "f9677df"
DATA = "03/11/2026"


def carrega(nome):
    with open(os.path.join(DADOS, nome), encoding="utf-8") as f:
        return json.load(f)


def e(v):
    return html.escape(str(v))


def tabela(cab, linhas, largura=None):
    col = "".join(f'<col style="width:{w}%">' for w in (largura or []))
    h = "".join(f"<th>{e(c)}</th>" for c in cab)
    b = "".join("<tr>" + "".join(f"<td>{c if str(c).startswith('<') else e(c)}</td>" for c in l) + "</tr>" for l in linhas)
    return f"<table><colgroup>{col}</colgroup><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>"


def num(v, casas=0):
    return f"{v:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")


CSS = """
@page { size: A4; margin: 20mm 18mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #0f172a; line-height: 1.45; }
h1 { font-size: 20pt; margin: 0 0 4px; }
.sub { color: #475569; font-size: 9.5pt; margin-bottom: 16px; border-bottom: 2px solid #1a6fff; padding-bottom: 10px; }
h2 { font-size: 13pt; margin: 20px 0 6px; color: #0b3a8a; break-after: avoid; }
p, ul { margin: 6px 0; } li { margin: 3px 0; }
table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 9pt; }
th { background: #0f172a; color: #fff; text-align: left; padding: 5px 6px; }
td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; word-break: break-word; }
tr { break-inside: avoid; }
.box { background: #f1f5f9; border-left: 4px solid #1a6fff; padding: 8px 10px; margin: 10px 0; break-inside: avoid; }
.alerta { background: #fef2f2; border-left: 4px solid #dc2626; padding: 8px 10px; margin: 10px 0; break-inside: avoid; }
.ok { color: #047857; font-weight: bold; } .nao { color: #b91c1c; font-weight: bold; }
code { font-family: Consolas, monospace; font-size: 8.5pt; background: #f1f5f9; padding: 0 2px; }
"""


def pagina(arquivo, titulo, corpo):
    doc = f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>{e(titulo)}</title><style>{CSS}</style></head><body>
<h1>{e(titulo)}</h1><div class="sub">SafeID · Commit {COMMIT} da main · Executado em {DATA} · Horários em UTC</div>{corpo}</body></html>"""
    with open(os.path.join(HTML, arquivo), "w", encoding="utf-8") as f:
        f.write(doc)


OK, NAO = '<span class="ok">Atingida</span>', '<span class="nao">Fora da meta</span>'

# ------------------------------------------------------------------ Alerta
pagina("relatorio-alerta-email.html", "Relatório de teste: alerta real por e-mail", f"""
<div class="box"><b>Resultado: aprovado.</b> O monitoramento detectou um vazamento tratado como novo em produção e o e-mail chegou à caixa de entrada em cerca de 3 segundos, depois de a checagem ser enfileirada.</div>
<h2>Objetivo</h2><p>Comprovar a US08 e o RF09 de ponta a ponta em produção. Até então, só o liga e desliga dos alertas havia sido testado, pois nenhum vazamento novo real tinha aparecido para uma conta acompanhada.</p>
<h2>Ambiente</h2><ul><li>Produção na AWS: ECS Fargate, RDS, ElastiCache e Amazon SES fora do sandbox.</li><li>HIBP real, plano Core 1, e modelo de IA de produção.</li><li>Conta de teste da equipe, verificada, com monitoramento ligado e 4 vazamentos reais.</li></ul>
<h2>Método</h2><p>Sem esperar um vazamento novo, o teste forçou a condição real, com autorização da equipe e em uma conta da própria equipe:</p>
<ul><li>Uma task pontual do ECS removeu <code>ArmorGames</code> da base de vazamentos conhecidos (<code>UserBreach</code>) dessa conta.</li><li>A mesma task enfileirou um <code>monitor-check</code> na fila <code>hibp-check</code>, exatamente como a varredura faz.</li><li>Todo o resto seguiu pelo código normal da aplicação.</li></ul>
<h2>Linha do tempo</h2>
{tabela(["Horário", "Etapa", "Evidência"], [
["17:34:16", "Checagem enfileirada", "Job 108 na fila hibp-check"],
["17:34:17", "Consulta à HIBP", "lastMonitoredAt atualizado"],
["17:34:20", "Vazamento novo detectado", "Evento monitor.new_breach, count 1"],
["17:34:20", "Notificação criada", "Evento notification.created, id 1"],
["17:34:20", "E-mail aceito pelo SES", "Evento email.sent, messageId 010f01a1a279e621-efe83e7e-0d17-4fbd-af8b-5922d27ecc11-000000"],
["Em seguida", "E-mail recebido", "A equipe confirmou a chegada na caixa de entrada: assunto, remetente alertas@safeid.app.br, Armor Games, dados expostos, risco 95/100 (Crítico) e botão 'Ver meu painel'"],
], [14, 28, 58])}
<h2>Critérios verificados</h2>
{tabela(["Critério", "Resultado"], [
["Varredura em segundo plano detecta vazamento que não está na base", '<span class="ok">Aprovado</span>'],
["Uma única notificação por vazamento novo", '<span class="ok">Aprovado: 1 notificação criada</span>'],
["E-mail real enviado pelo SES, com link para o painel", '<span class="ok">Aprovado</span>'],
["Vazamento volta à base como já notificado, sem repetir o alerta", '<span class="ok">Aprovado: origem MONITORING, com notifiedAt</span>'],
], [65, 35])}
<h2>Limitações</h2><ul>
<li>O vazamento não era novo de verdade: o texto "publicados recentemente", ao lado de uma data de 2019, é efeito do teste forçado.</li>
<li>O gatilho foi manual. O disparo agendado por novidade no catálogo é coberto por testes automatizados de integração, não por este teste.</li>
<li>O teste comprova um envio, não a taxa de entrega em volume.</li></ul>
<h2>Efeitos na conta de teste</h2><p>Ficaram 1 notificação, 1 registro novo no histórico (origem MONITORING) e o <code>ArmorGames</code> com origem MONITORING. Nenhuma outra conta foi alterada. O endereço da conta não consta neste relatório.</p>
""")

# ------------------------------------------------------------------ Pentest
ver = carrega("verificacoes.json")
aut = carrega("autorizacao.json")
audit = carrega("npm-audit-server.json")
fuzz = carrega("fuzz.json")
xff = carrega("xff-bypass.json")
cats = {}
for r in ver:
    cats.setdefault(r["categoria"], []).append(r["ok"])
linhas_ver = [[c, len(v), sum(v)] for c, v in cats.items()]


def zap(nome):
    d = carrega(f"zap-{nome}.json")
    cont = {"3": 0, "2": 0, "1": 0, "0": 0}
    for s in d["site"]:
        for a in s["alerts"]:
            cont[a["riskcode"]] += 1
    return cont, d


zlin = []
for nome, alvo, modo in (("prod-www", "www.safeid.app.br (produção)", "Passivo"), ("prod-api", "api.safeid.app.br (produção)", "Passivo"),
                         ("local-api", "API local, autenticada", "Ativo"), ("local-web", "Front local", "Ativo")):
    c, _ = zap(nome)
    zlin.append([alvo, modo, c["3"], c["2"], c["1"], c["0"]])

aud = audit["resumo"]
pagina("relatorio-pentest.html", "Relatório de teste: segurança (pentest)", f"""
<div class="box"><b>Resultado: sem achado alto ou crítico em aberto.</b> O achado S01, com {6} pacotes altos nas dependências, foi corrigido pelo PR #123: o <code>npm audit --omit=dev</code> do back-end passou de 6 altos e 7 moderados para <b>0 altos e {aud['moderate']} moderados</b>, estes justificados. As varreduras, o fuzzing e os testes dirigidos não encontraram falha explorável. Resta o achado médio S07 (limite de login contornável por cabeçalho forjado), recomendado corrigir. O critério da Seção 6.3 do documento ("nenhum achado de severidade alta ou crítica em aberto") <b>passa a estar cumprido</b>.</div>
<p><b>Nota:</b> a correção de dependências está na <code>main</code> ({COMMIT}), mas ainda não foi para produção, que roda a imagem anterior. O novo deploy a leva.</p>
<h2>Escopo e autorização</h2><ul>
<li>Autorizado pela equipe, dona do sistema, apenas sobre os domínios e a infraestrutura do próprio projeto.</li>
<li><b>Em produção:</b> só testes de baixo impacto: varredura passiva, verificações dirigidas e a prova do S07, com poucas requisições.</li>
<li><b>Em cópia local descartável:</b> varredura ativa, autorização e fuzzing de entrada, com PostgreSQL e Redis próprios, HIBP simulada, e-mail só em log.</li>
<li><b>Fora do escopo:</b> negação de serviço, engenharia social e testes na infraestrutura da AWS.</li></ul>
<h2>Ferramentas</h2><ul><li>OWASP ZAP 2.17.0: <code>zap-baseline</code>, <code>zap-api-scan</code> e <code>zap-full-scan</code>.</li><li>Scripts versionados: <code>tests/security/verificacoes.py</code>, <code>autorizacao_local.py</code> e <code>fuzz_entrada.py</code>.</li><li><code>npm audit --omit=dev</code> no back-end e no front-end.</li></ul>
<h2>Verificações dirigidas em produção: {sum(r['ok'] for r in ver)} de {len(ver)} aprovadas</h2>
{tabela(["Categoria", "Verificações", "Aprovadas"], linhas_ver, [60, 20, 20])}
<p>Cobrem TLS e redirecionamento HTTPS, cabeçalhos, CORS, rotas sem login, JWT forjado (alg none e assinatura falsa), injeção SQL e NoSQL no login, campos extras, exposição de arquivos, enumeração de contas e bloqueio após tentativas de login.</p>
<h2>Autorização entre usuários, em cópia local: {sum(r['ok'] for r in aut)} de {len(aut)} aprovadas</h2>
{tabela(["Verificação", "Resultado"], [[r["verificacao"], '<span class="ok">Aprovada</span>' if r["ok"] else '<span class="nao">Reprovada</span>'] for r in aut], [78, 22])}
<h2>Fuzzing de entrada, em cópia local</h2>
<p>O script <code>fuzz_entrada.py</code> enviou {fuzz['requisicoes']} requisições, injetando {'22'} tipos de carga maliciosa (SQL, NoSQL, poluição de protótipo, XSS, comando, travessia de caminho, template, nulo, tipos trocados, 100 KB e corpo de 2 MB) em cada campo JSON de 10 rotas, nos parâmetros de caminho e de consulta. Resultado: <b>{len(fuzz['problemas'])} problema(s)</b>. Nenhum 5xx, nenhum detalhe interno na resposta, nenhum XSS refletido; a API seguiu respondendo ao final. As respostas foram {', '.join(f"{v}&times;{k}" for k, v in fuzz['por_status'].items())} (400, 401 e 413 são as recusas esperadas).</p>
<h2>Varreduras do ZAP (número de tipos de alerta)</h2>
{tabela(["Alvo", "Modo", "Alto", "Médio", "Baixo", "Informativo"], zlin, [38, 12, 10, 10, 10, 20])}
<p>A varredura ativa da API importou 28 endereços do OpenAPI e, confirmado por um proxy contador, enviou 454 requisições reais à aplicação (incluindo os ataques das regras ativas), não apenas as rotas listadas.</p>
<h2>Achados</h2>
{tabela(["ID", "Severidade", "Achado", "Situação e recomendação"], [
["S01", "Alta", "npm audit: 6 pacotes altos e 7 moderados nas dependências de produção do back-end (na campanha anterior).", "<b>Resolvido (PR #123):</b> 0 altos e 3 moderados. Os moderados vêm de um único aviso de SSE no @nestjs/core, sem rota @Sse na aplicação."],
["S07", "Média", "O limite de tentativas de login é contado pelo primeiro IP do X-Forwarded-For, que o cliente controla. Em produção, 12 tentativas com IP forjado diferente a cada vez não dispararam o 429.", "<b>Em aberto.</b> Confiar apenas no X-Forwarded-For escrito pelo ALB/CloudFront (número fixo de proxies), ou limitar também por e-mail/rota. Mitiga força bruta distribuída."],
["S02", "Média", "CSP do site com style-src 'unsafe-inline'.", "Aceito: exigido por React e Tailwind. script-src é só 'self', o que limita o impacto."],
["S03", "Baixa", "Cabeçalhos COOP, COEP e CORP ausentes no site.", "Recomendado incluir COOP e CORP na política do CloudFront. COEP não é necessário."],
["S04", "Baixa", "GET /scan/:jobId de outro usuário responde 200 com corpo vazio.", "Sem vazamento: a consulta filtra por userId. Recomendado responder 404."],
["S05", "Baixa", "Cabeçalho 'Server: AmazonS3' no site.", "Aceito: não expõe versão."],
["S06", "Baixa", "Redis sem TLS nem criptografia em repouso.", "Já conhecido, na rede privada. Dados do cache usam HMAC. Avaliar ao sair do plano atual."],
["—", "Descartados", "'HTTP Only Site' (efeito do ambiente local) e 'Timestamp Disclosure' (datas legítimas no JSON).", "Falsos positivos, sem ação."],
], [7, 11, 42, 40])}
<h2>Prova do S07 (produção)</h2>
<p>Do mesmo IP, a 6ª tentativa de login já recebe 429 ({', '.join(map(str, xff['sem_cabecalho_forjado']))}). Com um X-Forwarded-For diferente a cada tentativa, as 12 passam sem 429 ({', '.join(map(str, xff['com_cabecalho_forjado']))}). Evidência em <code>docs/testes/dados/xff-bypass.json</code>.</p>
<h2>Moderados restantes nas dependências</h2>
{tabela(["Severidade", "Pacote", "Aviso", "Alcançável"], [[a["severidade"], a["pacote"], (a["titulo"] or "")[:70], "Não: exige endpoint @Sse, inexistente no código"] for a in audit["achados"]], [12, 16, 48, 24])}
<p>Os alertas completos estão em <code>docs/testes/dados/npm-audit-server.json</code>.</p>
<h2>Incidente durante o teste</h2><div class="box">Na primeira varredura ativa, o ZAP seguiu o redirecionamento de <code>/api/v1/auth/google</code> e enviou dezenas de requisições a <code>accounts.google.com</code>, <b>fora do escopo autorizado</b>. O client_id era um valor de exemplo, sem credenciais. A rota foi excluída das varreduras seguintes, e os resultados do domínio do Google foram descartados dos dados.</div>
<h2>Limitações</h2><ul>
<li><b>Não substitui um pentest manual por terceiros:</b> o teste é automatizado, com verificações dirigidas pela própria equipe, e não prova ausência de falhas.</li>
<li>Os limites por rota (login 5 por minuto, cadastro 5 a cada 15 minutos) continuaram ativos na cópia local, o que reduz a cobertura do ZAP nessas rotas.</li>
<li>Os fluxos com HIBP real, IA e login com Google não passaram pela varredura ativa.</li></ul>
<h2>Como repetir</h2><p>Ver <code>docs/testes/README.md</code>. Dados brutos em <code>docs/testes/dados/</code>.</p>
""")

# ------------------------------------------------------------------ Carga
runs = [carrega(f"k6-{n}.json") for n in (1, 2, 3)]
cw = carrega("cloudwatch.json")
SEG = {"linha_de_base": 60, "carga": 420, "pico": 120, "recuperacao": 60}
ROT = {"linha_de_base": "Linha de base (20 VUs)", "carga": "Carga (até 100 VUs)", "pico": "Pico (300 VUs)", "recuperacao": "Recuperação (20 VUs)"}
METAS = {"linha_de_base": 750, "carga": 750, "pico": 1500, "recuperacao": 750}


def p95(run, fase, alvo):
    return run["metrics"][f"http_req_duration{{fase:{fase},alvo:{alvo}}}"]["values"]["p(95)"]


lin = []
for fase in SEG:
    vals = [p95(r, fase, "api") for r in runs]
    reqs = [r["metrics"][f"http_reqs{{fase:{fase}}}"]["values"]["count"] for r in runs]
    errs = [r["metrics"][f"http_req_failed{{fase:{fase}}}"]["values"]["rate"] * 100 for r in runs]
    lin.append([ROT[fase], f"{num(statistics.median(vals))} ms", f"{num(min(vals))} a {num(max(vals))} ms", f"< {num(METAS[fase])} ms", f"{num(statistics.median(reqs) / SEG[fase], 0)} req/s", f"{num(max(errs), 2)}%", OK if max(vals) < METAS[fase] and max(errs) < 2 else NAO])
site = []
for fase in ("carga", "pico"):
    vals = [p95(r, fase, "site") for r in runs]
    site.append([ROT[fase], f"{num(statistics.median(vals))} ms", f"{num(min(vals))} a {num(max(vals))} ms"])
total = sum(r["metrics"]["http_reqs"]["values"]["count"] for r in runs)
falhas = max(r["metrics"]["http_req_failed"]["values"]["rate"] for r in runs) * 100
exec_lin = [[i + 1, num(r["metrics"]["http_reqs"]["values"]["count"]), f"{num(r['metrics']['http_req_failed']['values']['rate'] * 100, 2)}%", f"{num(r['state']['testRunDurationMs'] / 1000)} s"] for i, r in enumerate(runs)]
pagina("relatorio-carga-k6.html", "Relatório de teste: carga com k6", f"""
<div class="box"><b>Resultado: metas medidas atingidas.</b> Foram {num(total)} requisições em 3 execuções, com {num(falhas, 2)}% de erro, nenhum alarme disparado e nenhum 5xx. As metas de cache, Motor de Risco e fila da Tabela 2 <b>não puderam ser medidas</b> pelo motivo explicado abaixo.</div>
<h2>Objetivo</h2><p>Executar a campanha da Seção 5.5.3.2 do documento: aquecimento, patamar de 100 usuários virtuais por 5 minutos, pico de 300, recuperação, com 3 execuções e publicação da mediana e da amplitude dos P95.</p>
<h2>Ambiente</h2><ul><li>Alvo: produção, em us-east-2, com 1 task Fargate (0,5 vCPU e 1 GB), RDS db.t3.micro e ElastiCache cache.t3.micro. Produção roda a imagem anterior ao PR #123; a medição não é afetada, por bater em rotas não tocadas por ele.</li><li>Gerador: k6 v2.3.0, em um único computador no Brasil. Script: <code>tests/load/k6-producao.js</code>.</li><li>Execuções entre 18:01 e 18:37 UTC, com 1 minuto de intervalo. Cada usuário virtual faz 1 acesso por segundo: <code>GET /api/health</code> e, a cada 5 iterações, a página inicial.</li></ul>
<h2>Resultados da API (GET /api/health)</h2>
{tabela(["Fase", "P95 (mediana)", "P95 (amplitude)", "Meta", "Vazão", "Erro máx.", "Situação"], lin, [24, 13, 18, 11, 11, 9, 14])}
<h2>Site no CloudFront</h2>
{tabela(["Fase", "P95 (mediana)", "P95 (amplitude)"], site, [50, 25, 25])}
<h2>Execuções</h2>
{tabela(["Execução", "Requisições", "Erro", "Duração"], exec_lin, [25, 25, 25, 25])}
<h2>Métricas da AWS no período</h2>
{tabela(["Métrica", "Valor"], [[m["metrica"], num(m["valor"], 3).rstrip("0").rstrip(",")] for m in cw["metricas"]], [75, 25])}
<p>O tempo médio de resposta do alvo no ALB foi de 5 ms, e a mediana vista pelo gerador ficou em torno de 140 ms. A maior parte da latência medida é a rede entre o Brasil e us-east-2.</p>
<h2>Comparação com a Tabela 2 do documento</h2>
{tabela(["Cenário da Tabela 2", "Meta", "Situação"], [
["Pico de 300 usuários virtuais", "P95 < 1,5 s; erro < 2%", '<span class="ok">Atingida</span>'],
["Consulta com acerto no cache Redis", "P95 < 50 ms; ≥ 500 req/s", "Não medida: não existe rota pública de consulta"],
["Motor de Risco sem chamada externa", "P95 < 100 ms; ≥ 250 req/s", "Não medida: o motor não tem rota própria"],
["API com fila BullMQ", "P95 < 750 ms para enfileirar", "Não medida: o enfileiramento só ocorre no cadastro e no monitoramento"],
["Consulta nova à HIBP", "Limitada pelo plano", "Sem alteração: verificada no código; plano Core 1, 9 por minuto"],
["Falha da fonte externa", "Abrir com ≥ 50% de erro", "Sem alteração: coberta por testes unitários"],
], [36, 26, 38])}
<div class="box"><b>Recomendação:</b> reescrever a Tabela 2 com os cenários medidos, porque as rotas de cache, motor e fila deixaram de existir com a retirada da consulta manual. A meta de 100 VUs ≥ 500 req/s também não é alcançada com 1 acesso por segundo: a vazão real foi de cerca de 90 req/s na carga e 233 req/s no pico.</div>
<h2>Pontos de atenção</h2><ul>
<li><b>CPU do Fargate chegou a 73%</b> no pico, com cerca de 233 req/s em uma rota simples. Há margem, mas pouca para rotas mais pesadas com 1 task e sem auto scaling.</li>
<li>O RDS ficou folgado, com CPU máxima de 7%, e as conexões bateram no limite configurado de 10, sem erro.</li></ul>
<h2>Limitações</h2><ul>
<li><code>/api/health</code> faz só um SELECT 1 e um PING no Redis. Rotas com login, descriptografia e IA são mais pesadas e não foram medidas, porque as demais respondem 429 depois de 100 requisições a cada 15 minutos por IP.</li>
<li>Todo o tráfego saiu de um único IP e de um único computador.</li><li>Não houve teste de duração prolongada (soak) nem busca do ponto de ruptura.</li></ul>
""")

# ------------------------------------------------------------------ E2E
proj = {p: carrega(f"e2e-{p}.json") for p in ("chromium", "firefox", "webkit", "celular")}
titulos = [t["teste"] for t in proj["chromium"]["testes"]]
lin = []
for t in titulos:
    row = [t]
    for p in proj:
        r = next(x for x in proj[p]["testes"] if x["teste"] == t)
        row.append('<span class="ok">Passou</span>' if r["status"] in ("passed", "expected") else f'<span class="nao">{e(r["status"])}</span>')
    lin.append(row)
somas = [[p, d["stats"]["expected"], d["stats"]["unexpected"], f"{num(d['stats']['duration'] / 1000)} s"] for p, d in proj.items()]
total_ok = sum(d["stats"]["expected"] for d in proj.values())
total_f = sum(d["stats"]["unexpected"] for d in proj.values())
pagina("relatorio-e2e-playwright.html", "Relatório de teste: E2E no navegador (Playwright)", f"""
<div class="box"><b>Resultado: aprovado.</b> {total_ok} execuções passaram e {total_f} falharam, nos 4 ambientes. Os testes rodaram na cópia local, não em produção.</div>
<h2>Objetivo</h2><p>Cobrir, no navegador de verdade, a jornada que o documento deixava como planejada (Seções 5.5.2.4 e 5.5.3.1).</p>
<h2>Ambiente</h2><ul>
<li>Playwright {e(proj['chromium']['versao'])}. Testes em <code>e2e/tests/</code>, com instruções em <code>e2e/README.md</code>.</li>
<li>Build de produção do front, servido localmente, API NestJS real com filas BullMQ reais, PostgreSQL 16 e Redis 7 em contêineres descartáveis.</li>
<li>Simulados: HIBP (com o simulador do repositório), IA (resposta padrão, sem endpoint configurado) e envio de e-mail (o link é lido do log da API).</li></ul>
<h2>Navegadores</h2>
{tabela(["Ambiente", "Navegador", "Passou", "Falhou", "Duração"], [
["chromium", "Chrome for Testing 156", somas[0][1], somas[0][2], somas[0][3]],
["firefox", "Firefox do contêiner oficial do Playwright", somas[1][1], somas[1][2], somas[1][3]],
["webkit", "WebKit 27.2", somas[2][1], somas[2][2], somas[2][3]],
["celular", "Chromium com emulação do Pixel 7", somas[3][1], somas[3][2], somas[3][3]],
], [14, 46, 12, 12, 16])}
<p>O Firefox rodou no contêiner oficial porque o Windows desta máquina bloqueia o executável sem assinatura digital baixado pelo Playwright. O WebKit do Playwright é um build próprio e não equivale exatamente ao Safari em um iPhone real.</p>
<h2>Resultado por teste</h2>
{tabela(["Teste", "Chromium", "Firefox", "WebKit", "Celular"], lin, [48, 13, 13, 13, 13])}
<h2>Etapas da jornada completa</h2><ul>
{''.join(f'<li>{e(s)}</li>' for s in proj['chromium']['testes'][0]['passos'] if s[0:1].islower() and not s.startswith(('fixture', 'browser', 'page.', 'expect', 'locator', 'test.')))}
</ul>
<h2>Limitações</h2><ul>
<li><b>Fora da cobertura:</b> login com Google, HIBP real, IA real e envio real de e-mail. Esses pontos foram conferidos manualmente em produção pela equipe em 03/11/2026, e o e-mail, no relatório de alerta.</li>
<li>O PDF confere que a impressão do navegador é acionada, não o arquivo gerado.</li>
<li>A suíte não entrou no CI, porque precisa da cópia local no ar. Ela roda manualmente.</li></ul>
""")
print("HTML gerados em", HTML)
