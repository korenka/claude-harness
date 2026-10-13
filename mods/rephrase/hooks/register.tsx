// rephrase: a Rephrase button above the prompt. It sends the draft in the
// prompt box to a small model, which rewrites it so an LLM reads the ask
// clearly (main point first, then steps, bullets or numbering where they
// help), and puts the rewrite back in the box. Undo restores the draft.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

type $ = EngineInterface

const MODEL = 'haiku'
const MAX_TOKENS = 4000
const TIMEOUT_MS = 60_000

const busy = atom({ plugin: 'rephrase', key: 'busy' } as const, false)
const original = atom({ plugin: 'rephrase', key: 'original' } as const, '')

export const SYSTEM = `You rewrite a prompt that a person is about to send to an AI coding assistant. The goal is that the assistant understands the request on the first read.

Rules:
- Output only the rewritten prompt. No preamble, no quotes, no code fences around it, no notes about what you changed.
- Do not answer, solve or comment on the prompt. Only rewrite it.
- Keep the person's intent exactly. Do not add new requirements, assumptions or scope. Do not drop any requirement, question, constraint or detail.
- Keep every specific verbatim: file paths, code, commands, identifiers, names, numbers, URLs, ticket IDs, error text.
- Write in the same language and the same point of view as the original ("I want", "you should").
- Put the main ask first, in one clear sentence.
- Then add structure only where it makes the ask clearer: numbered steps for an order of work, bullets for separate requirements or constraints, a short "Context:" line for background.
- Fix spelling and grammar. Make vague words concrete only when the original already says what they mean.
- If something in the original is ambiguous, keep it ambiguous. Do not guess.
- If the prompt is already clear and short, return it with minimal changes.`

/** The user message: the draft inside tags, so the model treats it as text to rewrite. */
export function requestFor(draft: string): string {
  return `Rewrite the prompt inside <prompt> tags.\n\n<prompt>\n${draft}\n</prompt>`
}

/** The model's reply as a draft: trimmed, and unwrapped if it echoed the tags. */
export function cleanReply(text: string): string {
  return text
    .trim()
    .replace(/^<prompt>\s*/, '')
    .replace(/\s*<\/prompt>$/, '')
    .trim()
}

async function rephrase($: $) {
  if (await read($, busy)) return
  const { text: draft } = await $.prompt.read()
  if (draft.trim() === '') {
    $.ui.toast('Type a prompt first, then press Rephrase.')
    return
  }
  await update($, busy, () => true)
  try {
    const reply = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt: requestFor(draft),
      maxTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
    })
    if (!reply.isAnswered) {
      $.ui.toast(`Could not rephrase: ${reply.reason}`)
      return
    }
    const rewritten = cleanReply(reply.text)
    if (rewritten === '') {
      $.ui.toast('Could not rephrase: the model returned nothing.')
      return
    }
    const filled = await $.prompt.fill({ text: rewritten, mode: 'replace' })
    if (!filled.isFilled) {
      $.ui.toast(`Could not put the rewrite in the prompt box (${filled.refusal ?? 'refused'}).`)
      return
    }
    await update($, original, () => draft)
  } finally {
    await update($, busy, () => false)
  }
}

async function undo($: $) {
  const draft = await read($, original)
  if (draft === '') return
  const filled = await $.prompt.fill({ text: draft, mode: 'replace' })
  if (filled.isFilled) await update($, original, () => '')
}

export const register: Register = on => {
  // A sent prompt leaves nothing to undo.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') await update($, original, () => '')

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const others = await next(e)
    if (e.props.hasSurvey) return others
    const { Box, Button } = $.ui.resolve(e)
    const isBusy = await read($, busy)
    const canUndo = (await read($, original)) !== ''

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {others}
        <Button key="rephrase" label={isBusy ? 'Rephrasing…' : 'Rephrase'} onPress={() => rephrase($)} />
        {canUndo && !isBusy && <Button key="rephrase-undo" label="Undo" onPress={() => undo($)} />}
      </Box>
    )
  })
}
