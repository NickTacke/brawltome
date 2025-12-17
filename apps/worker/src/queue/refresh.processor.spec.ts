import { Test, TestingModule } from '@nestjs/testing';
import { RefreshProcessor } from './refresh.processor';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PrismaService } from '@brawltome/database';
import { Job } from 'bullmq';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Mock Data Generators
const mockRankedData = {
  name: 'TestPlayer',
  rating: 1500,
  peak_rating: 1600,
  tier: 'Gold 1',
  games: 100,
  wins: 50,
  legends: [],
  '2v2': [],
};

const mockStatsData = {
  xp: 5000,
  level: 10,
  xp_percentage: 0.5,
  games: 50,
  wins: 25,
  damagebomb: 0,
  damagemine: 0,
  damagespikeball: 0,
  damagesidekick: 0,
  hitsnowball: 0,
  kobomb: 0,
  komine: 0,
  kospikeball: 0,
  kosidekick: 0,
  kosnowball: 0,
  legends: [
    {
      legend_id: 3, // Bödvar
      matchtime: 600,
      damageweaponone: '1000',
      damageweapontwo: '500',
      timeheldweaponone: 300,
      timeheldweapontwo: 300,
    },
  ],
  clan: {
    clan_name: 'TestClan',
    clan_id: 101,
    clan_xp: '999',
    personal_xp: 100,
  },
};

describe('RefreshProcessor', () => {
  let processor: RefreshProcessor;
  let apiClient: any;
  let prisma: any;
  let txMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // 2. Mock API Client
    apiClient = {
      getPlayerRanked: vi.fn(),
      getPlayerStats: vi.fn(),
    };

    // 3. Mock Transaction Client (tx)
    // This represents the temporary client inside prisma.$transaction(async (tx) => ...)
    txMock = {
      player: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      playerRanked: {
        upsert: vi.fn(),
      },
      playerStats: {
        upsert: vi.fn(),
      },
      playerClan: {
        deleteMany: vi.fn(),
      },
    };

    // 4. Mock Prisma Service
    prisma = {
      legend: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { legendId: 3, weaponOne: 'Hammer', weaponTwo: 'Sword' },
          ]),
      },
      // The transaction mock implementation simply runs the callback, passing our fake 'txMock'
      $transaction: vi.fn().mockImplementation(async (callback) => {
        return callback(txMock);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshProcessor,
        { provide: BhApiClientService, useValue: apiClient },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    processor = module.get<RefreshProcessor>(RefreshProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // RANKED REFRESH TESTS
  // -------------------------------------------------------------------------
  describe('process(refresh-ranked)', () => {
    const job = { name: 'refresh-ranked', data: { id: 123 } } as Job;

    it('updates player and upserts ranked stats', async () => {
      // Setup
      apiClient.getPlayerRanked.mockResolvedValue(mockRankedData);
      txMock.player.findUnique.mockResolvedValue({ name: 'OldName' });

      // Action
      await processor.process(job);

      // Assert: API called
      expect(apiClient.getPlayerRanked).toHaveBeenCalledWith(123);

      // Assert: Transaction wrapper used
      expect(prisma.$transaction).toHaveBeenCalled();

      // Assert: Player Update
      expect(txMock.player.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { brawlhallaId: 123 },
          data: expect.objectContaining({
            name: 'TestPlayer', // Name updated from DTO
            tier: 'Gold 1',
            rating: 1500,
          }),
        })
      );

      // Assert: Ranked Upsert
      expect(txMock.playerRanked.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { brawlhallaId: 123 },
        })
      );
    });

    it('updates aliases if name changed', async () => {
      apiClient.getPlayerRanked.mockResolvedValue({
        ...mockRankedData,
        name: 'NewName',
      });
      txMock.player.findUnique.mockResolvedValue({
        name: 'OldName',
        brawlhallaId: 123,
      });

      await processor.process(job);

      // Check alias upsert logic inside the update call
      expect(txMock.player.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'NewName',
            aliases: {
              upsert: expect.objectContaining({
                create: { key: 'oldname', value: 'OldName' },
              }),
            },
          }),
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // STATS REFRESH TESTS
  // -------------------------------------------------------------------------
  describe('process(refresh-stats)', () => {
    const job = { name: 'refresh-stats', data: { id: 123 } } as Job;

    it('calculates weapon stats and upserts player stats', async () => {
      // Setup
      apiClient.getPlayerStats.mockResolvedValue(mockStatsData);
      // We rely on the default mock for prisma.legend.findMany (Bödvar) defined in beforeEach

      // Action
      await processor.process(job);

      // Assert: API Called
      expect(apiClient.getPlayerStats).toHaveBeenCalledWith(123);

      // Assert: Legend cache fetched
      expect(prisma.legend.findMany).toHaveBeenCalled();

      // Assert: Stats Upsert
      expect(txMock.playerStats.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { brawlhallaId: 123 },
          create: expect.objectContaining({
            xp: 5000,
            matchTimeTotal: 600, // Derived from legends
            weaponStats: expect.objectContaining({
              create: expect.arrayContaining([
                expect.objectContaining({ weapon: 'Hammer' }), // Mapped from Bödvar
                expect.objectContaining({ weapon: 'Sword' }),
              ]),
            }),
          }),
        })
      );
    });

    it('uses cached legend map on second run', async () => {
      apiClient.getPlayerStats.mockResolvedValue(mockStatsData);

      // First Run
      await processor.process(job);
      expect(prisma.legend.findMany).toHaveBeenCalledTimes(1);

      // Second Run (Should hit internal Map, not DB)
      await processor.process(job);
      expect(prisma.legend.findMany).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // ERROR HANDLING
  // -------------------------------------------------------------------------
  it('throws UnrecoverableError for unknown job names', async () => {
    const badJob = { name: 'unknown-job', data: { id: 123 } } as Job;
    await expect(processor.process(badJob)).rejects.toThrow(/Unknown job name/);
  });
});
