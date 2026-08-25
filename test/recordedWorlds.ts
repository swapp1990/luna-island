// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import { existsSync } from 'node:fs'
// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import { resolve } from 'node:path'

/**
 * Locate the recorded soak worlds a backwards-compat import test names.
 *
 * These assertions are about OLD saves: a world written before a field existed
 * must load with that field defaulted. Only the named historical exports prove
 * that — a freshly generated run already carries the field, so substituting one
 * would turn the regression into a false failure (or a false pass).
 *
 * `artifacts/` is gitignored and a world export is tens of megabytes, so those
 * files live only on the machine that ran the soak. Returns an empty list when
 * they are gone, so the caller skips instead of failing a fresh clone on a
 * missing local file.
 */
export function recordedWorldPaths(preferred: readonly string[]): string[] {
  return preferred
    .map((f) => resolve(f) as string)
    .filter((p: string) => existsSync(p))
}

/** Message shown when the legacy worlds are not on this machine. */
export const NO_RECORDED_WORLDS =
  'legacy soak worlds absent from artifacts/ (gitignored, machine-local) — import regression skipped'
