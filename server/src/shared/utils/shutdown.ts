import { log } from './logger';

/**
 * Fecha um recurso no shutdown sem interromper o fechamento dos outros se ele falhar
 */
export async function closeQuietly(resource: string, close: () => Promise<unknown>): Promise<void> {
  log('info', 'Shutdown', 'shutdown.closing', { resource });
  try {
    await close();
  } catch (error) {
    log('warn', 'Shutdown', 'shutdown.close_failed', { resource, err: error });
  }
}
