import type { InkBrain, Intent } from './types'

/**
 * Deliberately stupid. Phase 2 uses this as the late/malformed fallback, so
 * cleverness here would fake intelligence the LLM did not have.
 */
export const ruleBrain: InkBrain = {
  decide(obs, _rng): Intent | null {
    if (obs.self.energy < 0.20 && obs.self.at === obs.self.home) {
      return { action: 'sleep', reason: 'energy is below 0.20 and I am at home' }
    }
    if (obs.self.hunger < 0.20 && obs.self.at === obs.self.home && obs.self.fridge >= 1) {
      return { action: 'eat', reason: 'hunger is below 0.20 and there is a meal at home' }
    }
    if (obs.self.walking) {
      return { action: 'wait', reason: 'still walking' }
    }
    return { action: 'wait', reason: 'nothing to do' }
  },
}
