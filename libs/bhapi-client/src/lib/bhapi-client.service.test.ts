import { describe, expect, it, vi } from 'vitest';
import { BhApiClientService } from './bhapi-client.service';
import type { ConfigService } from '@nestjs/config';

vi.mock('axios', () => {
  return {
    default: {
      create: () => ({
        get: vi.fn(async () => ({ data: { ok: true } })),
      }),
    },
  };
});

// Minimal Bottleneck mock: enough for BhApiClientService construction + getRemainingTokens().
vi.mock('bottleneck', () => {
  class FakeLimiter {
    private handlers = new Map<string, (arg: unknown) => void>();
    currentReservoir = vi.fn(async () => null);
    schedule = vi.fn(async (fn: () => unknown) => fn());
    stop = vi.fn(async () => undefined);
    disconnect = vi.fn(async () => undefined);
    updateSettings = vi.fn(async () => undefined);
    on(event: string, handler: (arg: unknown) => void) {
      this.handlers.set(event, handler);
    }
    emit(event: string, arg: unknown) {
      const h = this.handlers.get(event);
      if (h) h(arg);
    }
  }

  class IORedisConnection {}

  const BottleneckCtor = function () {
    return new FakeLimiter();
  } as unknown as {
    new (): FakeLimiter;
    IORedisConnection: typeof IORedisConnection;
  };

  BottleneckCtor.IORedisConnection = IORedisConnection;
  return { default: BottleneckCtor };
});

vi.mock('ioredis', () => {
  return {
    default: class FakeRedis {
      quit = vi.fn(async () => undefined);
      disconnect = vi.fn(() => undefined);
      constructor(url: string) {
        void url;
      }
    },
  };
});

describe('bhapi-client/BhApiClientService', () => {
  it('getRemainingTokens returns 0 when reservoir is null', async () => {
    const config = {
      getOrThrow: (key: string) => {
        if (key === 'REDIS_URL') return 'redis://localhost:6379';
        if (key === 'BRAWLHALLA_API_KEY') return 'test';
        throw new Error(`missing ${key}`);
      },
    } as unknown as ConfigService;

    const svc = new BhApiClientService(config);
    await expect(svc.getRemainingTokens()).resolves.toBe(0);
  });
});
