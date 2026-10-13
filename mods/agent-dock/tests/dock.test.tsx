// Tests for agent-dock: frontmatter parsing, short ages, the panel's run,
// pause, resume and stop controls, and the context bar with its Compact button.
import { expect, test } from 'claude-code/testing'

import { ageOf, barParts, fillColor, mergeAgents, paneIdFor, parseAgentFile, shortTokens } from '../hooks/register'

test('context fill turns orange from 25% and red from 50%', async () => {
  expect(fillColor(9)).toBe('#4EBA65')
  expect(fillColor(25)).toBe('#F28C28')
  expect(fillColor(49)).toBe('#F28C28')
  expect(fillColor(50)).toBe('#E5484D')
})

test('token counts and bar parts read short', async () => {
  expect(shortTokens(850)).toBe('850')
  expect(shortTokens(90_400)).toBe('90k')
  expect(shortTokens(1_000_000)).toBe('1M')
  expect(barParts(50, 10)).toEqual(['█████', '░░░░░'])
  expect(barParts(140, 4)).toEqual(['████', ''])
})

test('the context bar shows the fill and Compact compacts', async ($, on) => {
  let compacts = 0
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Box', props: {}, children: [] }))
  let usage: object = { tokens: 300_000, window: 1_000_000, percent: 30 }
  on('session.usage', async () => ({ value: { startedAt: 0, rateLimits: [], context: usage } }))
  on('ui.toast', async () => ({ value: undefined }))
  const summary = [{ role: 'user' as const, text: 'summary', toolUses: [] }]
  on('session.compact', async () => {
    compacts += 1
    return { messages: summary }
  })
  // A compaction refreshes the fill from the usage the session reports.
  await $.session.compact({ trigger: 'manual', messages: summary })

  const band = await $.ui.mount({
    plugin: 'agent-dock',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect((await band.find({ type: 'Text', text: '30%' }))?.props.color).toBe('#F28C28')
  expect(await band.find({ text: '300k/1M' })).toBeTruthy()
  // A smaller model's window comes from the breakdown, not the status line's 1M.
  usage = { tokens: 10_000, window: 1_000_000, percent: 1, breakdown: { totalTokens: 10_000, rawMaxTokens: 200_000 } }
  await band.press({ key: 'compact' })
  expect(compacts).toBe(2)
  expect((await band.find({ type: 'Text', text: '5%' }))?.props.color).toBe('#4EBA65')
  expect(await band.find({ text: '10k/200k' })).toBeTruthy()
  await band.unmount()
})

test('Compact runs /compact where the session cannot compact directly', async ($, on) => {
  const ran: string[] = []
  const toasts: string[] = []
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Box', props: {}, children: [] }))
  on('session.usage', async () => ({
    value: { startedAt: 0, rateLimits: [], context: { tokens: 300_000, window: 1_000_000, percent: 30 } },
  }))
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // No session.compact hook: the kit's bottom rejects it, as an SDK host does.
  on('command.run', async (_$, e) => {
    ran.push(e.command)
    return { text: '' }
  })

  const band = await $.ui.mount({
    plugin: 'agent-dock',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  await band.press({ key: 'compact' })
  expect(ran).toEqual(['compact'])
  expect(toasts).toEqual([])
  await band.unmount()
})

test('parses name, model and a folded description from frontmatter', async () => {
  const text = '---\nname: bug-fixer\ndescription: >\n  Fixes bugs\n  end to end.\nmodel: opus\n---\nBody'
  expect(parseAgentFile(text, 'user')).toEqual({
    name: 'bug-fixer',
    description: 'Fixes bugs end to end.',
    model: 'opus',
    scope: 'user',
  })
  expect(parseAgentFile('no frontmatter', 'user')).toBe(undefined)
})

test('merge keeps the first entry of a name', async () => {
  const merged = mergeAgents([{ name: 'a', description: 'one', model: '', scope: 'project' }], [
    { name: 'a', description: 'two', model: '', scope: 'user' },
    { name: 'b', description: '', model: '', scope: 'user' },
  ])
  expect(merged.map(a => a.description)).toEqual(['one', ''])
})

test('pane ids stay inside the allowed characters', async () => {
  expect(paneIdFor('a1:b/c')).toBe('agent-a1bc')
})

test('ages read short', async () => {
  expect(ageOf(0, 30_000)).toBe('now')
  expect(ageOf(0, 5 * 60_000)).toBe('5m')
  expect(ageOf(0, 3 * 3_600_000)).toBe('3h')
  expect(ageOf(0, 2 * 86_400_000)).toBe('2d')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the Agents button beside the prompt toggles the panel on ${surface}`, async ($, on) => {
    let open = false
    const calls: string[] = []
    on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Box', props: {}, children: [] }))
    on('ui.panes', async () => ({
      value: open ? [{ id: 'agent-dock', title: 'Agents', isShown: true, isFocused: false, isPlaced: true }] : [],
    }))
    on('ui.open', async () => {
      open = true
      calls.push('open')
      return { value: { isPlaced: true } }
    })
    on('ui.close', async () => {
      open = false
      calls.push('close')
      return { value: undefined }
    })

    const band = await $.ui.mount({
      plugin: 'agent-dock',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 80,
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
    })
    await band.press({ key: 'toggle-panel' })
    await band.press({ key: 'toggle-panel' })
    expect(calls).toEqual(['open', 'close'])
    await band.unmount()
  })

  test(`run, pause, resume and stop on ${surface}`, async ($, on) => {
    let spawns = 0
    const stopped: string[] = []
    const sent: string[] = []
    on('ui.toast', async () => ({ value: undefined }))
    on('ui.close', async () => ({ value: undefined }))
    on('agent.offer', async () => ({ isOffered: true }))
    // Only core sets a spawn's agentId, so the kit's spawn starts none.
    on('agent.spawn', async () => {
      spawns++
      return { model: 'test' }
    })
    on('tool.call', { tool: 'TaskStop' }, async (_, e) => {
      stopped.push(String(e.task_id))
      return { result: { message: 'stopped' }, text: 'stopped' }
    })
    on('session.send', async (_, e) => {
      sent.push(e.text)
      return { isDelivered: true }
    })
    // While `seed` is set it stands in for a started run, until the plugin's
    // first write of `runs`; each write is recorded.
    const runs = { plugin: 'agent-dock', key: 'runs' } as const
    let seed: Record<string, { agentId: string; status: 'running'; startedAt: number }> | undefined
    const written: Record<string, { status: string }>[] = []
    on('state.get', runs, async (_, e, next) => (seed ? { value: { value: seed, version: 0 } } : next(e)))
    on('state.set', runs, async (_, e, next) => {
      seed = undefined
      written.push(e.value)
      return next(e)
    })

    await $.agent.offer({
      agent: 'code-reviewer',
      description: 'Reviews the current diff for correctness bugs, risky patterns and missing tests.',
      source: 'projectSettings',
      provider: { plugin: 'engine', tier: 'core' },
    })

    const panel = () =>
      $.ui.mount({
        plugin: 'agent-dock',
        surface,
        component: 'Pane',
        requestId: 'agent-dock',
        props: {
          title: 'Agents',
          isFocused: true,
          bodyColumns: 64,
          placement: 'dock',
          scroll: { offset: 0, bodyRows: 40 },
          view: {},
        },
      })
    // Each press draws afresh: the seeded read subscribes no drawing.
    const pressFresh = async (key: string) => {
      const ui = await panel()
      await ui.press({ key })
      await ui.unmount()
    }

    // Run opens the row's task field; Enter starts the agent with that task.
    const ui = await panel()
    expect(await ui.find({ type: 'Text', text: /PROJECT/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 defined/ })).toBeDefined()
    await ui.press({ key: 'run:code-reviewer' })
    expect(spawns).toBe(0)
    await ui.input({ key: 'draft:code-reviewer', text: 'Review the staged diff' })
    expect(spawns).toBe(1)
    expect(await ui.find({ key: 'draft:code-reviewer' })).toBe(undefined)
    await ui.unmount()

    seed = { 'code-reviewer': { agentId: 'agent-1', status: 'running', startedAt: 0 } }
    await pressFresh('pause:code-reviewer')
    expect(stopped).toEqual(['agent-1'])
    expect(written.at(-1)?.['code-reviewer']?.status).toBe('paused')

    // Reply opens the same field; Enter sends the text into the kept run.
    const replying = await panel()
    await replying.press({ key: 'reply:code-reviewer' })
    await replying.input({ key: 'draft:code-reviewer', text: 'Use RED-123' })
    await replying.unmount()
    expect(sent).toEqual(['Use RED-123'])
    expect(spawns).toBe(1)
    expect(written.at(-1)?.['code-reviewer']?.status).toBe('running')

    await pressFresh('stop:code-reviewer')
    expect(stopped).toEqual(['agent-1', 'agent-1'])
    expect(written.at(-1)).toEqual({})
  })
}
