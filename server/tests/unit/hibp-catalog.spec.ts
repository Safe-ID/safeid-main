import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { HibpCatalogClient } from '../../src/infra/http/hibp-catalog.client';
import { MockHibpCatalogClient } from '../../src/infra/http/hibp-catalog.mock';
import { MockHibpClient } from '../../src/infra/http/hibp.mock';
import { HibpRateLimitError, HibpUnavailableError } from '../../src/infra/http/hibp.errors';

jest.mock('axios');

describe('HibpCatalogClient', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  let mockGet: jest.Mock<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGet = jest.fn();
    mockedAxios.create.mockReturnValue({ get: mockGet } as any);
  });

  it('calls the public endpoints without the API key header', () => {
    new HibpCatalogClient();

    const config = mockedAxios.create.mock.calls[0][0] as any;
    expect(config.headers).toEqual({ 'User-Agent': 'safeid-backend' });
    expect(config.timeout).toBe(30000);
  });

  it('lists all breaches', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ Name: 'Adobe' }] });
    await expect(new HibpCatalogClient().getAllBreaches()).resolves.toEqual([{ Name: 'Adobe' }]);
    expect(mockGet).toHaveBeenCalledWith('/breaches');

    mockGet.mockResolvedValueOnce({ data: null });
    await expect(new HibpCatalogClient().getAllBreaches()).resolves.toEqual([]);
  });

  it('gets one breach and returns null on 404', async () => {
    const client = new HibpCatalogClient();
    mockGet.mockResolvedValueOnce({ data: { Name: 'Adobe' } });
    await expect(client.getBreach('Adobe Inc')).resolves.toEqual({ Name: 'Adobe' });
    expect(mockGet).toHaveBeenCalledWith('/breach/Adobe%20Inc');

    mockGet.mockRejectedValueOnce({ response: { status: 404 } });
    await expect(client.getBreach('Missing')).resolves.toBeNull();
  });

  it('gets the latest breach and returns null on 404', async () => {
    const client = new HibpCatalogClient();
    mockGet.mockResolvedValueOnce({ data: { Name: 'Newest' } });
    await expect(client.getLatestBreach()).resolves.toEqual({ Name: 'Newest' });
    expect(mockGet).toHaveBeenCalledWith('/latestbreach');

    mockGet.mockRejectedValueOnce({ response: { status: 404 } });
    await expect(client.getLatestBreach()).resolves.toBeNull();
  });

  it('maps failures to typed errors', async () => {
    const client = new HibpCatalogClient();
    mockGet.mockRejectedValueOnce({ response: { status: 503 } });
    await expect(client.getAllBreaches()).rejects.toBeInstanceOf(HibpUnavailableError);

    mockGet.mockRejectedValueOnce({ response: { status: 429, headers: { 'retry-after': '5' } } });
    await expect(client.getBreach('Adobe')).rejects.toBeInstanceOf(HibpRateLimitError);

    mockGet.mockRejectedValueOnce({ message: 'socket hang up' });
    await expect(client.getLatestBreach()).rejects.toBeInstanceOf(HibpUnavailableError);
  });
});

describe('MockHibpCatalogClient', () => {
  const fixturePath = resolve(__dirname, '../fixtures/hibp-breaches.json');

  afterEach(() => {
    delete process.env.HIBP_CATALOG_FIXTURE;
    jest.restoreAllMocks();
  });

  it('serves the fixture, including the breaches used by the HIBP mock', async () => {
    const client = new MockHibpCatalogClient(fixturePath);
    const names = (await client.getAllBreaches()).map(breach => breach.Name);

    expect(names).toEqual(expect.arrayContaining(['Equifax', 'LinkedIn', 'TestBreach']));
    expect(names.length).toBeGreaterThanOrEqual(5);
    await expect(client.getBreach('linkedin')).resolves.toMatchObject({ Name: 'LinkedIn' });
    await expect(client.getBreach('Missing')).resolves.toBeNull();
    await expect(client.getLatestBreach()).resolves.toMatchObject({ Name: 'ShopBR' });
  });

  it('simulates new and modified breaches between syncs and resets to the fixture', async () => {
    const client = new MockHibpCatalogClient(fixturePath);

    client.addBreach({
      Name: 'BrandNew',
      Title: 'Brand New',
      BreachDate: '2026-10-01',
      AddedDate: '2026-10-15T00:00:00Z',
      DataClasses: ['Passwords'],
      IsVerified: true,
    });
    client.updateBreach('LinkedIn', { ModifiedDate: '2026-10-15T00:00:00Z' });

    await expect(client.getLatestBreach()).resolves.toMatchObject({ Name: 'BrandNew' });
    await expect(client.getBreach('LinkedIn')).resolves.toMatchObject({ ModifiedDate: '2026-10-15T00:00:00Z' });

    client.reset();
    await expect(client.getBreach('BrandNew')).resolves.toBeNull();
  });

  it('reads the fixture path from HIBP_CATALOG_FIXTURE and tolerates a missing file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hibp-catalog-'));
    const customPath = join(dir, 'catalog.json');
    writeFileSync(customPath, JSON.stringify([{ Name: 'Only', Title: 'Only', BreachDate: '2020-01-01', DataClasses: [], IsVerified: true }]));
    process.env.HIBP_CATALOG_FIXTURE = customPath;

    await expect(new MockHibpCatalogClient().getAllBreaches()).resolves.toHaveLength(1);

    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const empty = new MockHibpCatalogClient(join(dir, 'missing.json'));
    await expect(empty.getAllBreaches()).resolves.toEqual([]);
    await expect(empty.getLatestBreach()).resolves.toBeNull();

    writeFileSync(customPath, JSON.stringify({ not: 'an array' }));
    await expect(new MockHibpCatalogClient(customPath).getAllBreaches()).resolves.toEqual([]);
  });
});

describe('MockHibpClient', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns names only for the truncated strict lookup, like the real API', async () => {
    const client = new MockHibpClient(0);

    await expect(client.getBreachedAccountStrict('Breached@Example.com')).resolves.toEqual([
      { Name: 'Equifax' },
      { Name: 'LinkedIn' },
    ]);
    await expect(client.getBreachedAccountStrict('test@example.com', { truncate: false })).resolves.toEqual([
      expect.objectContaining({ Name: 'TestBreach', DataClasses: ['Email addresses', 'Passwords'] }),
    ]);
    await expect(client.getBreachedAccountStrict('nobody@example.com')).resolves.toEqual([]);
  });

  it('simulates a new breach between two checks and resets', async () => {
    const client = new MockHibpClient(0);
    const breach = { Name: 'ShopBR', Title: 'ShopBR', BreachDate: '2025-11-03', DataClasses: ['Passwords'], IsVerified: true };

    client.addBreachForTesting('Clean@Example.com', breach);
    client.addBreachForTesting('clean@example.com', breach);
    await expect(client.getBreachedAccountStrict('clean@example.com')).resolves.toEqual([{ Name: 'ShopBR' }]);

    client.reset();
    await expect(client.getBreachedAccountStrict('clean@example.com')).resolves.toEqual([]);
  });

  it('does not log the e-mail and exposes a Core 1 subscription', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const client = new MockHibpClient(0);

    await client.checkAccount('breached@example.com');

    expect(logSpy.mock.calls.flat().join(' ')).not.toContain('breached@example.com');
    await expect(client.getSubscriptionStatus()).resolves.toMatchObject({ Rpm: 10 });
  });
});
