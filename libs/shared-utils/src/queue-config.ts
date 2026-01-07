/**
 * Shared BullMQ queue configuration constants
 */

export const REFRESH_QUEUE_NAME = 'refresh-queue';

export const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: 100,
  removeOnFail: 500,
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 1000,
  },
};

/**
 * Creates BullMQ connection configuration from a Redis URL
 */
export function createBullConnection(redisUrl: string) {
  return {
    connection: {
      url: redisUrl,
    },
  };
}
