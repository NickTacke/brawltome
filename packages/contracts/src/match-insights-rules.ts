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

// a line steps this often; every line the game has written says so in its own stepMs
export const LINE_STEP_MS = 16

// how an opening began is read in windows of steps before the first hit: both players hit within the trade window, the
// target dodged or landed within the dodge or landing window
export const LEAD_TRADE_STEPS = 10
export const LEAD_DODGE_STEPS = 30
export const LEAD_LANDING_STEPS = 8

// the same windows in milliseconds, for the words that explain them
export const LEAD_TRADE_MS = LEAD_TRADE_STEPS * LINE_STEP_MS
export const LEAD_DODGE_MS = LEAD_DODGE_STEPS * LINE_STEP_MS
export const LEAD_LANDING_MS = LEAD_LANDING_STEPS * LINE_STEP_MS
