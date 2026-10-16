/**
 * Papel do processo (APP_ROLE):
 * - all (padrão): API HTTP + workers + agendamentos, numa task só
 * - api: só a API; produz jobs, mas não processa
 * - worker: só workers e agendamentos, sem porta HTTP
 * Permite separar o worker numa service ECS própria sem mudar código.
 */
export type AppRole = 'all' | 'api' | 'worker';

const ROLES: AppRole[] = ['all', 'api', 'worker'];

export function getAppRole(): AppRole {
  const configured = (process.env.APP_ROLE || '').trim().toLowerCase();
  return (ROLES as string[]).includes(configured) ? (configured as AppRole) : 'all';
}

export function runsWorkers(): boolean {
  return getAppRole() !== 'api';
}

export function servesHttp(): boolean {
  return getAppRole() !== 'worker';
}
