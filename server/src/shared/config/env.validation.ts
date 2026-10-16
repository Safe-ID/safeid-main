/**
 * Verificação das variáveis de ambiente
 * Roda quando o ConfigModule carrega o .env e avisa no log se um segredo
 * estiver faltando ou ainda com o valor de exemplo. Não impede o app de subir.
 */

type EnvConfig = Record<string, unknown>;

// Segredos que precisam existir em qualquer ambiente
const REQUIRED_SECRETS = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET'];

// Segredos que só são obrigatórios em produção
// MONITORING_UNSUBSCRIBE_SECRET assina o link de opt-out dos alertas
const REQUIRED_IN_PRODUCTION = ['SESSION_SECRET', 'MONITORING_UNSUBSCRIBE_SECRET'];

// Valores de exemplo do .env.example e fallbacks antigos que não podem ir para produção
const PLACEHOLDER_PATTERN = /^your_.*_here$/i;
const KNOWN_WEAK_VALUES = [
  'local-session-secret',
  'safeid-google-state',
  'changeme',
  'change_me',
  'change_me_32_bytes_min',
  'secret',
];

// Segredos de HMAC com tamanho mínimo
const MIN_LENGTH: Record<string, number> = { MONITORING_UNSUBSCRIBE_SECRET: 32 };

function isWeakSecret(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value) || KNOWN_WEAK_VALUES.includes(value.toLowerCase());
}

export function findEnvProblems(config: EnvConfig): string[] {
  const isProduction = config.NODE_ENV === 'production';
  const required = isProduction
    ? [...REQUIRED_SECRETS, ...REQUIRED_IN_PRODUCTION]
    : REQUIRED_SECRETS;

  const problems: string[] = [];

  for (const name of required) {
    const value = typeof config[name] === 'string' ? (config[name] as string).trim() : '';

    if (!value) {
      problems.push(`${name} não está definida`);
    } else if (isWeakSecret(value)) {
      problems.push(`${name} ainda está com o valor de exemplo`);
    } else if (MIN_LENGTH[name] && value.length < MIN_LENGTH[name]) {
      problems.push(`${name} precisa ter pelo menos ${MIN_LENGTH[name]} caracteres`);
    }
  }

  // Com o mesmo segredo, o refresh token funcionaria como access token
  if (config.JWT_SECRET && config.JWT_SECRET === config.REFRESH_TOKEN_SECRET) {
    problems.push('REFRESH_TOKEN_SECRET precisa ser diferente de JWT_SECRET');
  }

  return problems;
}

export function validateEnv(config: EnvConfig): EnvConfig {
  const problems = findEnvProblems(config);

  if (problems.length > 0) {
    console.warn(
      `[Config] Atenção: ${problems.join('; ')}. Confira o arquivo .env (use o .env.example como modelo).`,
    );
  }

  return config;
}
