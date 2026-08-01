import { errorResponse, readJson, requireSession } from '@/lib/api/guard'
import { appendSegments, readCall } from '@/lib/assistant/store'
import type { Speaker, TranscriptSegment } from '@/lib/assistant/types'

/*
 * The words, arriving while they are still being said.
 *
 * The one hot path in this product: called every few seconds for the length of a
 * call, from a tab whose main job is to stay responsive to a person on the
 * phone. So it does the least it can — validate, insert, return a count — and it
 * takes a batch rather than a segment, because eleven minutes of one POST per
 * sentence is a few hundred round trips to save a few hundred rows.
 *
 * APPEND ONLY. There is no PATCH and no DELETE here. A recogniser revises its
 * guesses, but it revises them before they are final, and only final text is
 * sent — so a segment that has arrived is a segment that was said. Editing the
 * record of what a stranger said, after the fact, from a sales tool, is not a
 * capability this route is going to grow.
 *
 * IT REFUSES A CLOSED CALL. `ended_at` set means the operator hung up, and
 * segments arriving after that are a tab that was left open, not speech from
 * this conversation.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

const SPEAKERS: Speaker[] = ['operator', 'business', 'unknown']

/**
 * How much of one line is kept.
 *
 * A bound rather than a trust: `TranscriptSegment.text` is one utterance and a
 * recogniser that ran together for four minutes without a pause has malfunctioned
 * rather than heard a four-minute word. Generous enough that no real sentence
 * meets it.
 */
const MAX_TEXT = 4_000

/** How many lines one POST may carry. A batch is seconds of speech, not a call. */
const MAX_BATCH = 200

function parse(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) throw new Error('Segments must be an array.')
  if (value.length > MAX_BATCH) throw new Error(`A batch may carry at most ${MAX_BATCH} segments.`)

  return value.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>

    const atMs = typeof row.atMs === 'number' && Number.isFinite(row.atMs) ? Math.round(row.atMs) : -1
    if (atMs < 0) throw new Error('Every segment needs a non-negative atMs.')

    const speaker = typeof row.speaker === 'string' ? (row.speaker as Speaker) : 'unknown'
    if (!SPEAKERS.includes(speaker)) throw new Error(`"${speaker}" is not a speaker this call has.`)

    const text = typeof row.text === 'string' ? row.text.trim() : ''
    if (!text) throw new Error('A segment with no text is not a segment.')

    return { atMs, speaker, text: text.slice(0, MAX_TEXT) }
  })
}

export async function POST(request: Request, { params }: Context) {
  try {
    await requireSession()
    const { id } = await params

    const body = (await readJson(request)) as { segments?: unknown }
    const segments = parse(body.segments)

    const call = await readCall(id)
    if (!call) return Response.json({ error: 'No such call.' }, { status: 404 })
    if (call.endedAt) {
      return Response.json({ error: 'That call has already been closed off.' }, { status: 409 })
    }

    const written = await appendSegments(id, segments)
    return Response.json({ written })
  } catch (error) {
    return errorResponse(error)
  }
}
