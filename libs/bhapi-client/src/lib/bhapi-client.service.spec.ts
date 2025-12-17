import { Test, TestingModule } from '@nestjs/testing';
import { BhApiClientService } from './bhapi-client.service';
import { ConfigService } from '@nestjs/config';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock ioredis - fake redis in memory
vi.mock('ioredis', async () => {
  const actual = await import('ioredis-mock');
  return {
    default: actual.default,
  };
});

// Mock bottleneck - force 'local' mode
vi.mock('bottleneck', async () => {
  const actual = await import('bottleneck');
  const Bottleneck = actual.default;

  return {
    default: class MockBottleneck extends Bottleneck {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(options: any) {
        super({
          ...options,
          datastore: 'local',
          connection: undefined,
        });
      }
    },
  };
});

// Mock axios - Mimic Brawlhalla API response
const { mockGet } = vi.hoisted(() => {
  return { mockGet: vi.fn() };
});
vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: mockGet,
    }),
  },
}));

describe('BhApiClientService (Rate Limiter Integration)', () => {
  let service: BhApiClientService;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set default return data, so service doesn't crash on undefined
    mockGet.mockResolvedValue({ data: { success: true } });

    // Config mock
    const mockConfig = {
      getOrThrow: (key: string) => {
        if (key === 'REDIS_URL') return 'redis://localhost:6379';
        if (key === 'BRAWLHALLA_API_KEY') return 'test-api-key';
        return null;
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BhApiClientService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<BhApiClientService>(BhApiClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.limiter).toBeDefined();
  });

  // ------------------------------------------------------------
  // Rate Limiter Tests
  // ------------------------------------------------------------

  it('enforces 100ms gap between requests (10/sec rate limit)', async () => {
    mockGet.mockResolvedValue({ data: { success: true } });

    const start = Date.now();
    const promises = [];

    for (let i = 0; i < 5; i++) {
      promises.push(service.getPlayerStats(1234567890));
    }

    await Promise.all(promises);
    const duration = Date.now() - start;

    // Shouldn't be instant
    // Should take roughly 350ms (leeway for test runner)
    expect(duration).toBeGreaterThanOrEqual(350);
    expect(mockGet).toHaveBeenCalledTimes(5);
  }, 10000);

  it('respects rate limit when hitting quota', async () => {
    mockGet.mockResolvedValue({ data: { success: true } });

    // Manually lower reservoir to 2 to test rate limit
    await service.limiter.updateSettings({
      reservoir: 2,
      reservoirRefreshAmount: 180,
      reservoirRefreshInterval: 15 * 60 * 1000,
    });

    // Fire 3 requests
    const p1 = service.getPlayerStats(1234567890);
    const p2 = service.getPlayerStats(1234567890);
    const p3 = service.getPlayerStats(1234567890);

    await new Promise((resolve) => setTimeout(resolve, 400));

    const counts = await service.limiter.counts();

    // Check if 2 requests actually finished (ask the spy)
    expect(mockGet).toHaveBeenCalledTimes(2);

    // Check if 1 request is still in the queue
    expect(counts.QUEUED).toBe(1);

    // Stop limiter and drop waiting jobs
    await service.limiter.stop({ dropWaitingJobs: true });

    // Ensure all promises resolve / reject, to avoid hanging tests
    await Promise.allSettled([p1, p2, p3]);
  }, 10000);

  // ------------------------------------------------------------
  // API Client Tests
  // ------------------------------------------------------------

  it('handles 429 rate limit errors', async () => {
    // Setup:
    // Call 1: Fails with 429 (Wait 1 second)
    // Call 2: Succeeds (the retry)
    mockGet
      .mockRejectedValueOnce({
        response: { status: 429, headers: { 'retry-after': '1' } },
        data: 'Too Many Requests',
      })
      .mockResolvedValueOnce({ data: { success: true } });

    const start = Date.now();

    // Make one call
    // Internally: Call -> 429 -> Wait 1 second -> Call -> Success
    await service.getPlayerRanked(1234567890);

    const duration = Date.now() - start;

    // Duration should be roughly 1 second + some leeway
    expect(duration).toBeGreaterThanOrEqual(1000);
    expect(mockGet).toHaveBeenCalledTimes(2);
  }, 10000);

  it('handles non-429 errors', async () => {
    mockGet.mockRejectedValue({
      response: { status: 500, data: 'Internal Server Error' },
    });

    // Throws 500, so expect a rejection
    await expect(service.getPlayerRanked(1234567890)).rejects.toThrow();

    // Call 1: Fails with 500 -> Retry once -> Call 2: Fails with 500 -> No retry
    expect(mockGet).toHaveBeenCalledTimes(2);
  }, 10000);

  // Simulating strict server
  it('survives server that enforces strict rate limits', async () => {
    let serverRequestCount = 0;
    let lastRequestTime = 0;

    mockGet.mockClear();

    mockGet.mockImplementation(async () => {
      const now = Date.now();
      const timeDiff = now - lastRequestTime;
      lastRequestTime = now;
      serverRequestCount++;

      // Simulate server logic
      // If requests come faster than 50ms, throw 429
      if (timeDiff < 120 && serverRequestCount > 1) {
        // Simulate API "banning" us
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const error = new Error('Too Many Requests') as any;
        error.response = { status: 429, headers: { 'retry-after': '1' } };
        throw error;
      }

      return { data: { id: serverRequestCount } };
    });

    // Fire 5 requests
    const promises = Array.from({ length: 5 }, (_, i) =>
      service.getPlayerRanked(1234567890 + i)
    );

    await Promise.all(promises);

    // If bottleneck is working correctly, we should have 5 requests
    // And no 429 errors
    expect(mockGet).toHaveBeenCalledTimes(5);
    expect(serverRequestCount).toBe(5);
  }, 10000);
});
