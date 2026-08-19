import { Button, Card } from '@/components/ui'

export function LeaderboardErrorState({ onRetryAction }: { onRetryAction: () => void }) {
  return (
    <Card
      role="alert"
      className="w-full max-w-4xl mx-auto mt-12 bg-destructive/10 border-destructive text-destructive-foreground p-6 text-center"
    >
      <p>Unable to load leaderboard data.</p>
      <Button type="button" variant="outline" className="mt-4" onClick={onRetryAction}>
        Try again
      </Button>
    </Card>
  )
}
