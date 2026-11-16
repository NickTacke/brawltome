import type { PostMatchView } from '../overlay/post-match'

const shinigami = { brawlhallaId: 91913839, name: 'Shinigami', legend: 'Hattori' }
const tidecaller = { brawlhallaId: 50427113, name: 'tidecaller', legend: 'Petra' }
const koa = { brawlhallaId: 7781120, name: 'Koa', legend: 'Ada' }
const rimelight = { brawlhallaId: 6620431, name: 'rimelight', legend: 'Mordex' }

const won: PostMatchView = {
  isWin: true,
  opponents: [shinigami],
  tier: 'Diamond',
  tierChange: null,
  rating: 2130,
  ratingChange: 18,
  personal2v2: null,
  matchPage: null,
}

export type PostMatchCell = { title: string; match: PostMatchView }

export function postMatchCells(): PostMatchCell[] {
  return [
    { title: 'Won, 1v1', match: won },
    {
      title: 'Lost, 1v1',
      match: { ...won, isWin: false, opponents: [tidecaller], tier: 'Platinum 4', rating: 1812, ratingChange: -16 },
    },
    {
      title: 'Won, 2v2',
      match: {
        ...won,
        opponents: [koa, rimelight],
        rating: 2284,
        ratingChange: 14,
        personal2v2: { rating: 2190, change: 9 },
      },
    },
    { title: 'Up a tier', match: { ...won, tierChange: 'up', rating: 2003, ratingChange: 21 } },
    {
      title: 'Down a tier',
      match: { ...won, isWin: false, tier: 'Platinum 5', tierChange: 'down', rating: 1996, ratingChange: -19 },
    },
    {
      title: 'Long name',
      match: {
        ...won,
        isWin: false,
        opponents: [{ brawlhallaId: 1, name: 'xX_TheLongestNameInValhallaEver_Xx', legend: 'Lord Vraxx' }],
        tier: 'Gold 3',
        rating: 1488,
        ratingChange: -12,
      },
    },
    { title: 'Replay uploading (later)', match: { ...won, matchPage: 'uploading' } },
    { title: 'Match page being built (later)', match: { ...won, matchPage: 'building' } },
    { title: 'Match page ready (later)', match: { ...won, matchPage: 'ready' } },
  ]
}
