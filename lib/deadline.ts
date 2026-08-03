/*
 * How long a request may take, owned by the request instead of by the platform.
 *
 * THE PLATFORM ALREADY HAS A LIMIT AND IT IS THE WRONG ONE TO HIT. `maxDuration`
 * is enforced by killing the function: nothing is written, so the browser gets
 * the gateway's HTML error page where it asked for JSON, `response.json()`
 * throws on the first character of it, and what the operator reads is
 * `Unexpected token 'A'`. That is not a worse error message, it is a different
 * error — one about parsing — and it hides the only fact worth having, which is
 * that something took too long and what the something was.
 *
 * SO THE WORK IS GIVEN A DEADLINE SLIGHTLY INSIDE THE PLATFORM'S. The last thing
 * a request does is then always write a sentence, and every failure on these
 * routes arrives in the shape the surface already knows how to read.
 *
 * THE SIGNAL IS THE HALF THAT SAVES MONEY, the race is the half that guarantees
 * an answer. Legs that take an `AbortSignal` — the model, the Google fetch — are
 * cut off at the deadline and stop billing; a leg that cannot be aborted still
 * cannot hold the response past it, because the caller races `rejected()` and
 * answers without it. Both halves are needed: a signal nobody honours would not
 * bound the request, and a race alone would leave a model generating tokens
 * nobody will ever read.
 *
 * NOT `server-only`, deliberately. There is no credential here and nothing that
 * touches a database — it is arithmetic on a clock and one `AbortController` —
 * and `lib/assistant/types.ts` names this type at the provider boundary, which
 * a client component is allowed to import.
 */

/**
 * The request ran out of time.
 *
 * Its own class so that `errorResponse` can answer 504 rather than 500 without
 * matching on a message. The two are genuinely different things to be told: a
 * 500 says this request cannot work, a 504 says this request did not fit, and
 * only one of them is worth pressing the button again for.
 */
export class DeadlineExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeadlineExceededError'
  }
}

/**
 * A moment this request will not work past.
 *
 * Created by a route handler, from the same number the route's `maxDuration`
 * states, minus room to write the response. Passed down rather than consulted
 * globally: the thing that knows how long the operator has been waiting is the
 * request, and every leg below it should be able to ask how much of that is
 * left without knowing which route it is under.
 */
export class Deadline {
  /** Epoch milliseconds. Read rather than a countdown, so it survives being passed around. */
  readonly at: number
  readonly signal: AbortSignal

  readonly #controller = new AbortController()
  readonly #timer: ReturnType<typeof setTimeout>

  private constructor(ms: number, what: string) {
    this.at = Date.now() + ms
    this.#timer = setTimeout(() => {
      this.#controller.abort(
        new DeadlineExceededError(`${what} did not finish within ${Math.round(ms / 1000)} seconds.`),
      )
    }, ms)
    /*
     * DELIBERATELY NOT `unref`'d, which is the tempting mistake here. A pending
     * timer keeps the event loop alive and on a serverless function that reads
     * like a leak — but unref it and the deadline stops firing in precisely the
     * case it exists for: work that is stuck on nothing the runtime is holding
     * open, where an unref'd timer is the only thing left and the process exits
     * around it. `release()` in the caller's `finally` is what keeps the timer
     * from outliving the request, and it runs on every path.
     */
    this.signal = this.#controller.signal
  }

  /**
   * `what` is the subject of the sentence the operator will read: "Preparing the
   * briefing did not finish within 55 seconds." Named at the call site because
   * only the route knows what it was doing.
   */
  static in(ms: number, what: string): Deadline {
    return new Deadline(ms, what)
  }

  /** Never negative. A leg asking what is left is asking for a budget, not a clock. */
  remainingMs(): number {
    return Math.max(0, this.at - Date.now())
  }

  get expired(): boolean {
    return this.signal.aborted
  }

  /**
   * A promise that rejects when the deadline passes and otherwise never settles.
   *
   * Raced against the work by the route, so that a leg which ignores the signal
   * — a database driver, say — cannot hold the response past the deadline. The
   * work keeps running behind it; what it can no longer do is decide when the
   * operator hears back.
   *
   * Safe to leave hanging: `release()` clears the timer, so the winning case
   * leaves a promise that is never settled and never rejected, rather than an
   * unhandled rejection a second later.
   */
  rejected(): Promise<never> {
    return new Promise((_, reject) => {
      if (this.signal.aborted) {
        reject(this.signal.reason)
        return
      }
      this.signal.addEventListener('abort', () => reject(this.signal.reason), { once: true })
    })
  }

  /** Stop the clock. Called in a `finally`, so a request that answered early costs nothing. */
  release(): void {
    clearTimeout(this.#timer)
  }
}

/**
 * One leg's own share of the deadline.
 *
 * WHY A LEG NEEDS ITS OWN CAP AND NOT JUST THE REQUEST'S: the request deadline
 * is the point at which the operator gets nothing. A leg that is allowed to run
 * up to it can therefore spend the whole budget and still leave the briefing
 * unwritten — which is exactly what the review fetch was doing, having no
 * timeout of any kind. Colour on top of a briefing may cost eight seconds; it
 * may not cost the briefing.
 *
 * Returns a signal that fires on whichever comes first, and a `release` that
 * must be called when the leg is done so the timer does not outlive it.
 */
export function capped(
  deadline: Deadline | undefined,
  ms: number,
  what: string,
): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController()

  // Held open rather than unref'd, and cleared in `release`. See `Deadline`.
  const timer = setTimeout(() => {
    controller.abort(new DeadlineExceededError(`${what} did not answer within ${Math.round(ms / 1000)} seconds.`))
  }, ms)

  // The deadline's reason travels rather than being replaced: a leg cut short
  // because the whole request ran out should say so, not blame itself.
  const forward = () => controller.abort(deadline?.signal.reason)
  if (deadline?.signal.aborted) forward()
  else deadline?.signal.addEventListener('abort', forward, { once: true })

  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timer)
      deadline?.signal.removeEventListener('abort', forward)
    },
  }
}
