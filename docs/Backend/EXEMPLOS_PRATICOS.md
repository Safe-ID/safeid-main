# 💻 Exemplos práticos - código real do SafeID

Cada exemplo é um trecho do código atual do `server/`, com o caminho do arquivo, às vezes encurtado com `// ...`. Para o contexto de cada prática, veja [TECNOLOGIAS_E_BOAS_PRATICAS.md](./TECNOLOGIAS_E_BOAS_PRATICAS.md).

## 1. Camadas: do controller ao use case

O controller só recebe a requisição e chama o serviço; o usuário vem do token, nunca de um parâmetro:

```typescript
// src/modules/scan/scan.controller.ts
// Não há rota para o usuário disparar um scan: ele roda no cadastro, quando surge um
// vazamento novo (monitoramento) e de novo, sozinho, se o do cadastro falhar
@Controller('api/v1/scan')
@UseGuards(JwtAuthGuard)
export class ScanController {
  @Get('history')
  async getHistory(@CurrentUser('sub') userId: number): Promise<ScanHistoryDto[]> {
    return this.scanService.getUserHistory(userId);
  }
}
```

O `ExecuteRiskScanUseCase` (`src/core/use-cases/`) orquestra cache, fila da HIBP, `RiskEngine`, `AIEngine` e o histórico. Ele recebe tudo por injeção, então os testes trocam Prisma, Redis e fila por versões em memória (`tests/helpers/in-memory-prisma.ts`).

## 2. Motor de risco

```typescript
// src/core/engines/risk.engine.ts
// S_j = T(t_j) * soma dos pesos; RiskScore = min(100, S_bruto / 50 * 100)
calculate(breaches: BreachData[]): RiskCalculation {
  // ...
  const subscores = breaches.map(breach => this.calculateSubScore(breach));
  const rawTotal = subscores.reduce((sum, sub) => sum + sub.score, 0);
  const totalScore = Math.min(100, Math.round((rawTotal / S_MAX) * 100));
  return { totalScore, classification: this.classify(totalScore), subscores, breachesFound: breaches.length };
}

private classify(score: number): RiskClassification {
  if (score >= 76) return 'CRITICAL';
  if (score >= 51) return 'HIGH';
  if (score >= 26) return 'MODERATE';
  return 'LOW';
}
```

Os pesos usam os nomes exatos da HIBP (`'Passwords': 10`, `'Phone numbers': 5`, `'Names': 3`...) num `Map`, sem diferenciar maiúsculas, e com peso 3 para nomes desconhecidos.

## 3. Validação de entrada

```typescript
// src/modules/auth/dto/auth.dto.ts
export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  // Aceite da Política de Privacidade (consentimento exigido pela LGPD)
  @StrictBoolean()
  acceptTerms!: boolean;

  // Alertas por e-mail quando o e-mail aparecer em vazamentos novos (padrão: sim)
  @IsOptional()
  @StrictBoolean()
  acceptMonitoring?: boolean;
}
```

```typescript
// src/shared/validation/strict-boolean.ts
// O ValidationPipe global converte qualquer string em true (inclusive "false").
// Aqui a validação usa o valor original do corpo: só true/false de verdade passam.
export function StrictBoolean(): PropertyDecorator {
  return applyDecorators(
    Transform(({ obj, key }) => obj[key], { toClassOnly: true }),
    IsBoolean(),
  );
}
```

## 4. Autenticação

O `JwtStrategy` não confia só na assinatura: confere no banco se a conta existe e está verificada, e recusa o refresh token como token de acesso.

```typescript
// src/modules/auth/strategies/jwt.strategy.ts
async validate(payload: JwtPayload): Promise<JwtPayload> {
  // O refresh token só serve na rota /auth/refresh
  if (!payload.sub || !payload.email || payload.typ === 'refresh') {
    throw new UnauthorizedException('Invalid token');
  }

  const user = await this.prisma.user.findUnique({
    where: { id: payload.sub },
    select: { emailVerifiedAt: true },
  });
  if (!user) throw new UnauthorizedException('Usuário não encontrado');
  if (!user.emailVerifiedAt) {
    throw new UnauthorizedException({ code: 'EMAIL_NOT_VERIFIED', message: 'Email não verificado' });
  }
  return payload;
}
```

A renovação (`AuthService.refreshTokens`) confere o token com o `REFRESH_TOKEN_SECRET`, exige `typ: 'refresh'` e uma conta verificada, e devolve um par novo. No cliente, `request()` em `client/src/lib/api.js` renova sozinho ao receber 401 e repete a requisição.

## 5. Rate limit por rota

```typescript
// src/infra/rate-limit/rate-limit.module.ts
export const RATE_LIMITS = {
  login: { default: { limit: 5, ttl: MINUTE } },
  signup: { default: { limit: 5, ttl: 15 * MINUTE } },
  verifyEmail: { default: { limit: 10, ttl: 15 * MINUTE } },
  resendVerification: { default: { limit: 5, ttl: 15 * MINUTE } },
  refresh: { default: { limit: 20, ttl: 15 * MINUTE } },
  unsubscribe: { default: { limit: 20, ttl: 15 * MINUTE } },
};
```

Cada rota aplica o seu limite com `@Throttle(RATE_LIMITS.login)`, por exemplo. O limite geral (100 a cada 15 min) vem de `RATE_LIMIT_MAX_REQUESTS`.

## 6. Circuit breaker na HIBP

```typescript
// src/infra/http/hibp.client.ts
this.breaker = new CircuitBreaker(
  (email: string, truncate: boolean) => this.fetchBreachedAccount(email, truncate),
  {
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    rollingCountTimeout: 10000,
    rollingCountBuckets: 10,
    // 429 é limite de uso, não falha da HIBP: não deve abrir o circuito
    errorFilter: (err: unknown) => err instanceof HibpRateLimitError,
  },
);
this.breaker.on('open', () => log('warn', 'HibpClient', 'hibp.circuit_open'));
```

A requisição tem timeout de 10 s (Axios). A consulta estrita transforma 429, 401/403 e falhas em erros tipados (`HibpRateLimitError`, `HibpAuthError`, `HibpUnavailableError`), e um erro nunca vira "sem vazamentos".

## 7. Health check

```typescript
// src/modules/health/health.controller.ts
@Get()
async check(): Promise<HealthStatus> {
  const health = await this.healthService.getHealth(); // SELECT 1 e PING, com timeout de 2 s

  // 503 faz o HEALTHCHECK do Docker e o ALB perceberem que a instância não está saudável
  if (health.status !== 'ok') {
    throw new ServiceUnavailableException(health);
  }
  return health;
}
```

## 8. Prisma com concorrência

Registrar os vazamentos de um usuário precisa funcionar mesmo com duas checagens ao mesmo tempo. O índice único em `(userId, breachName)` decide quem grava:

```typescript
// src/modules/breaches/user-breach.repository.ts
async recordKnown(userId: number, names: string[], source: UserBreachSource): Promise<string[]> {
  const known = await this.getKnownNames(userId);
  const candidates = Array.from(new Set(names)).filter(name => !known.has(name));
  const inserted: string[] = [];

  for (const breachName of candidates) {
    try {
      await this.prisma.userBreach.create({ data: { userId, breachName, source } });
      inserted.push(breachName);
    } catch (error) {
      // Outra execução registrou o mesmo vazamento entre a leitura e a inserção
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return inserted; // só os nomes realmente novos geram alerta
}
```

## 9. Testes

Teste unitário do motor de risco com o exemplo do documento do projeto:

```typescript
// tests/unit/example.spec.ts
it('aggregates breaches of different ages into the high band', () => {
  const result = riskEngine.calculate([
    breachWith(['Passwords', 'IP addresses', 'Names'], '2026-03-15', 'LojaX'),
    breachWith(['Password hints', 'Usernames'], '2023-09-10', 'ServicoY'),
    breachWith(['Credit cards', 'Phone numbers'], '2025-09-20', 'PlataformaZ'),
  ]);

  // 15 * 1.0 + 10 * 0.7 + 15 * 1.0 = 37 -> 74
  expect(result.subscores.map(sub => sub.score)).toEqual([15, 7, 15]);
  expect(result.totalScore).toBe(74);
  expect(result.classification).toBe('HIGH');
});
```

Fuzz testing com fast-check: a propriedade vale para qualquer lista de vazamentos gerada:

```typescript
// tests/unit/risk.engine.fuzz.spec.ts
it('never lowers the score when a new breach is found', () => {
  fc.assert(
    fc.property(breaches, breach, (list, extra) => {
      expect(engine.calculate([...list, extra]).totalScore)
        .toBeGreaterThanOrEqual(engine.calculate(list).totalScore);
    }),
    { numRuns: 300 },
  );
});
```

## 10. Ambiente local com Docker

```yaml
# server/docker-compose.yml (trecho)
redis:
  image: redis:7-alpine
  # Igual à produção (parameter group safeid-redis-queues): o BullMQ exige noeviction
  command: ["redis-server", "--maxmemory-policy", "noeviction"]
  ports:
    - "6379:6379"
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
```

```bash
docker compose up -d postgres redis
npm run dev   # aplica as migrations e sobe a API
```

Passo a passo em [SETUP.md](./SETUP.md).

---

**Atualizado em:** 17/10/2026
