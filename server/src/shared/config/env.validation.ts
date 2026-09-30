/**
 * Validação das variáveis de ambiente
 * Roda quando o ConfigModule carrega o .env: se um segredo obrigatório estiver
 * faltando ou ainda com o valor de exemplo, o app não sobe.
 */

type EnvConfig = Record<string, unknown>;

// Segredos que precisam existir em qualquer ambiente
const REQUIRED_SECRETS = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET'];

// Segredos que só são obrigatórios em produção
const REQUIRED_IN_PRODUCTION = ['SESSION_SECRET'];

// Valores de exemplo do .env.example e fallbacks antigos que não podem ir para produção
const PLACEHOLDER_PATTERN = /^your_.*_here$/i;
const KNOWN_WEAK_VALUES = ['local-session-secret', 'safeid-google-state', 'changeme', 'secret'];

function isWeakSecret(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value) || KNOWN_WEAK_VALUES.includes(value.toLowerCase());
}

export function validateEnv(config: EnvConfig): EnvConfig {
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
    }
  }

  // Com o mesmo segredo, o refresh token funcionaria como access token
  if (config.JWT_SECRET && config.JWT_SECRET === config.REFRESH_TOKEN_SECRET) {
    problems.push('REFRESH_TOKEN_SECRET precisa ser diferente de JWT_SECRET');
  }

  if (problems.length > 0) {
    throw new Error(
      `Configuração inválida: ${problems.join('; ')}. Confira o arquivo .env (use o .env.example como modelo).`,
    );
  }

  return config;
}
