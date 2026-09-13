import { replayTimeline, type TimelineResult } from '../lineage/timeline'
import type { RecordedDecision } from '../lineage/decider'
import type { LineageConfig } from '../lineage/types'

export interface BuiltTimeline extends TimelineResult {
  replayOk: boolean | null
}

export function buildTimeline(
  config: LineageConfig,
  decisions: readonly RecordedDecision[],
  expectedHash?: string | null,
): BuiltTimeline {
  const result = replayTimeline(config, decisions)
  const replayOk = expectedHash ? result.hash === expectedHash : null
  return { ...result, replayOk }
}
