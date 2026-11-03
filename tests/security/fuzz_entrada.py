"""Entradas maliciosas em cada campo JSON da API (só biblioteca padrão).

Uso:  python tests/security/fuzz_entrada.py caminho/do/log/da/api saida.json

Só contra a cópia local (e2e/README.md), nunca em produção: são centenas de requisições. Cada uma
leva um X-Forwarded-For diferente, o que hoje escapa do limite por IP (achado S07 do relatório).
Sinaliza resposta 5xx, detalhe interno vazado, payload devolvido sem tratamento e lentidão.
"""
import collections
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

API = "http://127.0.0.1:3100/api/v1"
LOG = sys.argv[1]
contador = 0

PAYLOADS = [
    ("SQL", "' OR '1'='1"), ("SQL", "'; DROP TABLE \"user\"; --"), ("SQL tempo", "'; SELECT pg_sleep(5); --"),
    ("NoSQL", {"$gt": ""}), ("NoSQL", {"$ne": None}), ("Protótipo", {"__proto__": {"admin": True}}), ("Protótipo", "__proto__"),
    ("XSS", "<script>alert(1)</script>"), ("XSS", "\"><img src=x onerror=alert(1)>"), ("Comando", "; cat /etc/passwd"), ("Comando", "$(id)"),
    ("Caminho", "../../../../etc/passwd"), ("Template", "{{7*7}}${7*7}"), ("Nulo", "a\u0000b"), ("Tipo", None), ("Tipo", 12345), ("Tipo", True),
    ("Tipo", ["a", "b"]), ("Tipo", {}), ("Tamanho", "A" * 100000), ("Unicode", "😀" * 500), ("E-mail", "a@b.c\r\nBcc: alvo@example.com"),
]
ROTAS = [
    ("POST", "/auth/signup", {"email": "x@example.com", "password": "SenhaDeTeste1", "acceptTerms": True}, False),
    ("POST", "/auth/login", {"email": "x@example.com", "password": "SenhaDeTeste1"}, False),
    ("POST", "/auth/verify-email", {"token": "a" * 43}, False),
    ("POST", "/auth/resend-verification", {"email": "x@example.com"}, False),
    ("POST", "/auth/forgot-password", {"email": "x@example.com"}, False),
    ("POST", "/auth/reset-password", {"token": "a" * 43, "password": "SenhaDeTeste1"}, False),
    ("POST", "/auth/refresh", {"refresh_token": "a" * 40}, False),
    ("POST", "/auth/change-password", {"currentPassword": "SenhaDeTeste1", "newPassword": "SenhaDeTeste2"}, True),
    ("PATCH", "/monitoring/preferences", {"enabled": True}, True),
    ("POST", "/monitoring/unsubscribe?token=a", {}, False),
]
CAMINHOS = ["/scan/{}", "/notifications/{}/read"]
VAZA = re.compile(r"prisma|PrismaClient|at /|at [A-Z]\w+\.|node_modules|SELECT |syntax error|ECONN|stack", re.I)


def call(method, path, body=None, token=None, raw=None):
    global contador
    contador += 1
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, method=method, data=data)
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Forwarded-For", f"10.{contador // 65536}.{contador // 256 % 256}.{contador % 256}")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    inicio = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace"), time.time() - inicio
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), time.time() - inicio


tamanho = os.path.getsize(LOG)
email = f"fuzz-{int(time.time())}@example.com"
assert call("POST", "/auth/signup", {"email": email, "password": "SenhaDeTeste1", "acceptTerms": True})[0] == 201
for _ in range(60):
    with open(LOG, encoding="utf-8", errors="replace") as f:
        f.seek(tamanho)
        achados = re.findall(r"verify_token=([A-Za-z0-9_%-]+)", f.read())
    if achados:
        break
    time.sleep(0.5)
token = json.loads(call("POST", "/auth/verify-email", {"token": achados[-1]})[1])["access_token"]

status = collections.Counter()
problemas = []


def avalia(rota, campo, tipo, payload, res):
    st, corpo, dur = res
    status[st] += 1
    if st >= 500:
        problemas.append({"rota": rota, "campo": campo, "tipo": tipo, "problema": f"HTTP {st}", "resposta": corpo[:160]})
    if st != 429 and VAZA.search(corpo) and not (isinstance(payload, str) and VAZA.search(payload)):
        problemas.append({"rota": rota, "campo": campo, "tipo": tipo, "problema": "detalhe interno na resposta", "resposta": corpo[:160]})
    if dur > 4:
        problemas.append({"rota": rota, "campo": campo, "tipo": tipo, "problema": f"lenta: {dur:.1f} s", "resposta": ""})
    if isinstance(payload, str) and tipo == "XSS" and payload in corpo:
        problemas.append({"rota": rota, "campo": campo, "tipo": tipo, "problema": "payload devolvido na resposta", "resposta": corpo[:160]})


for metodo, caminho, base, autenticada in ROTAS:
    tk = token if autenticada else None
    for campo in list(base) or ["extra"]:
        for tipo, payload in PAYLOADS:
            corpo = dict(base)
            corpo[campo] = payload
            avalia(f"{metodo} {caminho}", campo, tipo, payload, call(metodo, caminho, corpo, tk))
    for nome, raw in (("JSON quebrado", b'{"a":'), ("Corpo gigante", b'{"a":"' + b"A" * 2_000_000 + b'"}')):
        res = call(metodo, caminho, token=tk, raw=raw)
        avalia(f"{metodo} {caminho}", "(corpo)", nome, None, res)
for modelo in CAMINHOS:
    for tipo, payload in PAYLOADS:
        if isinstance(payload, str) and len(payload) < 500:
            p = re.sub(r"[^A-Za-z0-9_.-]", lambda m: "%%%02X" % ord(m[0]) if ord(m[0]) < 128 else "", payload)
            if p:
                metodo = "GET" if "scan" in modelo else "PATCH"
                avalia(f"{metodo} {modelo}", "caminho", tipo, payload, call(metodo, modelo.format(p), token=token))
for tipo, payload in PAYLOADS:
    if isinstance(payload, str) and len(payload) < 500:
        p = re.sub(r"[^A-Za-z0-9_.-]", lambda m: "%%%02X" % ord(m[0]) if ord(m[0]) < 128 else "", payload)
        avalia("GET /notifications", "cursor", tipo, payload, call("GET", f"/notifications?cursor={p}&limit={p}", token=token))
        avalia("GET /monitoring/unsubscribe", "token", tipo, payload, call("GET", f"/monitoring/unsubscribe?token={p}"))

# Depois de todas as entradas maliciosas, a API tem de seguir respondendo
with urllib.request.urlopen("http://127.0.0.1:3100/api/health", timeout=10) as r:
    api_ok = r.status == 200
print("requisições:", contador, dict(status))
print("API segue respondendo:", api_ok)
print("problemas:", len(problemas))
for p in problemas[:30]:
    print(" ", p["rota"], p["campo"], p["tipo"], "|", p["problema"], "|", p["resposta"][:90])
json.dump({"requisicoes": contador, "por_status": {str(k): v for k, v in sorted(status.items())}, "api_responde_no_fim": api_ok, "problemas": problemas},
          open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
