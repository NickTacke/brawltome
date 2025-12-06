import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PrismaService } from '@brawltome/database';
import { PlayerRankedLegendDTO, PlayerRankedTeamDTO, PlayerStatsLegendDTO } from '@brawltome/shared-types';

const STATS_MIN_TOKENS = 40;
const RANKED_MIN_TOKENS = 20;

@Processor('refresh-queue')
export class RefreshProcessor extends WorkerHost {
    private readonly logger = new Logger(RefreshProcessor.name);

    constructor(
        private bhApiClient: BhApiClientService,
        private prisma: PrismaService,
    ) {
        super();
    }

    async process(job: Job<{ id: number }>) {
        const { id } = job.data;
        const remainingTokens = await this.bhApiClient.getRemainingTokens();
        
        // Halt refreshing stats if we're on a low budget (more priority on ranked)
        if (remainingTokens < STATS_MIN_TOKENS && job.name === 'refresh-stats') {
            this.logger.warn(`Skipping stats refresh for ${id} (Tokens: ${remainingTokens})`);
            return;
        } else if (remainingTokens < RANKED_MIN_TOKENS && job.name === 'refresh-ranked') {
            this.logger.warn(`Skipping ranked refresh for ${id} (Tokens: ${remainingTokens})`);
            return;
        }

        if (job.name === 'refresh-ranked') {
            const data = await this.bhApiClient.getPlayerRanked(id);

            // Ranked upsert
            await this.prisma.$transaction(async (tx) => {
                await tx.player.update({
                    where: { brawlhallaId: id },
                    data: {
                        rating: data.rating,
                        peakRating: data.peak_rating,
                        tier: data.tier,
                        games: data.games,
                        wins: data.wins,
                        lastUpdated: new Date(),
                    },
                });

                await tx.playerRanked.upsert({
                    where: { brawlhallaId: id },
                    update: {
                        globalRank: data.global_rank,
                        regionRank: data.region_rank,
                        lastUpdated: new Date(),
                        legends: {
                            deleteMany: {},
                            create: this.mapLegends(data.legends),
                        },
                        teams: {
                            deleteMany: {},
                            create: this.mapTeams(data.teams),
                        },
                    },
                    create: {
                        brawlhallaId: id,
                        globalRank: data.global_rank,
                        regionRank: data.region_rank,
                        lastUpdated: new Date(),
                        legends: {
                            create: this.mapLegends(data.legends),
                        },
                        teams: {
                            create: this.mapTeams(data.teams),
                        },
                    },
                });
            });
        } else if (job.name === 'refresh-stats') {
            const data = await this.bhApiClient.getPlayerStats(id);

            await this.prisma.$transaction(async (tx) => {
                // If clan data is missing, ensure we clean up any existing clan record
                if (!data.clan) {
                    await tx.playerClan.deleteMany({
                        where: { brawlhallaId: id },
                    });
                }

                await tx.playerStats.upsert({
                    where: { brawlhallaId: id },
                    update: {
                        xp: data.xp,
                        level: data.level,
                        xpPercentage: data.xp_percentage,
                        games: data.games,
                        wins: data.wins,
                        damageBomb: data.damagebomb,
                        damageMine: data.damagemine,
                        damageSpikeball: data.damagespikeball,
                        damageSidekick: data.damagesidekick,
                        hitSnowball: data.hitsnowball,
                        koBomb: data.kobomb,
                        koMine: data.komine,
                        koSpikeball: data.kospikeball,
                        koSidekick: data.kosidekick,
                        koSnowball: data.kosnowball,
                        legends: {
                            deleteMany: {},
                            create: this.mapStatsLegends(data.legends),
                        },
                        clan: data.clan ? {
                            upsert: {
                                update: {
                                    clanName: data.clan.clan_name,
                                    clanId: data.clan.clan_id,
                                    clanXp: data.clan.clan_xp,
                                    clanLifetimeXp: data.clan.clan_lifetime_xp,
                                    personalXp: data.clan.personal_xp,
                                },
                                create: {
                                    clanName: data.clan.clan_name,
                                    clanId: data.clan.clan_id,
                                    clanXp: data.clan.clan_xp,
                                    clanLifetimeXp: data.clan.clan_lifetime_xp,
                                    personalXp: data.clan.personal_xp,
                                }
                            }
                        } : undefined,
                        lastUpdated: new Date(),
                    },
                    create: {
                        brawlhallaId: id,
                        xp: data.xp,
                        level: data.level,
                        xpPercentage: data.xp_percentage,
                        games: data.games,
                        wins: data.wins,
                        damageBomb: data.damagebomb,
                        damageMine: data.damagemine,
                        damageSpikeball: data.damagespikeball,
                        damageSidekick: data.damagesidekick,
                        hitSnowball: data.hitsnowball,
                        koBomb: data.kobomb,
                        koMine: data.komine,
                        koSpikeball: data.kospikeball,
                        koSidekick: data.kosidekick,
                        koSnowball: data.kosnowball,
                        legends: {
                            create: this.mapStatsLegends(data.legends),
                        },
                        clan: data.clan ? {
                            create: {
                                clanName: data.clan.clan_name,
                                clanId: data.clan.clan_id,
                                clanXp: data.clan.clan_xp,
                                clanLifetimeXp: data.clan.clan_lifetime_xp,
                                personalXp: data.clan.personal_xp,
                            }
                        } : undefined,
                        lastUpdated: new Date(),
                    },
                });
            });
        }
    }

    private mapLegends(legends: PlayerRankedLegendDTO[]) {
        return legends.map((legend) => ({
            legendId: legend.legend_id,
            rating: legend.rating,
            peakRating: legend.peak_rating,
            tier: legend.tier,
            wins: legend.wins,
            games: legend.games,
        }));
    }

    private mapTeams(teams: PlayerRankedTeamDTO[]) {
        return teams.map((team) => ({
            brawlhallaIdOne: team.brawlhalla_id_one,
            brawlhallaIdTwo: team.brawlhalla_id_two,
            teamName: team.teamname,
            rating: team.rating,
            peakRating: team.peak_rating,
            tier: team.tier,
            wins: team.wins,
            games: team.games,
        }));
    }

    private mapStatsLegends(legends: PlayerStatsLegendDTO[]) {
        return legends
        .filter((legend) => legend.legend_id !== 0)
        .map((legend) => ({
            legendId: legend.legend_id,
            legendNameKey: legend.legend_name_key,
            xp: legend.xp,
            level: legend.level,
            xpPercentage: legend.xp_percentage,
            games: legend.games,
            wins: legend.wins,
            matchTime: legend.matchtime,
            KOs: legend.kos,
            teamKOs: legend.teamkos,
            suicides: legend.suicides,
            falls: legend.falls,
            damageDealt: legend.damagedealt,
            damageTaken: legend.damagetaken,
            damageWeaponOne: legend.damageweaponone,
            damageWeaponTwo: legend.damageweapontwo,
            timeHeldWeaponOne: legend.timeheldweaponone,
            timeHeldWeaponTwo: legend.timeheldweapontwo,
            KOWeaponOne: legend.koweaponone,
            KOWeaponTwo: legend.koweapontwo,
            KOUnarmed: legend.kounarmed,
            KOThrownItem: legend.kothrownitem,
            KOGadgets: legend.kogadgets,
            damageUnarmed: legend.damageunarmed,
            damageThrownItem: legend.damagethrownitem,
            damageGadgets: legend.damagegadgets
        }));
    }
}
