// Mock data populated from real Brawlhalla guide terminology and the
// "Roadmap to Diamond" Steam guide structure (id 2959522502). Combo notation
// and signature references match the public conventions used by community
// coaches. No real pro player is attributed — those slots are open for
// curators to fill once partnerships are arranged.

export interface WeaponEntry {
  /** Asset filename (matches /images/weapons/<name>.png and BrawlTome's normalizeWeaponName). */
  name: string
  /** Display label, sometimes longer than asset name (e.g. "Rocket Lance"). */
  displayName: string
  slug: string
  trueCombos: number
  dodgeReads: number
  techGuides: number
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
}

/**
 * Brawlhalla's 15 main weapons as of April 2026.
 * Sources: Official Wiki, DashFight weapons guide. Battle Boots is the most
 * recent addition. Rocket Lance is often abbreviated to "Lance" in stats.
 */
export const WEAPONS: WeaponEntry[] = [
  { name: 'Sword', displayName: 'Sword', slug: 'sword', trueCombos: 8, dodgeReads: 6, techGuides: 4, difficulty: 'Beginner' },
  { name: 'Hammer', displayName: 'Hammer', slug: 'hammer', trueCombos: 6, dodgeReads: 7, techGuides: 5, difficulty: 'Beginner' },
  { name: 'Spear', displayName: 'Spear', slug: 'spear', trueCombos: 9, dodgeReads: 7, techGuides: 5, difficulty: 'Intermediate' },
  { name: 'Gauntlets', displayName: 'Gauntlets', slug: 'gauntlets', trueCombos: 12, dodgeReads: 8, techGuides: 6, difficulty: 'Advanced' },
  { name: 'Katars', displayName: 'Katars', slug: 'katars', trueCombos: 10, dodgeReads: 7, techGuides: 5, difficulty: 'Intermediate' },
  { name: 'Bow', displayName: 'Bow', slug: 'bow', trueCombos: 5, dodgeReads: 9, techGuides: 6, difficulty: 'Intermediate' },
  { name: 'Axe', displayName: 'Axe', slug: 'axe', trueCombos: 7, dodgeReads: 5, techGuides: 4, difficulty: 'Beginner' },
  { name: 'Blasters', displayName: 'Blasters', slug: 'blasters', trueCombos: 6, dodgeReads: 8, techGuides: 5, difficulty: 'Intermediate' },
  { name: 'Lance', displayName: 'Rocket Lance', slug: 'rocket-lance', trueCombos: 8, dodgeReads: 6, techGuides: 5, difficulty: 'Intermediate' },
  { name: 'Orb', displayName: 'Orb', slug: 'orb', trueCombos: 5, dodgeReads: 6, techGuides: 4, difficulty: 'Advanced' },
  { name: 'Cannon', displayName: 'Cannon', slug: 'cannon', trueCombos: 4, dodgeReads: 5, techGuides: 3, difficulty: 'Beginner' },
  { name: 'Chakrams', displayName: 'Chakram', slug: 'chakram', trueCombos: 7, dodgeReads: 7, techGuides: 5, difficulty: 'Intermediate' },
  { name: 'Greatsword', displayName: 'Greatsword', slug: 'greatsword', trueCombos: 6, dodgeReads: 5, techGuides: 4, difficulty: 'Beginner' },
  // The "Scythe Elo" — the meme stuck-in-Mid-Plat weapon. Always keep on the list.
  { name: 'Scythe', displayName: 'Scythe', slug: 'scythe', trueCombos: 11, dodgeReads: 8, techGuides: 6, difficulty: 'Advanced' },
  { name: 'Boots', displayName: 'Battle Boots', slug: 'battle-boots', trueCombos: 5, dodgeReads: 6, techGuides: 4, difficulty: 'Intermediate' },
]

export type Bracket = '1v1' | '2v2'

export interface ComboEntry {
  legendKey: string
  legendName: string
  weapon?: string
  partner?: string
  partnerKey?: string
  count: number
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  /** Notation excerpt — uses real Brawlhalla shorthand (nLight, dLight, GP, sSig, etc.). */
  highlight: string
}

/**
 * 1v1 combos use authentic notation conventions:
 * nLight/sLight/dLight = neutral/side/down light
 * nSig/sSig/dSig = signatures
 * GP = ground pound (down heavy in air)
 * Sources: theglobalgaming.com Hattori/Bödvar guides, zathong.com Hattori guide,
 * "How To Caspian" Steam guide.
 */
export const COMBOS_1V1: ComboEntry[] = [
  {
    legendKey: 'hattori',
    legendName: 'Hattori',
    weapon: 'Spear',
    count: 7,
    difficulty: 'Intermediate',
    highlight: 'dLight → sLight → nSig kill confirm',
  },
  {
    legendKey: 'caspian',
    legendName: 'Caspian',
    weapon: 'Gauntlets',
    count: 9,
    difficulty: 'Advanced',
    highlight: 'sSig command grab — 2-frame startup',
  },
  {
    legendKey: 'bodvar',
    legendName: 'Bödvar',
    weapon: 'Sword',
    count: 5,
    difficulty: 'Beginner',
    highlight: 'nLight → sLight BnB chain',
  },
  {
    legendKey: 'cassidy',
    legendName: 'Cassidy',
    weapon: 'Hammer',
    count: 4,
    difficulty: 'Beginner',
    highlight: 'GP read → sLight pickup',
  },
  {
    legendKey: 'fait',
    legendName: 'Fait',
    weapon: 'Scythe',
    count: 8,
    difficulty: 'Advanced',
    highlight: 'Orb dSig feint → dLight punish',
  },
  {
    legendKey: 'ada',
    legendName: 'Ada',
    weapon: 'Blasters',
    count: 6,
    difficulty: 'Intermediate',
    highlight: 'Aerial pressure → recovery edit',
  },
]

/**
 * 2v2 combos use real team concepts:
 * "Black hole" = chained two-player combo with no escape window.
 * "Zoning" = jump-attacking a shared zone for follow-up pickups.
 * Sources: Steam "Ultimate 2v2 Guide" 3029953896, "Black hole demonstration" 746897075.
 */
export const COMBOS_2V2: ComboEntry[] = [
  {
    legendKey: 'bodvar',
    legendName: 'Bödvar',
    partner: 'Ada',
    partnerKey: 'ada',
    count: 4,
    difficulty: 'Intermediate',
    highlight: 'Sword stun → Blasters dAir black hole',
  },
  {
    legendKey: 'hattori',
    legendName: 'Hattori',
    partner: 'Caspian',
    partnerKey: 'caspian',
    count: 5,
    difficulty: 'Advanced',
    highlight: 'Edge guard rotation — zone hand-off',
  },
  {
    legendKey: 'cassidy',
    legendName: 'Cassidy',
    partner: 'Bödvar',
    partnerKey: 'bodvar',
    count: 3,
    difficulty: 'Beginner',
    highlight: 'Hammer GP read → Sword pickup',
  },
  {
    legendKey: 'ezio',
    legendName: 'Ezio',
    partner: 'Diana',
    partnerKey: 'diana',
    count: 4,
    difficulty: 'Intermediate',
    highlight: 'Bow + Bow recovery zone trap',
  },
]

export type TutorialCategory = 'Movement' | 'Dodge reads' | 'Edge guards' | 'Recovery' | 'Mindgame' | 'Team play'

export interface TutorialEntry {
  title: string
  slug: string
  category: TutorialCategory
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  duration: string
  hasVideo: boolean
}

export const TUTORIAL_CATEGORIES: ('All' | TutorialCategory)[] = [
  'All',
  'Movement',
  'Dodge reads',
  'Edge guards',
  'Recovery',
  'Mindgame',
  'Team play',
]

/**
 * Tutorial titles drawn from real Brawlhalla coaching vocabulary:
 * - "Chase dodge" — forward dodge after attack, faster + cancellable
 * - "Wall hug system" — hard-coded 8/12/15 wall-touch limit
 * - "Returning to Stage" — Roadmap to Diamond Section 15
 * - "Priority and Clashes" — Roadmap section 16
 * - "Layered offense" — Roadmap section 19
 * - "The Scythe Elo" — Mid-Plat hardstuck meme/section
 * - "Black holes / map control" — 2v2 fundamentals
 */
export const TUTORIALS: TutorialEntry[] = [
  { title: 'Chase dodge timing', slug: 'chase-dodge', category: 'Movement', difficulty: 'Beginner', duration: '7 min', hasVideo: true },
  { title: 'Spacing fundamentals', slug: 'spacing', category: 'Movement', difficulty: 'Beginner', duration: '8 min', hasVideo: true },
  { title: 'Advanced movement: redirects & DI', slug: 'advanced-movement', category: 'Movement', difficulty: 'Advanced', duration: '11 min', hasVideo: true },
  { title: 'Reading air dodges', slug: 'reading-air-dodges', category: 'Dodge reads', difficulty: 'Intermediate', duration: '10 min', hasVideo: true },
  { title: 'Reading ground dodges', slug: 'reading-ground-dodges', category: 'Dodge reads', difficulty: 'Advanced', duration: '12 min', hasVideo: true },
  { title: 'Edge guarding 101', slug: 'edge-guarding-intro', category: 'Edge guards', difficulty: 'Beginner', duration: '7 min', hasVideo: true },
  { title: 'Mind games at the ledge', slug: 'edge-mindgames', category: 'Edge guards', difficulty: 'Intermediate', duration: '9 min', hasVideo: true },
  { title: 'Returning to stage', slug: 'returning-to-stage', category: 'Recovery', difficulty: 'Beginner', duration: '6 min', hasVideo: false },
  { title: 'Wall hug system & recovery cancels', slug: 'wall-hug-recovery', category: 'Recovery', difficulty: 'Advanced', duration: '8 min', hasVideo: true },
  { title: 'Priority & clashes', slug: 'priority-clashes', category: 'Mindgame', difficulty: 'Intermediate', duration: '7 min', hasVideo: false },
  { title: 'Layered offense', slug: 'layered-offense', category: 'Mindgame', difficulty: 'Advanced', duration: '10 min', hasVideo: true },
  { title: 'Chase dodge cancel', slug: 'chase-dodge-cancel', category: 'Mindgame', difficulty: 'Advanced', duration: '5 min', hasVideo: true },
  { title: 'Map control fundamentals (2v2)', slug: '2v2-map-control', category: 'Team play', difficulty: 'Beginner', duration: '8 min', hasVideo: true },
  { title: 'Black holes & 2v2 zoning', slug: '2v2-black-holes', category: 'Team play', difficulty: 'Intermediate', duration: '9 min', hasVideo: true },
]

export const RANK_PICKER_TIERS = ['Tin', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'] as const

interface PathStep {
  title: string
  href: string
  status: 'done' | 'next' | 'todo'
  category: string
}

export interface ClimbPath {
  fromRank: string
  fromLabel: string
  toRank: string
  toLabel: string
  progressPct: number
  done: number
  total: number
  steps: PathStep[]
}

/**
 * Gold → Platinum climb path. Mirrors the structure of the "Roadmap to Diamond"
 * Steam guide (id 2959522502) — the de-facto community climb path. Section
 * names retained verbatim so coaches recognize them.
 */
export const MOCK_PATH: ClimbPath = {
  fromRank: 'Gold 2',
  fromLabel: 'Gold II',
  toRank: 'Platinum 4',
  toLabel: 'Platinum IV',
  progressPct: 57,
  done: 4,
  total: 7,
  steps: [
    { title: 'Special movement: chase dodge', href: '/learn/movement/chase-dodge', status: 'done', category: 'Movement' },
    { title: 'Edge guard fundamentals', href: '/learn/edge-guards/intro', status: 'done', category: 'Edge guards' },
    { title: 'Returning to stage', href: '/learn/recovery/returning-to-stage', status: 'done', category: 'Recovery' },
    { title: 'Priority & clashes', href: '/learn/mindgame/priority-clashes', status: 'next', category: 'Mindgame' },
    { title: 'Mind games at the ledge', href: '/learn/edge-guards/mindgames', status: 'todo', category: 'Edge guards' },
    { title: 'Layered offense', href: '/learn/mindgame/layered-offense', status: 'todo', category: 'Mindgame' },
    { title: 'Map control (2v2)', href: '/learn/team-play/map-control', status: 'todo', category: 'Team play' },
  ],
}

export const PREVIEW_PATH_BY_TIER: Record<string, { fromRank: string; fromLabel: string; toRank: string; toLabel: string }> = {
  Tin: { fromRank: 'Tin 5', fromLabel: 'Tin V', toRank: 'Bronze 0', toLabel: 'Bronze 0' },
  Bronze: { fromRank: 'Bronze 2', fromLabel: 'Bronze II', toRank: 'Silver 0', toLabel: 'Silver 0' },
  Silver: { fromRank: 'Silver 3', fromLabel: 'Silver III', toRank: 'Gold 0', toLabel: 'Gold 0' },
  Gold: { fromRank: 'Gold 2', fromLabel: 'Gold II', toRank: 'Platinum 4', toLabel: 'Platinum IV' },
  Platinum: { fromRank: 'Platinum 3', fromLabel: 'Platinum III', toRank: 'Diamond', toLabel: 'Diamond' },
  Diamond: { fromRank: 'Diamond', fromLabel: 'Diamond', toRank: 'Valhallan', toLabel: 'Valhallan' },
}
