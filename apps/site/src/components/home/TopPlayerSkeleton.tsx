import { skeletonAvatarStyle, skeletonBarStyle, stripedTallRowStyle } from '../table-styles'

const nameWidths = ['w-24', 'w-36', 'w-20', 'w-32', 'w-28']

// a 2v2 row shows both teammates
const avatarSlots = ['first', 'second']

function SkeletonRow({ nameWidth, avatarCount }: { nameWidth: string; avatarCount: number }) {
  return (
    <tr className={stripedTallRowStyle}>
      <td className="w-12 pr-1 pl-3">
        <span className={`${skeletonBarStyle} w-3`} />
      </td>
      <td className="max-w-0 pr-3">
        <div className="flex items-center gap-3">
          <div className="flex shrink-0 gap-1">
            {avatarSlots.slice(0, avatarCount).map((slot) => (
              <span key={slot} className={skeletonAvatarStyle} />
            ))}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <span className={`${skeletonBarStyle} ${nameWidth}`} />
            <span className={`${skeletonBarStyle} h-2 w-20`} />
          </div>
        </div>
      </td>
      <td className="w-20 pr-3 pl-2 sm:pr-2">
        <span className={`${skeletonBarStyle} ml-auto w-11`} />
      </td>
      <td className="hidden w-16 px-2 sm:table-cell">
        <span className={`${skeletonBarStyle} ml-auto w-10`} />
      </td>
      <td className="hidden w-20 px-2 sm:table-cell">
        <span className={`${skeletonBarStyle} ml-auto w-11`} />
      </td>
      <td className="hidden w-16 px-2 sm:table-cell sm:pr-3">
        <span className={`${skeletonBarStyle} ml-auto w-8`} />
      </td>
    </tr>
  )
}

/** Stands in for the five rows while a slow filter change loads, shaped like them so nothing jumps. */
export function TopPlayerSkeleton({ avatarCount }: { avatarCount: number }) {
  return (
    <>
      {nameWidths.map((nameWidth) => (
        <SkeletonRow key={nameWidth} nameWidth={nameWidth} avatarCount={avatarCount} />
      ))}
    </>
  )
}
