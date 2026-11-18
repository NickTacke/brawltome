/** A player's stocks as dots: the ones they still had when the match ended are lit. */
export function StockPips({ left, total }: { left: number; total: number }) {
  const stockNumbers = Array.from({ length: total }, (_, index) => index + 1)

  return (
    <span className="flex justify-end gap-1" role="img" aria-label={`${left} of ${total} stocks left`}>
      {stockNumbers.map((stockNumber) => (
        <span
          key={stockNumber}
          className={`size-2 rounded-full ${stockNumber <= left ? 'bg-strong' : 'bg-white/[0.14]'}`}
        />
      ))}
    </span>
  )
}
