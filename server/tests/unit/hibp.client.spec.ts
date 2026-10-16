import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import { HibpClient } from '../../src/infra/http/hibp.client';
import {
  HibpAuthError,
  HibpError,
  HibpRateLimitError,
  HibpUnavailableError,
  toHibpError,
} from '../../src/infra/http/hibp.errors';

jest.mock('axios');

describe('HibpClient', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  let mockGet: jest.Mock<any>;
  const clients: HibpClient[] = [];

  const createClient = (apiKey = 'test-key') => {
    const client = new HibpClient({ apiKey });
    clients.push(client);
    return client;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGet = jest.fn();
    mockedAxios.create.mockReturnValue({ get: mockGet } as any);
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map(client => client.shutdown()));
    jest.restoreAllMocks();
  });

  describe('getBreachedAccountStrict', () => {
    it('requests the truncated response by default and returns the names', async () => {
      mockGet.mockResolvedValueOnce({ data: [{ Name: 'Adobe' }, { Name: 'LinkedIn' }] });

      const result = await createClient().getBreachedAccountStrict('user@example.com');

      expect(result).toEqual([{ Name: 'Adobe' }, { Name: 'LinkedIn' }]);
      expect(mockGet).toHaveBeenCalledWith('/breachedaccount/user%40example.com', {
        params: { truncateResponse: true },
      });
    });

    it('returns an empty list only for 404 (account without breaches)', async () => {
      mockGet.mockRejectedValueOnce({ response: { status: 404 } });

      await expect(createClient().getBreachedAccountStrict('clean@example.com')).resolves.toEqual([]);
    });

    it('maps 429 to HibpRateLimitError using the retry-after header', async () => {
      mockGet.mockRejectedValueOnce({ response: { status: 429, headers: { 'retry-after': '3' } } });

      const error = await createClient().getBreachedAccountStrict('user@example.com').catch(err => err);

      expect(error).toBeInstanceOf(HibpRateLimitError);
      expect(error.retryAfterMs).toBe(3000);
      expect(error.status).toBe(429);
    });

    it.each([401, 403])('maps %i to HibpAuthError', async status => {
      mockGet.mockRejectedValueOnce({ response: { status } });

      await expect(createClient().getBreachedAccountStrict('user@example.com')).rejects.toBeInstanceOf(HibpAuthError);
    });

    it('maps 5xx and network failures to HibpUnavailableError', async () => {
      const client = createClient();
      mockGet.mockRejectedValueOnce({ response: { status: 503 } });
      await expect(client.getBreachedAccountStrict('user@example.com')).rejects.toBeInstanceOf(HibpUnavailableError);

      mockGet.mockRejectedValueOnce({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' });
      await expect(client.getBreachedAccountStrict('user@example.com')).rejects.toBeInstanceOf(HibpUnavailableError);
    });

    it('throws HibpAuthError instead of returning [] when the API key is missing', async () => {
      await expect(createClient('').getBreachedAccountStrict('user@example.com')).rejects.toBeInstanceOf(HibpAuthError);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('never calls the k-anonymity range endpoint (not available on Core plans)', async () => {
      mockGet.mockRejectedValueOnce({ response: { status: 401 } });

      await createClient().getBreachedAccountStrict('user@example.com').catch(() => undefined);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet.mock.calls.some(call => String(call[0]).includes('/range/'))).toBe(false);
    });

    it('does not open the circuit on rate limits', async () => {
      const client = createClient();

      mockGet.mockRejectedValue({ response: { status: 429, headers: {} } });
      for (let i = 0; i < 10; i++) {
        await expect(client.getBreachedAccountStrict('user@example.com')).rejects.toBeInstanceOf(HibpRateLimitError);
      }

      // O circuito continua fechado: a próxima chamada chega à HIBP
      mockGet.mockResolvedValueOnce({ data: [{ Name: 'Adobe' }] });
      await expect(client.getBreachedAccountStrict('user@example.com')).resolves.toEqual([{ Name: 'Adobe' }]);
      expect(mockGet).toHaveBeenCalledTimes(11);
    });

    it('opens the circuit on repeated failures and reports it as unavailable', async () => {
      const client = createClient();

      mockGet.mockRejectedValue({ response: { status: 500 } });
      for (let i = 0; i < 6; i++) {
        await client.getBreachedAccountStrict('user@example.com').catch(() => undefined);
      }

      // Com o circuito aberto, a HIBP nem é chamada e o erro é "indisponível"
      const callsBefore = mockGet.mock.calls.length;
      await expect(client.getBreachedAccountStrict('user@example.com')).rejects.toBeInstanceOf(HibpUnavailableError);
      expect(mockGet.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('checkAccount (manual scan)', () => {
    it('requests the full breach data', async () => {
      mockGet.mockResolvedValueOnce({ data: [{ Name: 'Adobe', DataClasses: ['Passwords'] }] });

      await expect(createClient().checkAccount('user@example.com')).resolves.toEqual([
        { Name: 'Adobe', DataClasses: ['Passwords'] },
      ]);
      expect(mockGet).toHaveBeenCalledWith('/breachedaccount/user%40example.com', {
        params: { truncateResponse: false },
      });
    });

    it('keeps the degraded mode for a missing key, auth errors and outages', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const noKey = createClient('');
      await expect(noKey.checkAccount('user@example.com')).resolves.toEqual([]);
      await expect(noKey.checkAccount('user@example.com')).resolves.toEqual([]);
      expect(
        warnSpy.mock.calls.filter(call => String(call[0]).includes('HIBP_API_KEY not configured')),
      ).toHaveLength(1);

      const client = createClient();
      mockGet.mockRejectedValueOnce({ response: { status: 401 } });
      await expect(client.checkAccount('user@example.com')).resolves.toEqual([]);

      mockGet.mockRejectedValueOnce({ response: { status: 502 } });
      await expect(client.checkAccount('user@example.com')).resolves.toEqual([]);
    });

    it('always propagates rate limits so the worker can wait and retry', async () => {
      mockGet.mockRejectedValueOnce({ response: { status: 429, headers: { 'retry-after': '1' } } });

      await expect(createClient().checkAccount('user@example.com')).rejects.toBeInstanceOf(HibpRateLimitError);
    });

    it('propagates unexpected client errors', async () => {
      mockGet.mockRejectedValueOnce({ response: { status: 400 } });

      const error = await createClient().checkAccount('bad').catch(err => err);
      expect(error).toBeInstanceOf(HibpError);
      expect(error.status).toBe(400);
    });
  });

  describe('getSubscriptionStatus', () => {
    it('returns the plan from /subscription/status', async () => {
      mockGet.mockResolvedValueOnce({ data: { SubscriptionName: 'Pwned 1', Rpm: 10 } });

      await expect(createClient().getSubscriptionStatus()).resolves.toEqual({ SubscriptionName: 'Pwned 1', Rpm: 10 });
      expect(mockGet).toHaveBeenCalledWith('/subscription/status');
    });

    it('maps errors and requires an API key', async () => {
      mockGet.mockRejectedValueOnce({ response: { status: 401 } });
      await expect(createClient().getSubscriptionStatus()).rejects.toBeInstanceOf(HibpAuthError);
      await expect(createClient('').getSubscriptionStatus()).rejects.toBeInstanceOf(HibpAuthError);
    });
  });
});

describe('toHibpError', () => {
  it('keeps HibpError instances and defaults retry-after to 2 s', () => {
    const original = new HibpUnavailableError('down');
    expect(toHibpError(original)).toBe(original);

    const rateLimit = toHibpError({ response: { status: 429, headers: { 'retry-after': 'abc' } } }) as HibpRateLimitError;
    expect(rateLimit.retryAfterMs).toBe(2000);
    expect(rateLimit.name).toBe('HibpRateLimitError');
  });
});
