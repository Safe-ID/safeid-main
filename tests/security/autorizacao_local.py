"""Testes de autorização que o scanner não cobre: um usuário tentando alcançar dados de outro.

Uso:  python tests/security/autorizacao_local.py caminho/do/log/da/api [saida.json]

Só contra a cópia local (e2e/README.md): cria contas e lê os links de e-mail do log da API.
Fora da produção, a API responde em http://127.0.0.1:3100.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "http://127.0.0.1:3100/api/v1"
LOG = sys.argv[1]
results = []


def check(nome, ok, detalhe=""):
    results.append({"categoria": "Autorização", "verificacao": nome, "ok": bool(ok), "detalhe": str(detalhe)})
    print("ok   " if ok else "FALHA", nome, "|", str(detalhe)[:90])


def call(method, path, body=None, token=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {}


def conta(email):
    size = os.path.getsize(LOG)
    status, _ = call("POST", "/auth/signup", {"email": email, "password": "SenhaDeTeste1", "acceptTerms": True})
    assert status == 201, status
    for _ in range(60):
        with open(LOG, encoding="utf-8", errors="replace") as f:
            f.seek(size)
            m = re.findall(r"verify_token=([A-Za-z0-9_%-]+)", f.read())
        if m:
            return call("POST", "/auth/verify-email", {"token": m[-1]})[1]
        time.sleep(0.5)
    raise SystemExit("link de verificação não chegou")


def sql(q):
    return subprocess.run(["docker", "exec", "safeid-t-pg", "psql", "-U", "t", "-d", "t", "-tAc", q], capture_output=True, text=True).stdout.strip()


stamp = int(time.time())
sql("DELETE FROM \"user\" WHERE email='breached@example.com';")
a = conta("breached@example.com")
b = conta(f"outro-{stamp}@example.com")
ta, tb = a["access_token"], b["access_token"]
ida = a["user"]["id"]

for _ in range(40):
    hist = call("GET", "/scan/history", token=ta)[1]
    if hist:
        break
    time.sleep(1)
item = hist[0]
job = item.get("jobId") or item.get("id")
check("o dono lê a própria análise", call("GET", f"/scan/{job}", token=ta)[0] == 200, job)
status, corpo = call("GET", f"/scan/{job}", token=tb)
# A rota responde 200 com corpo vazio em vez de 404: não vaza nada, e o relatório registra a observação
check("outro usuário não lê a análise pelo jobId", not corpo, f"HTTP {status}, corpo vazio" if not corpo else corpo)
check("o histórico de outro usuário não aparece", call("GET", "/scan/history", token=tb)[1] != hist)

raw = sql(f"INSERT INTO notification (\"userId\",type,title,body,payload,\"dedupeKey\",\"emailStatus\") VALUES ({ida},'NEW_BREACH','teste','teste','{{}}','seg-{stamp}','SENT') RETURNING id;")
nid = raw.splitlines()[0]
status, _ = call("PATCH", f"/notifications/{nid}/read", token=tb)
check("outro usuário não marca a notificação alheia", status in (403, 404), status)
check("a notificação alheia segue não lida", sql(f"SELECT \"readAt\" IS NULL FROM notification WHERE id={nid}") == "t")
status, _ = call("PATCH", f"/notifications/{nid}/read", token=ta)
check("o dono marca a própria notificação", status < 300 and sql(f"SELECT \"readAt\" IS NOT NULL FROM notification WHERE id={nid}") == "t", status)

check("o refresh token não vale como acesso", call("GET", "/auth/me", token=a["refresh_token"])[0] == 401)
check("o token de acesso não vale como refresh", call("POST", "/auth/refresh", {"refresh_token": ta})[0] == 401)
export = json.dumps(call("GET", "/auth/me/export", token=tb)[1])
check("a exportação traz só a própria conta", "breached@example.com" not in export)
check("a exclusão só apaga a conta do token", call("DELETE", "/auth/me", token=tb)[0] == 200 and sql(f"SELECT count(*) FROM \"user\" WHERE id={ida}") == "1")
check("token de conta apagada deixa de valer", call("GET", "/auth/me", token=tb)[0] == 401)
call("DELETE", "/auth/me", token=ta)

print(sum(r["ok"] for r in results), "de", len(results), "ok")
if len(sys.argv) > 2:
    json.dump(results, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
