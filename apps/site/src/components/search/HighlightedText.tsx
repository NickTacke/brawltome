/** Shows the part of `text` that matched the query brighter than the rest. */
export function HighlightedText({ text, query }: { text: string; query: string }) {
  const term = query.trim()
  const start = text.toLowerCase().indexOf(term.toLowerCase())

  if (start < 0 || term.length === 0) return <>{text}</>

  const end = start + term.length

  return (
    <>
      <span className="text-text">{text.slice(0, start)}</span>
      {text.slice(start, end)}
      <span className="text-text">{text.slice(end)}</span>
    </>
  )
}
