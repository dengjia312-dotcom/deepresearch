function getPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name]?.trim())
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export class ImmediateSemaphore {
  private activeCount = 0

  constructor(private readonly getLimit: () => number) {}

  tryAcquire() {
    if (this.activeCount >= this.getLimit()) return null
    this.activeCount += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.activeCount = Math.max(0, this.activeCount - 1)
    }
  }

  getActiveCount() {
    return this.activeCount
  }
}

const globalAiSemaphore = new ImmediateSemaphore(
  () => getPositiveInteger('AI_GLOBAL_CONCURRENCY', 8),
)

export function tryAcquireGlobalAiSlot() {
  return globalAiSemaphore.tryAcquire()
}

export function getAiConcurrencyRetryAfterSeconds() {
  return getPositiveInteger('AI_CONCURRENCY_RETRY_AFTER_SECONDS', 15)
}

export const aiConcurrencyTestApi = {
  ImmediateSemaphore,
}
