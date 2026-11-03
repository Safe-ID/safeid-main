"""Verificações de segurança direcionadas ao SafeID (só biblioteca padrão).

Uso:  python tests/security/verificacoes.py [saida.json]

Roda apenas contra os domínios do próprio projeto, sem tentar negação de serviço: cada
checagem faz poucas requisições. O limite de login é testado com um e-mail inexistente.
"""
import base64
import http.client
import json
import socket
import ssl
import sys
import urllib.parse

SITE = "www.safeid.app.br"
API = "api.safeid.app.br"
results = []


def check(categoria, nome, ok, detalhe=""):
    results.append({"categoria": categoria, "verificacao": nome, "ok": bool(ok), "detalhe": str(detalhe)})
    print(("ok   " if ok else "FALHA"), categoria, "|", nome, "|", str(detalhe)[:90])


def req(host, method, path, body=None, headers=None, tls=True):
    conn = (http.client.HTTPSConnection if tls else http.client.HTTPConnection)(host, timeout=20)
    hdrs = dict(headers or {})
    payload = None
    if body is not None:
        payload = json.dumps(body)
        hdrs.setdefault("Content-Type", "application/json")
    conn.request(method, path, payload, hdrs)
    r = conn.getresponse()
    data = r.read().decode("utf-8", "replace")
    out = (r.status, {k.lower(): v for k, v in r.getheaders()}, data)
    conn.close()
    return out


def b64(obj):
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()


def tls_refused(host, version):
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ctx.minimum_version = version
    ctx.maximum_version = version
    try:
        with socket.create_connection((host, 443), timeout=10) as raw:
            with ctx.wrap_socket(raw, server_hostname=host):
                return False
    except (ssl.SSLError, OSError):
        return True


# ---- Transporte
for host in (SITE, API):
    ctx = ssl.create_default_context()
    with socket.create_connection((host, 443), timeout=10) as raw:
        with ctx.wrap_socket(raw, server_hostname=host) as s:
            check("Transporte", f"{host}: certificado válido", True, s.version())
    status, h, _ = req(host, "GET", "/", tls=False)
    check("Transporte", f"{host}: HTTP redireciona para HTTPS", status in (301, 302, 307, 308) and h.get("location", "").startswith("https://"), status)
    with_warnings = ssl.TLSVersion.TLSv1_1
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        check("Transporte", f"{host}: recusa TLS 1.1", tls_refused(host, with_warnings))

# ---- Cabeçalhos
_, h, _ = req(SITE, "GET", "/")
for name in ("strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"):
    check("Cabeçalhos", f"site: {name}", name in h, h.get(name, "ausente")[:70])
csp = h.get("content-security-policy", "")
check("Cabeçalhos", "site: CSP sem unsafe-inline em script-src", "script-src 'self'" in csp and "script-src 'self' 'unsafe" not in csp)
check("Cabeçalhos", "site: CSP impede enquadramento", "frame-ancestors 'none'" in csp)
_, h, _ = req(API, "GET", "/api/health")
for name in ("strict-transport-security", "content-security-policy", "x-content-type-options"):
    check("Cabeçalhos", f"API: {name}", name in h)
check("Cabeçalhos", "API: não expõe X-Powered-By", "x-powered-by" not in h)

# ---- CORS
status, h, _ = req(API, "OPTIONS", "/api/v1/auth/me", headers={"Origin": "https://site-malicioso.example", "Access-Control-Request-Method": "GET"})
allow = h.get("access-control-allow-origin", "")
check("CORS", "API não libera origem estranha", allow in ("", f"https://{SITE}"), allow or "sem liberação")

# ---- Autenticação e autorização
for method, path in (("GET", "/api/v1/auth/me"), ("GET", "/api/v1/auth/me/export"), ("DELETE", "/api/v1/auth/me"), ("POST", "/api/v1/auth/change-password"),
                     ("GET", "/api/v1/scan/history"), ("GET", "/api/v1/scan/1"), ("GET", "/api/v1/notifications"), ("GET", "/api/v1/monitoring/status")):
    status, _, _ = req(API, method, path, {} if method == "POST" else None)
    check("Autenticação", f"{method} {path} exige login", status == 401, status)
none_token = f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64({'sub': 1, 'email': 'x@example.com'})}."
fake_sig = f"{b64({'alg': 'HS256', 'typ': 'JWT'})}.{b64({'sub': 1, 'email': 'x@example.com', 'exp': 4102444800})}.{b64({'s': 'assinatura-falsa'})}"
for nome, tok in (("alg none", none_token), ("assinatura falsa", fake_sig)):
    status, _, _ = req(API, "GET", "/api/v1/auth/me", headers={"Authorization": f"Bearer {tok}"})
    check("Autenticação", f"JWT forjado ({nome}) é recusado", status == 401, status)
status, _, _ = req(API, "GET", "/api/health/jobs")
check("Autenticação", "/api/health/jobs exige token de administrador", status == 401, status)
status, _, _ = req(API, "GET", "/api/health/jobs", headers={"X-Admin-Token": "token-errado"})
check("Autenticação", "/api/health/jobs recusa token errado", status == 401, status)

# ---- Entrada
for nome, email in (("injeção SQL", "' OR '1'='1"), ("objeto NoSQL", {"$gt": ""})):
    status, _, data = req(API, "POST", "/api/v1/auth/login", {"email": email, "password": "x"})
    check("Entrada", f"login com {nome} é recusado", status == 400, status)
    check("Entrada", f"erro de {nome} não vaza detalhes internos", not any(t in data for t in ("prisma", "Prisma", "stack", "at /app", "SELECT")))
status, _, _ = req(API, "POST", "/api/v1/auth/signup", {"email": "a@example.com", "password": "SenhaForte123", "acceptTerms": True, "isAdmin": True, "emailVerifiedAt": "2020-01-01"})
check("Entrada", "campo extra no cadastro é recusado", status == 400, status)
status, _, _ = req(API, "POST", "/api/v1/auth/reset-password", {"token": "a" * 43, "password": "SenhaForte123"})
check("Entrada", "token de senha inexistente é recusado", status in (400, 410), status)
status, h, _ = req(API, "GET", "/api/v1/monitoring/unsubscribe?token=forjado")
check("Entrada", "descadastro com token forjado não altera nada", "monitoring=unsubscribed" not in h.get("location", ""), h.get("location", status)[:70])

# ---- Exposição
status, _, _ = req(API, "GET", "/api/docs")
check("Exposição", "Swagger fora do ar em produção", status == 404, status)
for path in ("/.env", "/.git/config", "/server/.env.production", "/package.json"):
    _, _, data = req(SITE, "GET", path)
    leak = any(t in data for t in ("DATABASE_URL", "[core]", '"dependencies"'))
    check("Exposição", f"site não expõe {path}", not leak)
    status, _, data = req(API, "GET", path)
    check("Exposição", f"API não expõe {path}", status in (401, 403, 404) and "DATABASE_URL" not in data, status)

# ---- E-mails: mesma resposta com conta existente ou não
_, _, a = req(API, "POST", "/api/v1/auth/resend-verification", {"email": "nao-existe-safeid-1@example.com"})
_, _, b = req(API, "POST", "/api/v1/auth/resend-verification", {"email": "nao-existe-safeid-2@example.com"})
check("Enumeração", "resposta do reenvio não revela se a conta existe", a == b)

# ---- Limite de tentativas: precisa ser o último, porque bloqueia o IP por 1 minuto
codes = [req(API, "POST", "/api/v1/auth/login", {"email": "nao-existe-safeid@example.com", "password": "SenhaErrada123"})[0] for _ in range(7)]
check("Limite de tentativas", "login bloqueia com 429 após o limite", 429 in codes, codes)
check("Limite de tentativas", "senha errada não revela a conta (401)", codes[0] == 401, codes[0])

passed = sum(r["ok"] for r in results)
print(f"\n{passed} de {len(results)} verificações ok")
if len(sys.argv) > 1:
    json.dump(results, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
