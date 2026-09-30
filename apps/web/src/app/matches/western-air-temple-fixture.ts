type RawPower = {
  EnemyDamage?: number
  EnemyHits?: number
  EnemyKOs?: number
  Uses?: number
  GCEnemyDamage?: number
  GCEnemyHits?: number
  GCUses?: number
}

type RawEquipment = {
  timeHeldMs: number
  damageTaken: number
  powers: Record<string, RawPower>
}

type RawPlayer = {
  slot: number
  name: string
  playerId: number
  legendId: number
  kos: number
  deaths: number
  suicides: number
  clashes: number
  damageDealt: number
  damageTaken: number
  dashes: number
  dodges: number
  jumps: number
  dashJumps: number
  airDodges: number
  airJumps: number
  groundTimeMs: number
  airTimeMs: number
  wallTimeMs: number
  equipment: Record<string, RawEquipment>
}

export const westernAirTempleFixture = {
  buildVersion: '10.09',
  durationMs: 152_704,
  format: 268,
  mapId: 212,
  mapName: 'Western Air Temple',
  lives: 3,
  players: [
    {
      slot: 0,
      name: 'Luy',
      playerId: 90_496_935,
      legendId: 64,
      kos: 3,
      deaths: 1,
      suicides: 0,
      clashes: 0,
      damageDealt: 553.89,
      damageTaken: 183.81,
      dashes: 68,
      dodges: 38,
      jumps: 106,
      dashJumps: 34,
      airDodges: 32,
      airJumps: 49,
      groundTimeMs: 44_800,
      airTimeMs: 102_992,
      wallTimeMs: 176,
      equipment: {
        Pistol: {
          timeHeldMs: 22_896,
          damageTaken: 44.21,
          powers: {
            dLight: { EnemyDamage: 13.4, Uses: 4, EnemyHits: 1 },
            Throw: { Uses: 2 },
            Recovery: { EnemyDamage: 8.25, Uses: 1, EnemyHits: 1 },
            sAir: { EnemyDamage: 32.99, EnemyKOs: 2, Uses: 5, EnemyHits: 2 },
            sLight: { EnemyDamage: 14.43, Uses: 2, EnemyHits: 1 },
          },
        },
        Boots: {
          timeHeldMs: 112_224,
          damageTaken: 139.6,
          powers: {
            dLight: {
              GCEnemyDamage: 18.56,
              Uses: 13,
              GCUses: 5,
              EnemyDamage: 30.93,
              GCEnemyHits: 3,
              EnemyHits: 5,
            },
            Recovery: { EnemyDamage: 69.08, Uses: 10, EnemyHits: 5 },
            nHeavy: {
              GCEnemyDamage: 21.26,
              Uses: 2,
              GCUses: 1,
              EnemyDamage: 42.53,
              GCEnemyHits: 1,
              EnemyHits: 2,
            },
            GroundPound: { Uses: 1 },
            dHeavy: { EnemyDamage: 49.47, EnemyKOs: 1, Uses: 3, EnemyHits: 2 },
            Throw: { Uses: 3 },
            nAir: { EnemyDamage: 98.98, Uses: 19, EnemyHits: 8 },
            nLight: { EnemyDamage: 13.4, Uses: 1, EnemyHits: 1 },
            sAir: { EnemyDamage: 114.44, Uses: 13, EnemyHits: 8 },
            sLight: { GCUses: 1, EnemyDamage: 53.61, EnemyHits: 4, Uses: 8 },
          },
        },
        Unarmed: {
          timeHeldMs: 12_848,
          damageTaken: 0,
          powers: {
            sHeavy: { Uses: 1 },
            Recovery: { Uses: 1 },
            nLight: { EnemyDamage: 12.37, Uses: 1, EnemyHits: 1 },
          },
        },
      },
    },
    {
      slot: 1,
      name: 'Svargach',
      playerId: 118_869_655,
      legendId: 27,
      kos: 1,
      deaths: 3,
      suicides: 0,
      clashes: 0,
      damageDealt: 183.81,
      damageTaken: 553.89,
      dashes: 34,
      dodges: 37,
      jumps: 75,
      dashJumps: 6,
      airDodges: 28,
      airJumps: 49,
      groundTimeMs: 35_504,
      airTimeMs: 106_736,
      wallTimeMs: 976,
      equipment: {
        Katar: {
          timeHeldMs: 91_632,
          damageTaken: 335.06,
          powers: {
            dLight: {
              GCEnemyDamage: 10.67,
              Uses: 7,
              GCUses: 2,
              EnemyDamage: 21.34,
              GCEnemyHits: 1,
              EnemyHits: 2,
            },
            Recovery: { Uses: 10 },
            GroundPound: { Uses: 1 },
            sHeavy: { Uses: 2 },
            sLight: { EnemyDamage: 23.28, Uses: 6, EnemyHits: 3 },
            nAir: { EnemyDamage: 21.34, EnemyKOs: 1, Uses: 12, EnemyHits: 2 },
            nLight: { EnemyDamage: 34.92, Uses: 4, EnemyHits: 3 },
            sAir: { EnemyDamage: 13.58, Uses: 2, EnemyHits: 1 },
            Throw: { EnemyDamage: 1.31, Uses: 3, EnemyHits: 1 },
            dAir: { EnemyDamage: 34.11, Uses: 10, EnemyHits: 4 },
          },
        },
        Scythe: {
          timeHeldMs: 15_408,
          damageTaken: 89.7,
          powers: {
            Throw: { Uses: 4 },
            sAir: { Uses: 2 },
            sHeavy: { Uses: 1 },
            sLight: { EnemyDamage: 10.67, Uses: 1, EnemyHits: 1 },
            dAir: { EnemyDamage: 12.61, Uses: 2, EnemyHits: 1 },
          },
        },
        Unarmed: {
          timeHeldMs: 36_176,
          damageTaken: 129.13,
          powers: {
            dHeavy: { Uses: 1 },
            dLight: { Uses: 1, GCUses: 1 },
            Recovery: { Uses: 1 },
            nAir: { EnemyDamage: 10.67, Uses: 2, EnemyHits: 1 },
          },
        },
      },
    },
  ] satisfies RawPlayer[],
} as const
