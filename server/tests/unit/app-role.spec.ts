import { afterEach, describe, expect, it } from '@jest/globals';
import { getAppRole, runsWorkers, servesHttp } from '../../src/shared/config/app-role';

describe('APP_ROLE', () => {
  afterEach(() => {
    delete process.env.APP_ROLE;
  });

  it.each([
    [undefined, 'all', true, true],
    ['all', 'all', true, true],
    ['API', 'api', false, true],
    [' worker ', 'worker', true, false],
    ['something-else', 'all', true, true],
  ])('APP_ROLE=%s → %s (workers=%s, http=%s)', (value, role, workers, http) => {
    if (value === undefined) delete process.env.APP_ROLE;
    else process.env.APP_ROLE = value;

    expect(getAppRole()).toBe(role);
    expect(runsWorkers()).toBe(workers);
    expect(servesHttp()).toBe(http);
  });
});
