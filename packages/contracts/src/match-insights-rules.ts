// the fixed numbers the match insights are worked out with. kept apart from the schemas, so the browser can read them
// without loading zod

// the lead is sampled this often, from the start of the match
export const ADVANTAGE_SAMPLE_MS = 500

// the damage a stock is worth in the lead: the median damage players were KO'd at across the first sample replays
export const ADVANTAGE_STOCK_DAMAGE = 165

// a KO below this damage came early. a punish from 30 damage up is a big one: about a signature or a two or three
// hit string, roughly one punish in eight across the sample replays
export const EARLY_KO_DAMAGE = 100
export const BIG_PUNISH_DAMAGE = 30
