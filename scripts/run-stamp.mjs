/**
 * Stamp a recorded run with the build it ran against.
 *
 * A soak's numbers only mean something next to the code that produced them —
 * "the assemblies run" is only comparable to "the crowding run" if you can see
 * which commit each was. Fail-soft: a run outside a git checkout still records.
 */
import { execFileSync } from 'node:child_process'

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim()
  } catch {
    return null
  }
}

/**
 * `{ sha, shortSha, branch, subject, dirty }`, or null outside a checkout.
 * `dirty` means the working tree had uncommitted changes when the run started —
 * the run is then NOT reproducible from `sha` alone, and says so.
 */
export function gitStamp() {
  const sha = git(['rev-parse', 'HEAD'])
  if (!sha) return null
  return {
    sha,
    shortSha: sha.slice(0, 8),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    subject: git(['log', '-1', '--pretty=%s']),
    dirty: (git(['status', '--porcelain']) ?? '').length > 0,
  }
}
