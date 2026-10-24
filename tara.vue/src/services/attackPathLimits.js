export class AttackPathLimitError extends Error {
  constructor(reason) {
    super(`Attack path calculation stopped: ${reason}`)
    this.reason = reason
  }
}

// The search, diagnostics and validation can share this budget. A stopped
// budget stays stopped; callers retain structural candidates already found.
export function createAttackPathBudget(maxWork = 2000000, timeLimitMs = 5000) {
  if (
    !Number.isInteger(maxWork) ||
    maxWork < 1 ||
    !Number.isInteger(timeLimitMs) ||
    timeLimitMs < 1
  )
    throw new Error('Invalid attack path calculation limit.')
  const started = Date.now()
  let work = 0,
    reason = null
  return {
    tick() {
      if (!reason) {
        if (++work > maxWork) reason = 'workLimit'
        else if (work === 1 || work % 128 === 0) {
          if (Date.now() - started >= timeLimitMs) reason = 'timeLimit'
        }
      }
      if (reason) throw new AttackPathLimitError(reason)
    },
    get work() {
      return work
    },
    get stopReason() {
      return reason
    },
    get elapsedMs() {
      return Date.now() - started
    },
  }
}
