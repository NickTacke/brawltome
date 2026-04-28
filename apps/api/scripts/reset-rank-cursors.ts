import Redis from 'ioredis'

const REGIONS = ['us-e', 'eu', 'sea', 'brz', 'aus', 'us-w', 'jpn', 'me', 'sa'] as const

async function main() {
  const url = process.env.REDIS_URL
  if (!url) {
    console.error('REDIS_URL is not set')
    process.exit(1)
  }
  const redis = new Redis(url)

  const keys: string[] = ['cursor:cold:1v1', 'cursor:cold:2v2']
  for (const r of REGIONS) {
    keys.push(`cursor:region:1v1:${r}`)
    keys.push(`cursor:region:2v2:${r}`)
  }

  const removed = await redis.del(...keys)
  console.log(`Deleted ${removed} cursor keys (out of ${keys.length} requested)`)

  await redis.quit()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
