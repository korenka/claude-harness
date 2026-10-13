// Checks that the Blind Spots button above the prompt submits the review prompt.
import { expect, test } from 'claude-code/testing'

import { PROMPT } from '../hooks/register'

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the Blind Spots button submits the review prompt on ${surface}`, async ($, on) => {
    const sent: string[] = []
    on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Box', props: {}, children: [] }))
    on('ui.toast', async () => ({ value: undefined }))
    on('prompt.submit', async (_$, e) => {
      sent.push(e.text)

      return { text: e.text, origin: e.origin }
    })

    const band = await $.ui.mount({ plugin: 'blind-spots', surface, component: 'AbovePrompt', props: PROPS })
    await band.press({ key: 'blind-spots' })
    await band.unmount()

    expect(sent).toEqual([PROMPT])
  })
}
