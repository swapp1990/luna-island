/**
 * Literal prompt phrases the sidecar classifies requests by.
 *
 * Kept dependency-free on purpose: `scripts/luna-mind-home.ts` runs inside the
 * Vite config and must not pull in the sim graph, but it also must not carry
 * its own copy of these strings — a drifted copy silently misroutes every
 * request, and the request still looks like it worked.
 */

/** Opens the nightly reflection prompt. */
export const REFLECT_MARKER = 'You are reflecting on your day before sleep'

/** Emitted in the decide prompt when no need is below the warning threshold. */
export const SLACK_MARKER = 'Your needs are comfortable; nothing is urgent.'
