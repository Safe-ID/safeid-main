// Campanha de carga do SafeID (Seção 5.5.3.2 do documento).
// Uso: k6 run --env SAIDA=resultado.json tests/load/k6-producao.js
//
// Só exercita o que tem rota pública sem limite por IP: GET /api/health (ALB, Fargate, PostgreSQL e
// Redis) e o site no CloudFront. As demais rotas respondem 429 depois de 100 requisições a cada
// 15 minutos por IP, e a consulta à HIBP não tem rota pública, por decisão de projeto.
// A campanha para sozinha se a produção degradar.
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const API = __ENV.API_URL || 'https://api.safeid.app.br/api/health';
const SITE = __ENV.SITE_URL || 'https://www.safeid.app.br/';

export const options = {
  scenarios: {
    linha_de_base: { executor: 'constant-vus', vus: 20, duration: '60s', exec: 'usuario', tags: { fase: 'linha_de_base' } },
    carga: {
      executor: 'ramping-vus',
      startTime: '60s',
      startVUs: 20,
      stages: [
        { duration: '60s', target: 100 },
        { duration: '300s', target: 100 },
        { duration: '60s', target: 20 },
      ],
      gracefulRampDown: '5s',
      exec: 'usuario',
      tags: { fase: 'carga' },
    },
    pico: {
      executor: 'ramping-vus',
      startTime: '480s',
      startVUs: 20,
      stages: [
        { duration: '30s', target: 300 },
        { duration: '60s', target: 300 },
        { duration: '30s', target: 20 },
      ],
      gracefulRampDown: '5s',
      exec: 'usuario',
      tags: { fase: 'pico' },
    },
    recuperacao: { executor: 'constant-vus', vus: 20, duration: '60s', startTime: '600s', exec: 'usuario', tags: { fase: 'recuperacao' } },
  },
  thresholds: {
    // Parada de segurança, para não derrubar a produção
    http_req_failed: [{ threshold: 'rate<0.10', abortOnFail: true, delayAbortEval: '30s' }],
    'http_req_duration{fase:linha_de_base,alvo:api}': ['p(95)<750'],
    'http_req_duration{fase:carga,alvo:api}': ['p(95)<750'],
    'http_req_duration{fase:pico,alvo:api}': ['p(95)<1500'],
    'http_req_duration{fase:recuperacao,alvo:api}': ['p(95)<750'],
    'http_req_duration{fase:carga,alvo:site}': ['p(95)<750'],
    'http_req_duration{fase:pico,alvo:site}': ['p(95)<1500'],
    'http_req_failed{fase:linha_de_base}': ['rate<0.02'],
    'http_req_failed{fase:carga}': ['rate<0.02'],
    'http_req_failed{fase:pico}': ['rate<0.02'],
    'http_req_failed{fase:recuperacao}': ['rate<0.02'],
    'http_reqs{fase:linha_de_base}': ['count>0'],
    'http_reqs{fase:carga}': ['count>0'],
    'http_reqs{fase:pico}': ['count>0'],
    'http_reqs{fase:recuperacao}': ['count>0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function usuario() {
  const res = http.get(API, { tags: { alvo: 'api' } });
  check(res, { 'API responde 200': r => r.status === 200 });
  // Um em cada cinco acessos abre o site, como quem chega pela página inicial
  if (exec.scenario.iterationInTest % 5 === 0) {
    const site = http.get(SITE, { tags: { alvo: 'site' } });
    check(site, { 'site responde 200': r => r.status === 200 });
  }
  sleep(1);
}

export function handleSummary(data) {
  return { [__ENV.SAIDA || 'k6-resultado.json']: JSON.stringify(data, null, 1), stdout: '\nCampanha encerrada.\n' };
}
