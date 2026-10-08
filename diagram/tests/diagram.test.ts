// Tests the diagram mod: /diagram draws a pane from a stubbed model reply on
// both surfaces, files are written, and the band button follows the heuristic.

import { expect, test } from 'claude-code/testing'

const GRAPH = {
  title: 'Request flow',
  summary: 'A client request goes through the proxy to a shard.',
  groups: [
    { id: 'edge', label: 'Edge' },
    { id: 'data', label: 'Data path' },
  ],
  nodes: [
    { id: 'client', label: 'Client', kind: 'user', group: 'edge', detail: 'Sends commands.' },
    { id: 'dmc', label: 'DMC proxy', kind: 'service', group: 'edge', detail: 'Routes by hash slot.' },
    { id: 'shard', label: 'Redis shard', kind: 'store', group: 'data', detail: 'Holds the keys.' },
    { id: 'syncer', label: 'Syncer', kind: 'service', group: 'data', detail: 'Ships effects.' },
  ],
  edges: [
    { from: 'client', to: 'dmc', label: 'RESP command', kind: 'call' },
    { from: 'dmc', to: 'shard', label: 'forward', kind: 'call' },
    { from: 'shard', to: 'syncer', label: 'effects', kind: 'async' },
    { from: 'shard', to: 'client', label: 'reply', kind: 'returns' },
    { from: 'ghost', to: 'dmc', label: 'dropped', kind: 'call' },
  ],
}

const PANE = {
  title: 'Diagram',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

test('/diagram draws the graph on terminal and desktop and saves four files', async ($, on) => {
  const written: string[] = []
  on('model.fork', () => ({ value: { isAnswered: true, text: '```json\n' + JSON.stringify(GRAPH) + '\n```', usage: {} } }))
  on('env.get', () => ({ value: '/home/test' }))
  on('session.cwd', () => ({ value: '/work/Redis-Enterprise' }))
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 8, 12, 0, 0) }))
  on('fs.write', ($, e) => {
    written.push(e.path)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))

  await $.command.run({ command: 'diagram', args: '' })

  expect(written.length).toBe(4)
  expect(written.some(p => p.endsWith('.html'))).toBe(true)
  expect(written[0]).toBe('/home/test/claude-diagrams/redis-enterprise/2026-10-08-12-00-00-request-flow.svg')
  expect(written.some(p => p.endsWith('.drawio'))).toBe(true)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'diagram', surface, component: 'Pane', props: PANE, requestId: 'diagram-1' })
    expect(await ui.find({ type: 'Text', text: /Request flow/ })).toBeDefined()
    expect(await ui.find({ key: 'diagram-expand' })).toBeDefined()
    if (surface === 'desktop') {
      expect(await ui.find({ type: 'Svg' })).toBeDefined()
      await ui.press({ key: 'diagram-open-drawio' })
      expect(await ui.find({ type: 'Text', text: /draw.io app is not installed/ })).toBeDefined()
    } else {
      expect(await ui.find({ type: 'Text', text: /DMC proxy → Redis shard/ })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('a bad model reply shows an error with a Regenerate button', async ($, on) => {
  on('model.fork', () => ({ value: { isAnswered: true, text: 'Sorry, no diagram here.', usage: {} } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.command.run({ command: 'diagram', args: '' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'diagram', surface, component: 'Pane', props: PANE, requestId: 'diagram-1' })
    expect(await ui.find({ type: 'Text', text: /Could not draw the diagram/ })).toBeDefined()
    expect(await ui.find({ key: 'diagram-regenerate' })).toBeDefined()
    await ui.unmount()
  }
})

test('the band shows the Diagram button only after a flow-like answer', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: ['engine band'] }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const BAND = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }
  const ui = await $.ui.mount({ plugin: 'diagram', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(await ui.find({ key: 'diagram-open' })).toBeUndefined()

  const answer = [
    'The request flow works like this:',
    '1. The client calls the DMC proxy, which routes the command to the owning shard.',
    '2. The shard handler writes the key and emits an effect to the syncer service.',
    '3. The syncer forwards the effect to the remote cluster -> `CRDT.MERGE` applies it.',
    'This is the whole data path architecture for Active-Active writes, from client to remote shard.',
  ].join('\n')
  await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await ui.redraw()
  expect(await ui.find({ key: 'diagram-open' })).toBeDefined()
  await ui.unmount()
})
