import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import axios from 'axios';
import { createHash } from 'crypto';
import { HibpClient } from '../../src/infra/http/hibp.client';

jest.mock('axios');

describe('HibpClient', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an empty list when the API key is missing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockedAxios.create.mockReturnValue({
      get: jest.fn(),
    } as any);

    const client = new HibpClient({ apiKey: '' });
    await expect(client.checkAccount('user@example.com')).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      '[HIBP Client] HIBP_API_KEY not configured. Returning empty result in degraded mode.'
    );

    warnSpy.mockRestore();
  });

  it('falls back to the range endpoint when direct lookup is unauthorized', async () => {
    const email = 'test@example.com';
    const sha1 = createHash('sha1').update(email.trim().toLowerCase()).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 6);
    const suffix = sha1.slice(6);

    const mockGet = jest.fn() as any;
    mockGet
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({
        data: [
          {
            hashSuffix: suffix,
            websites: ['ExampleSite'],
          },
        ],
      })
      .mockResolvedValueOnce({
        data: {
          Name: 'ExampleSite',
          Title: 'Example breach',
          BreachDate: '2024-01-01',
          DataClasses: ['Email addresses'],
          IsVerified: true,
        },
      });

    mockedAxios.create.mockReturnValue({
      get: mockGet,
    } as any);

    const client = new HibpClient({ apiKey: 'secret-key' });
    const result = await client.checkAccount(email);

    expect(result).toEqual([
      expect.objectContaining({
        Name: 'ExampleSite',
        Title: 'Example breach',
      }),
    ]);
    expect(mockGet).toHaveBeenNthCalledWith(1, `/breachedaccount/${encodeURIComponent(email)}`, {
      params: { truncateResponse: false },
    });
    expect(mockGet).toHaveBeenNthCalledWith(2, `/breachedaccount/range/${prefix}`);
    expect(mockGet).toHaveBeenNthCalledWith(3, `/breach/${encodeURIComponent('ExampleSite')}`);
  });

  it('returns an empty array for a 404 direct lookup and rethrows other failures', async () => {
    const mockGet = jest.fn() as any;
    mockGet.mockRejectedValue({ response: { status: 404 } });
    mockedAxios.create.mockReturnValue({ get: mockGet } as any);

    const client = new HibpClient({ apiKey: 'secret-key' });
    await expect(client.checkAccount('clean@example.com')).resolves.toEqual([]);

    const clientTwo = new HibpClient({ apiKey: 'secret-key' });
    mockGet.mockRejectedValueOnce({ response: { status: 500 }, message: 'Server error' });
    await expect(clientTwo.checkAccount('broken@example.com')).rejects.toMatchObject({
      response: { status: 500 },
      message: 'Server error',
    });
  });

  it('accepts alternative range response shapes and deduplicates websites', async () => {
    const email = 'dupe@example.com';
    const sha1 = createHash('sha1').update(email.trim().toLowerCase()).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 6);
    const suffix = sha1.slice(6);

    const mockGet = jest.fn() as any;
    mockGet
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({
        data: [
          {
            hashSuffix: suffix,
            Websites: ['ExampleSite', 'ExampleSite'],
          },
        ],
      })
      .mockResolvedValueOnce({
        data: {
          Name: 'ExampleSite',
          Title: 'Example breach',
          BreachDate: '2024-03-01',
          DataClasses: ['Email addresses'],
          IsVerified: true,
        },
      });

    mockedAxios.create.mockReturnValue({ get: mockGet } as any);

    const client = new HibpClient({ apiKey: 'secret-key' });
    await expect(client.checkAccount(email)).resolves.toEqual([
      expect.objectContaining({ Name: 'ExampleSite', Title: 'Example breach' }),
    ]);

    expect(mockGet).toHaveBeenNthCalledWith(2, `/breachedaccount/range/${prefix}`);
    expect(mockGet).toHaveBeenNthCalledWith(3, `/breach/${encodeURIComponent('ExampleSite')}`);
  });

  it('returns an empty array when the range lookup is forbidden or the breaker is open', async () => {
    const email = 'test@example.com';
    const sha1 = createHash('sha1').update(email.trim().toLowerCase()).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 6);

    const mockGet = jest.fn() as any;
    mockGet
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ data: [{ hashSuffix: 'OTHER', websites: ['OtherSite'] }] });

    mockedAxios.create.mockReturnValue({ get: mockGet } as any);

    const client = new HibpClient({ apiKey: 'secret-key' });
    await expect(client.checkAccount(email)).resolves.toEqual([]);

    const breakerClient = new HibpClient({ apiKey: 'secret-key' });
    const breaker = { fire: jest.fn() } as any;
    breaker.fire.mockRejectedValue({ message: 'Circuit breaker is open' });
    Object.defineProperty(breakerClient, 'breaker', {
      value: breaker,
      configurable: true,
    });

    await expect(breakerClient.checkAccount(email)).resolves.toEqual([]);
    expect(mockGet).toHaveBeenNthCalledWith(1, `/breachedaccount/${encodeURIComponent(email)}`, {
      params: { truncateResponse: false },
    });
    expect(mockGet).toHaveBeenNthCalledWith(2, `/breachedaccount/range/${prefix}`);

    const forbiddenClient = new HibpClient({ apiKey: 'secret-key' });
    const forbiddenBreaker = { fire: jest.fn() as any };
    forbiddenBreaker.fire.mockRejectedValue({ response: { status: 403 }, message: 'Forbidden' });
    Object.defineProperty(forbiddenClient, 'breaker', {
      value: forbiddenBreaker,
      configurable: true,
    });
    await expect(forbiddenClient.checkAccount('blocked@example.com')).resolves.toEqual([]);
  });
});
