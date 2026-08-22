/**
 * Civic fees (agent → treasury), in their own module so the notice-board's
 * examine text can be generated from the same numbers the sim charges.
 * `examine.ts` cannot import `sim.ts` — sim imports examine.
 *
 * Proposing and voting are both free by default, and both are knobs. They were
 * asymmetric by accident, not by design: proposing cost 2 coins, voting cost
 * nothing, and the only board line a mind ever saw was the cost-framed
 * "posting one costs 2 coins". Measured on two backbones — frugal personas
 * refuse to originate under that fee (0/10) and originate freely without it
 * (9/10), while voting ran 10/10 either way. Keeping both exposed means any
 * nonzero value from here on is a deliberate design choice.
 */
export const PROPOSE_COST = 0
export const VOTE_COST = 0
export const SANCTION_COST = 1
export const CLAIM_COST = 15

/** "free" / "N coins" — for menu and observation text. */
export function coinPhrase(cost: number): string {
  if (cost <= 0) return 'free'
  return `${cost} ${cost === 1 ? 'coin' : 'coins'}`
}
