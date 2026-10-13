// help-offers: draws the "How I can help" bullets of an answer as buttons inside that chat message.
// A click starts a background subagent for that offer. Its report is saved under REPORTS_DIR.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Offer } from '../types'
import { labelOf, promptFor, REPORTS_DIR, slugOf, splitOffers } from './offers'

// Offers that were clicked, keyed by "<message id>:<index>". Unclicked offers have no entry.
const offers = atom({ plugin: 'help-offers', key: 'offers' } as const, [])

const NO_VERDICT = 'gave no verdict'

const GLYPH: Record<Offer['status'], string> = { idle: '▶', running: '…', done: '✓', failed: '✗' }
const HINT: Record<Offer['status'], string> = {
  idle: 'click to run as a subagent',
  running: 'subagent running',
  done: 'done, click to read the report',
  failed: 'stopped, click to read what it returned',
}

export const register: Register = on => {
  // A subagent this mod started finished: save its report and mark the offer.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) return result

    const list = await read($, offers)
    const offer = list.find(one => one.agentId === e.agentId && one.status === 'running')
    if (!offer) return result

    const stamp = new Date(await $.clock.now()).toISOString().slice(0, 16).replace(':', '')
    const reportPath = `${REPORTS_DIR}/${stamp}-${slugOf(offer.text)}.md`
    const status: Offer['status'] = e.reason === 'answer' ? 'done' : 'failed'
    await $.fs.write(reportPath, `# ${labelOf(offer.text, 200)}\n\n${e.answer || `(no answer, ended by ${e.reason})`}\n`)
    await update($, offers, all => all.map(one => (one.id === offer.id ? { ...one, status, reportPath } : one)))
    $.ui.toast(`Subagent ${status}: ${labelOf(offer.text, 50)}. Report: ${reportPath}`)

    return result
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const split = e.props.isSummary ? null : splitOffers(e.props.text)
    if (!split) return next(e)

    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const clicked = await read($, offers)
    const idOf = (i: number) => `${e.requestId}:${i}`

    const press = async (i: number, text: string) => {
      const id = idOf(i)
      const current = (await read($, offers)).find(one => one.id === id)
      if (current?.status === 'running') return
      if (current?.reportPath) {
        await $.prompt.fill({ text: `Read ${current.reportPath} and walk me through it.` })
        return
      }
      const spawn = () =>
        $.agent.spawn({
          prompt: promptFor(text),
          description: `Help: ${labelOf(text, 40)}`,
          subagentType: 'general-purpose',
        })
      let spawned = await spawn()
      // A click carries no user request, so the auto mode classifier may give no verdict. Its message asks for one retry.
      if (spawned.deny?.includes(NO_VERDICT)) spawned = await spawn()
      if (spawned.deny?.includes(NO_VERDICT)) {
        await $.prompt.fill({ text: `Run this as a background subagent: ${labelOf(text, 400)}` })
        $.ui.toast('Auto mode could not approve the subagent. Send the filled prompt to run it.')
        return
      }
      if (spawned.deny !== undefined || !spawned.agentId) {
        $.ui.toast(`Could not start the subagent: ${spawned.deny ?? 'no agent id'}`)
        return
      }
      const offer: Offer = { id, text, status: 'running', agentId: spawned.agentId }
      await update($, offers, all => [...all.filter(one => one.id !== id), offer])
      $.ui.toast(`Started a subagent: ${labelOf(text, 50)}`)
    }

    return (
      <Box flexDirection="column">
        {split.before !== '' && <Markdown key="before" text={split.before} />}
        <Text bold>{split.heading}</Text>
        {split.offers.map((text, i) => {
          const status = clicked.find(one => one.id === idOf(i))?.status ?? 'idle'
          return (
            <Box key={`row-${i}`} flexDirection="row" gap={1}>
              <Button key={`offer-${i}`} plain label={GLYPH[status]} onPress={() => press(i, text)} />
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="wrap">
                  {labelOf(text, 400)} <Text dimColor>({HINT[status]})</Text>
                </Text>
              </Box>
            </Box>
          )
        })}
        {split.after !== '' && <Markdown key="after" text={split.after} />}
      </Box>
    )
  })
}
