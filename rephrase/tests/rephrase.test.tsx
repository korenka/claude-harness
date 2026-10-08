// Tests for rephrase: the button rewrites the draft through the model and puts
// it in the prompt box, Undo brings the draft back, and an empty box is left alone.
import { expect, test } from 'claude-code/testing'

import { cleanReply, requestFor } from '../hooks/register'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }

test('the reply is unwrapped and the draft sits inside tags', async () => {
  expect(cleanReply('  <prompt>\nDo X.\n</prompt>\n')).toBe('Do X.')
  expect(cleanReply('Do X.')).toBe('Do X.')
  expect(requestFor('fix it')).toContain('<prompt>\nfix it\n</prompt>')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`Rephrase rewrites the draft and Undo restores it on ${surface}`, async ($, on) => {
    let box = 'fix the bug in foo.py and also add tests'
    const asked: string[] = []
    on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Box', props: {}, children: [] }))
    on('ui.toast', async () => ({ value: undefined }))
    on('prompt.read', async () => ({ value: { text: box, cursor: box.length } }))
    on('prompt.fill', async (_$, e) => {
      box = e.text
      return { isFilled: true }
    })
    on('model.complete', async (_$, e) => {
      asked.push(e.prompt)
      return { value: { isAnswered: true, text: 'Fix the bug in foo.py.\n\n1. Add tests.', usage: USAGE } }
    })

    const band = await $.ui.mount({ plugin: 'rephrase', surface, component: 'AbovePrompt', props: PROPS })
    await band.press({ key: 'rephrase' })
    expect(asked[0]).toContain('fix the bug in foo.py and also add tests')
    expect(box).toBe('Fix the bug in foo.py.\n\n1. Add tests.')
    await band.press({ key: 'rephrase-undo' })
    expect(box).toBe('fix the bug in foo.py and also add tests')
    expect(await band.find({ key: 'rephrase-undo' })).toBeFalsy()
    await band.unmount()
  })
}

test('an empty prompt box is not sent to the model', async ($, on) => {
  let calls = 0
  const toasts: string[] = []
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Box', props: {}, children: [] }))
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.read', async () => ({ value: { text: '  ', cursor: 2 } }))
  on('model.complete', async () => {
    calls += 1
    return { value: { isAnswered: true, text: 'x', usage: USAGE } }
  })

  const band = await $.ui.mount({ plugin: 'rephrase', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await band.press({ key: 'rephrase' })
  expect(calls).toBe(0)
  expect(toasts).toEqual(['Type a prompt first, then press Rephrase.'])
  await band.unmount()
})
