const leafPath = 'M0 0C2.4-2.1 6-2.3 9.2 0 6 2.3 2.4 2.1 0 0Z'
const centreX = 33
const centreY = 32
const radius = 25

type Leaf = { x: number; y: number; rotation: number }

function pointOnBranch(angle: number) {
  const radians = (angle * Math.PI) / 180

  return { x: centreX + radius * Math.cos(radians), y: centreY + radius * Math.sin(radians) }
}

// pairs of leaves along the arc, from the base of the branch up to its tip
function branchLeaves(): Leaf[] {
  const leaves: Leaf[] = []

  for (let angle = 122; angle <= 232; angle += 16) {
    const { x, y } = pointOnBranch(angle)
    const heading = angle + 90

    leaves.push({ x, y, rotation: heading - 34 }, { x, y, rotation: heading + 34 })
  }

  const tip = pointOnBranch(240)

  leaves.push({ x: tip.x, y: tip.y, rotation: 330 })

  return leaves
}

const leaves = branchLeaves()
const stemStart = pointOnBranch(112)
const stemEnd = pointOnBranch(240)
const stem = `M${stemStart.x} ${stemStart.y}A${radius} ${radius} 0 0 1 ${stemEnd.x} ${stemEnd.y}`

export function Laurel({ colour, flip }: { colour: string; flip?: boolean }) {
  return (
    <svg viewBox="0 0 32 64" className={`h-16 w-8 shrink-0 ${colour} ${flip ? '-scale-x-100' : ''}`} aria-hidden="true">
      <path d={stem} fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      {leaves.map(({ x, y, rotation }) => (
        <path
          key={`${x}-${rotation}`}
          d={leafPath}
          fill="currentColor"
          transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rotation})`}
        />
      ))}
    </svg>
  )
}
