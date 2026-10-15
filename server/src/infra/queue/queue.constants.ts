// Filas (uma só fila para a HIBP: o limiter é por fila, duas filas somariam os limites)
export const QUEUE_HIBP = 'hibp-check';
export const QUEUE_MONITORING = 'monitoring';
export const QUEUE_EMAIL = 'email';

// Jobs da fila hibp-check
export const JOB_CHECK_HIBP = 'check-hibp';
export const JOB_MONITOR_CHECK = 'monitor-check';

// Jobs da fila monitoring
export const JOB_CATALOG_PROBE = 'catalog-probe';
export const JOB_CATALOG_SYNC = 'catalog-sync';
export const JOB_MONITOR_SWEEP = 'monitor-sweep';
export const JOB_MONITOR_PROCESS = 'monitor-process';
export const JOB_CLEANUP_UNVERIFIED = 'cleanup-unverified';
export const JOB_HIBP_PLAN_CHECK = 'hibp-plan-check';
export const JOB_MONITORING_RECONCILE = 'monitoring-reconcile';

// Jobs da fila email
export const JOB_SEND_VERIFICATION_EMAIL = 'send-verification-email';
export const JOB_SEND_NEW_BREACH_ALERT = 'send-new-breach-alert';

// Prioridade do monitor-check: o scan interativo (sem priority) sempre passa na frente
export const MONITOR_CHECK_PRIORITY = 10;

// Tokens de injeção
export const REDIS_QUEUE_CONNECTION = 'REDIS_QUEUE_CONNECTION';
export const HIBP_QUEUE = 'HIBP_QUEUE';
export const MONITORING_QUEUE = 'MONITORING_QUEUE';
export const EMAIL_QUEUE = 'EMAIL_QUEUE';
export const HIBP_CLIENT = 'HIBP_CLIENT';
export const HIBP_CATALOG_CLIENT = 'HIBP_CATALOG_CLIENT';

// Pub/sub: o RPM do plano HIBP mudou, os workers recriam o limiter
export const HIBP_PLAN_CHANGED_CHANNEL = 'hibp:plan:changed';
