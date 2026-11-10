import { columnLabelStyle, statHeaderStyle } from './RankedTable'

export const playerColumnCount = 6

export function PlayerTableHead({ rankWidthStyle = 'w-12' }: { rankWidthStyle?: string }) {
  return (
    <>
      <th scope="col" className={`${rankWidthStyle} pr-1 text-left ${columnLabelStyle}`}>
        #
      </th>
      <th scope="col" className={`pl-0 text-left ${columnLabelStyle}`}>
        Player
      </th>
      <th scope="col" className={`w-20 pl-2 text-right sm:pr-2 ${columnLabelStyle}`}>
        Rating
      </th>
      <th scope="col" className={`w-16 ${statHeaderStyle}`}>
        Peak
      </th>
      <th scope="col" className={`w-20 ${statHeaderStyle}`}>
        Win rate
      </th>
      <th scope="col" className={`w-16 ${statHeaderStyle} sm:pr-3`}>
        Games
      </th>
    </>
  )
}
