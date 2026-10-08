// agent-dock: an "Agents" side panel listing every agent you can run, grouped
// by where it is defined. Each row has run, pause, stop and open-in-tab
// controls under its one-line summary. A run is a background
// subagent of this session, and its tab is a pane drawing that transcript.
// The bar above the prompt also shows the context window's fill (green, then
// orange from 25%, red from 50%) with a Compact button.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentEntry, AgentRun, AgentRunStatus, AgentScope, ContextFill } from '../types'

const PANEL = 'agent-dock'
const PANEL_TITLE = 'Agents'
const COMMAND = 'agents-panel'
const PANEL_COLUMNS = 64
const TRANSCRIPT_ROWS = 60
const POLL_MS = 3000

const agents = atom({ plugin: 'agent-dock', key: 'agents' } as const, [])
const runs = atom({ plugin: 'agent-dock', key: 'runs' } as const, {})
const tick = atom({ plugin: 'agent-dock', key: 'tick' } as const, 0)
const context = atom({ plugin: 'agent-dock', key: 'context' } as const, null)
const draft = atom({ plugin: 'agent-dock', key: 'draft' } as const, '')
const said = atom({ plugin: 'agent-dock', key: 'said' } as const, {})

/** Added to the main chat's notices about panel runs, so it leaves them alone. */
const PANEL_RUN_NOTE =
  'This background agent was started from the Agents panel. The user reads its output ' +
  'and replies to it there. Do not act on this notice or mention it unless the user asks.'
type $ = EngineInterface

const CONTEXT_POLL_MS = 5000
const BAR_WIDTH = 16
const WARN_PERCENT = 25
const CRITICAL_PERCENT = 50
const FILL_COLORS = { ok: '#4EBA65', warn: '#F28C28', critical: '#E5484D' } as const

/** The bar's color for a fill: orange from 25%, red from 50%. */
export function fillColor(percent: number): string {
  if (percent >= CRITICAL_PERCENT) return FILL_COLORS.critical
  if (percent >= WARN_PERCENT) return FILL_COLORS.warn

  return FILL_COLORS.ok
}

/** A short token count: `850`, `90k`, `1M`, `1.2M`. */
export function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`

  return String(n)
}

/** The filled and empty parts of a bar `width` cells wide. */
export function barParts(percent: number, width: number): [string, string] {
  const filled = Math.min(width, Math.max(0, Math.round((percent / 100) * width)))

  return ['█'.repeat(filled), '░'.repeat(width - filled)]
}

/** Measured against the current model's window, or its smaller compaction window, as /context does. */
async function liveFill($: $): Promise<ContextFill | null> {
  const { context: live } = await $.session.usage({ breakdown: 'summary' })
  const window = live.breakdown?.rawMaxTokens ?? live.window
  if (window <= 0) return null
  const tokens = live.breakdown?.totalTokens ?? live.tokens ?? 0

  return { tokens, window, percent: Math.min(100, Math.round((tokens / window) * 100)) }
}

async function refreshContext($: $) {
  const fill = await liveFill($)
  const prev = await read($, context)
  const isSame = prev?.tokens === fill?.tokens && prev?.window === fill?.window
  if (!isSame) await update($, context, () => fill)
}

async function compactNow($: $) {
  try {
    const done = await $.session.compact({})
    if ('skip' in done) $.ui.toast(`Compact skipped: ${done.skip}`)
    // The calling plugin's own session.compact hook is skipped, so refresh here.
    else await refreshContext($)
  } catch (error) {
    $.ui.toast(`Could not compact: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** One dot color per agent, cycled in list order. */
const DOTS = ['#8FA8C8', '#5FC6D6', '#E8C468', '#E8946A', '#C9A0DC', '#E86A7A', '#8CC68C']

/** The section each scope draws under, and the folder it names. */
const SECTIONS: { scope: AgentScope; label: string; where: string }[] = [
  { scope: 'project', label: 'PROJECT', where: '.claude/agents' },
  { scope: 'user', label: 'USER', where: '~/.claude/agents' },
  { scope: 'built-in', label: 'BUILT-IN', where: 'claude code' },
]

const DEFAULT_PROMPT =
  'You were started from the Agents panel without a specific task. Begin the work ' +
  'your instructions describe, using the current project as context. If you need a ' +
  'specific task to continue, ask for it in one short message and stop.'

/** Reads `name`, `description` and `model` from an agent file's YAML frontmatter. */
export function parseAgentFile(text: string, scope: AgentScope): AgentEntry | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!block) return undefined
  const lines = (block[1] ?? '').split(/\r?\n/)
  const fields: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i] ?? '')
    if (!pair || pair[1] === undefined) continue
    let value = (pair[2] ?? '').trim()
    if (/^[|>][-+]?$/.test(value)) {
      const folded: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] ?? '')) folded.push((lines[++i] ?? '').trim())
      value = folded.join(' ')
    }
    fields[pair[1]] = value.replace(/^(["'])(.*)\1$/, '$2')
  }
  if (!fields.name) return undefined

  return { name: fields.name, description: fields.description ?? '', model: fields.model ?? '', scope }
}

/** Adds the entries of `more` whose name is not listed yet; the first one wins. */
export function mergeAgents(list: AgentEntry[], more: AgentEntry[]): AgentEntry[] {
  const out = [...list]
  for (const one of more) if (!out.some(a => a.name === one.name)) out.push(one)

  return out
}

/** A pane id for an agent's transcript tab: 1-64 of letters, digits, `_`, `-`. */
export function paneIdFor(agentId: string): string {
  return `agent-${agentId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 58)}`
}

/** A short age: `now`, `4m`, `2h`, `3d`. */
export function ageOf(startedAt: number, now: number): string {
  const minutes = Math.floor((now - startedAt) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`

  return `${Math.floor(minutes / 1440)}d`
}

async function loadAgentFiles($: $): Promise<AgentEntry[]> {
  const home = await $.env.get('HOME')
  const root = await $.session.root()
  const dirs: [string, AgentScope][] = [[`${root}/.claude/agents`, 'project']]
  if (home) dirs.push([`${home}/.claude/agents`, 'user'])
  let found: AgentEntry[] = []
  for (const [dir, scope] of dirs) {
    if (!(await $.fs.exists(dir))) continue
    const files = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.md'))
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const parsed = parseAgentFile(await $.fs.read(`${dir}/${file.name}`), scope)
      if (parsed) found = mergeAgents(found, [parsed])
    }
  }

  return found
}

function setRun($: $, name: string, run: AgentRun | undefined) {
  return update($, runs, all => {
    const next = { ...all }
    if (run) next[name] = run
    else delete next[name]

    return next
  })
}

function setStatus($: $, name: string, status: AgentRunStatus) {
  return update($, runs, all => (all[name] ? { ...all, [name]: { ...all[name], status } } : all))
}

/** Starts the agent in a new background run, or resumes the one it has. */
async function run($: $, agent: AgentEntry, text?: string) {
  const current = (await read($, runs))[agent.name]
  if (current?.status === 'running' && text === undefined) return
  if (current) {
    const sent = await $.session.send({ to: { agentId: current.agentId }, text: text ?? 'Continue where you left off.' })
    if (!sent.isDelivered) {
      $.ui.toast(`Could not reach ${agent.name}: ${sent.reason}`)
      return
    }
    await setStatus($, agent.name, 'running')
    return
  }
  const spawned = await $.agent.spawn({
    subagentType: agent.name,
    prompt: text ?? DEFAULT_PROMPT,
    description: `${agent.name} (Agents panel)`,
    name: `agents-panel-${agent.name}`,
  })
  if (spawned.deny !== undefined || !spawned.agentId) {
    $.ui.toast(`Could not start ${agent.name}: ${spawned.deny ?? 'no agent id'}`)
    return
  }
  await setRun($, agent.name, { agentId: spawned.agentId, status: 'running', startedAt: Date.now() })
  $.ui.toast(`${agent.name} started`)
}

/** Interrupts the run and keeps its transcript, so a message resumes it. */
async function pause($: $, agent: AgentEntry) {
  const current = (await read($, runs))[agent.name]
  if (current?.status !== 'running') return
  const stopped = await $.tool.call({ tool: 'TaskStop', task_id: current.agentId })
  if (stopped.deny !== undefined || stopped.isError) {
    $.ui.toast(`Could not pause ${agent.name}: ${stopped.deny ?? stopped.text}`)
    return
  }
  await setStatus($, agent.name, 'paused')
}

/** Ends the run for good: stops it, forgets it and closes its tab. */
async function stop($: $, agent: AgentEntry) {
  const current = (await read($, runs))[agent.name]
  if (!current) return
  if (current.status === 'running') {
    await $.tool.call({ tool: 'TaskStop', task_id: current.agentId }).catch(() => undefined)
  }
  await setRun($, agent.name, undefined)
  await update($, said, words => {
    const { [agent.name]: _gone, ...rest } = words
    return rest
  })
  await $.ui.close({ id: paneIdFor(current.agentId) }).catch(() => undefined)
}

async function openTab($: $, agent: AgentEntry) {
  const current = (await read($, runs))[agent.name]
  if (current) await $.ui.open({ id: paneIdFor(current.agentId), title: agent.name, focus: true })
}

/** Shows the panel when hidden and hides it when shown; answers whether it is shown. */
async function togglePanel($: $): Promise<boolean> {
  if ((await $.ui.panes()).some(pane => pane.id === PANEL)) {
    await $.ui.close({ id: PANEL })
    return false
  }
  // Focused, as the TLDR pane opens, so the first click on a row presses it.
  await $.ui.open({ id: PANEL, title: PANEL_TITLE, columns: PANEL_COLUMNS, focus: true })

  return true
}

/** Moves each run's status to what the engine reports; a pause is kept. */
async function syncStatuses($: $) {
  const all = await read($, runs)
  if (Object.keys(all).length === 0) return
  const live = await $.agent.list()
  for (const [name, current] of Object.entries(all)) {
    if (current.status === 'paused') continue
    const info = live.find(a => a.id === current.agentId)
    if (!info) continue
    const isActive = info.status === 'running' || info.status === 'pending' || info.status === 'waiting'
    const status: AgentRunStatus = isActive ? 'running' : 'done'
    if (status !== current.status) await setStatus($, name, status)
  }
}

function statusLook(current: AgentRun | undefined): { text: string; color: 'success' | 'warning' | 'inactive' } {
  if (!current) return { text: '', color: 'inactive' }
  if (current.status === 'running') return { text: 'running', color: 'success' }
  if (current.status === 'paused') return { text: 'paused', color: 'warning' }

  return { text: 'idle', color: 'inactive' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'Show or hide the Agents panel' })
    const files = await loadAgentFiles($).catch(() => [])
    // Files are read fresh each load; only engine-offered entries carry over.
    await update($, agents, list => mergeAgents(files, list.filter(a => a.scope === 'built-in')))
    $.clock.every(POLL_MS, () => syncStatuses($).catch(() => undefined))
    // Catches a /model switch between turns.
    $.clock.every(CONTEXT_POLL_MS, () => refreshContext($).catch(() => undefined))
    void $.ui.open({ id: PANEL, title: PANEL_TITLE, columns: PANEL_COLUMNS })
    await refreshContext($).catch(() => undefined)

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    await refreshContext($).catch(() => undefined)

    return done
  })

  on('command.run', { command: COMMAND }, async $ => {
    const shown = await togglePanel($)

    return { text: shown ? 'Agents panel open.' : 'Agents panel hidden.' }
  })

  // The context bar, then an "Agents" toggle, beside what others draw above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const others = await next(e)
    if (e.props.hasSurvey) return others
    const { Box, Button, Text } = $.ui.resolve(e)
    const running = Object.values(await read($, runs)).filter(r => r.status === 'running').length
    const fill = (await read($, context)) ?? (await liveFill($).catch(() => null))
    const color = fill ? fillColor(fill.percent) : undefined
    const [filled, empty] = fill ? barParts(fill.percent, BAR_WIDTH) : ['', '']
    // The desktop draws a solid track; the terminal draws block characters.
    const bar =
      e.surface === 'desktop' ? (
        <Box width={BAR_WIDTH} height={1} backgroundColor="#8080802E" flexDirection="row">
          <Box width={filled.length} height={1} backgroundColor={color} />
        </Box>
      ) : (
        <Text>
          <Text color={color}>{filled}</Text>
          <Text color="inactive">{empty}</Text>
        </Text>
      )

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {fill && (
          <Box flexDirection="row" alignItems="center" flexShrink={0} gap={1}>
            <Text color="inactive">context</Text>
            {bar}
            <Text color={color} bold>
              {fill.percent}%
            </Text>
            <Text color="inactive">
              {shortTokens(fill.tokens)}/{shortTokens(fill.window)}
            </Text>
          </Box>
        )}
        <Box flexGrow={1} />
        <Box flexDirection="row" alignItems="center" flexShrink={0} gap={1}>
          {others}
          {fill && !e.props.isWorking && <Button key="compact" label="Compact" onPress={() => compactNow($)} />}
          <Button
            key="toggle-panel"
            label={running > 0 ? `Agents · ${running}` : 'Agents'}
            onPress={() => togglePanel($)}
          />
        </Box>
      </Box>
    )
  })

  // Built-in and plugin agent types reach the list as the engine offers them.
  on('agent.offer', async ($, e, next) => {
    const known = await read($, agents)
    if (!known.some(a => a.name === e.agent)) {
      const scope: AgentScope = e.source === 'projectSettings' ? 'project' : e.source === 'userSettings' ? 'user' : 'built-in'
      await update($, agents, list => mergeAgents(list, [{ name: e.agent, description: e.description, model: '', scope }]))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await refreshContext($).catch(() => undefined)
    if (e.agentId !== undefined) {
      const all = await read($, runs)
      const found = Object.entries(all).find(([, one]) => one.agentId === e.agentId)
      if (found && found[1].status === 'running') await setStatus($, found[0], 'done')
      // The panel row shows this answer; it changes once a turn, not once a row.
      const answer = e.answer.replace(/\s+/g, ' ').trim()
      if (found && answer !== '') await update($, said, words => ({ ...words, [found[0]]: answer }))
      await update($, tick, n => n + 1)
    }

    return done
  })

  // Each row a subagent keeps redraws the panel and its open tab. A main-chat
  // notice about a panel run gets a note, so the main chat leaves it alone.
  on('session.append', async ($, e, next) => {
    if (e.agentId === undefined && e.message.role === 'user' && Array.isArray(e.message.content)) {
      const ids = Object.values(await read($, runs)).map(one => one.agentId)
      const blocks = e.message.content as readonly { type: string; text?: string }[]
      const isPanelRun = blocks.some(b => b.type === 'text' && ids.some(id => b.text?.includes(id)))
      if (isPanelRun) {
        const content = [...blocks, { type: 'text', text: PANEL_RUN_NOTE }]
        return next({ ...e, message: { ...e.message, content } as typeof e.message })
      }
    }
    const stored = await next(e)
    if (e.agentId !== undefined) await update($, tick, n => n + 1)

    return stored
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANEL && !e.requestId.startsWith('agent-')) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = els
    const Input = 'Input' in els ? els.Input : undefined
    const list = await read($, agents)
    const all = await read($, runs)
    const now = Date.now()
    const hoverFill = e.surface === 'desktop' ? '#8080801A' : undefined

    const openDraft = (agent: AgentEntry) => update($, draft, current => (current === agent.name ? '' : agent.name))

    // The controls a row offers in its state. Run and reply open the row's
    // field first, so the agent starts with the task the person typed.
    const controlsOf = (agent: AgentEntry, prefix: string) => {
      const current = all[agent.name]
      if (!current) {
        return [<Button key={`${prefix}run:${agent.name}`} label="▶ run" onPress={() => openDraft(agent)} />]
      }
      return [
        current.status === 'running' ? (
          <Button key={`${prefix}pause:${agent.name}`} label="‖" onPress={() => pause($, agent)} />
        ) : (
          // The tab has its own message field, so only the panel row offers reply.
          prefix === '' && <Button key={`${prefix}reply:${agent.name}`} label="↩ reply" onPress={() => openDraft(agent)} />
        ),
        <Button key={`${prefix}stop:${agent.name}`} label="■" onPress={() => stop($, agent)} />,
        prefix === '' && <Button key={`${prefix}open:${agent.name}`} label="⤢" onPress={() => openTab($, agent)} />,
      ]
    }

    if (e.requestId === PANEL) {
      // No read of `tick`: the panel redraws on its own state alone, so a
      // running agent's output does not redraw it under the person's click.
      const drafting = await read($, draft)
      const lastWords = await read($, said)
      const sections = SECTIONS.map(section => ({
        ...section,
        items: list.filter(agent => agent.scope === section.scope),
      })).filter(section => section.items.length > 0)

      return (
        <Box flexDirection="column" paddingX={1}>
          <Box flexDirection="row" marginTop={1} gap={1}>
            <Box flexGrow={1} flexShrink={1} flexDirection="row" gap={1}>
              <Box flexShrink={0}>
                <Text color="claude">◆</Text>
              </Box>
              <Box flexShrink={0}>
                <Text bold>Agents</Text>
              </Box>
              <Box flexShrink={1}>
                <Text color="inactive" wrap="truncate-end">
                  in this project
                </Text>
              </Box>
            </Box>
            <Box flexShrink={0}>
              <Text color="inactive">{list.length} defined</Text>
            </Box>
          </Box>

          {list.length === 0 && (
            <Box marginTop={1}>
              <Text color="inactive">No agents yet. Add one under .claude/agents.</Text>
            </Box>
          )}

          {sections.map(section => {
            const caption = `${section.where} · ${section.items.length}`
            return (
              <Box flexDirection="column" marginTop={1}>
                {/* One line at any zoom: the caption gives way with an ellipsis. */}
                <Box flexDirection="row" gap={1} marginBottom={1}>
                  <Box flexShrink={0}>
                    <Text color="suggestion" bold>
                      {section.label}
                    </Text>
                  </Box>
                  <Box flexShrink={1}>
                    <Text color="inactive" wrap="truncate-end">
                      {caption}
                    </Text>
                  </Box>
                </Box>
                {section.items.map(agent => {
                  const current = all[agent.name]
                  const status = statusLook(current)
                  const dot = DOTS[list.indexOf(agent) % DOTS.length]
                  return (
                    <Box
                      key={`row:${agent.name}`}
                      flexDirection="column"
                      paddingX={1}
                      paddingY={0}
                      marginBottom={1}
                      hover={hoverFill ? { backgroundColor: hoverFill } : undefined}
                    >
                      <Box flexDirection="row" alignItems="center">
                        <Box flexGrow={1} flexShrink={1} flexDirection="row" gap={1}>
                          <Box flexShrink={0}>
                            <Text color={dot}>●</Text>
                          </Box>
                          <Box flexShrink={1}>
                            <Text bold wrap="truncate-end">
                              {agent.name}
                            </Text>
                          </Box>
                          <Box flexShrink={2}>
                            <Text color="inactive" wrap="truncate-end">
                              {agent.model || 'inherit'}
                            </Text>
                          </Box>
                        </Box>
                        <Box flexDirection="row" gap={1} flexShrink={0}>
                          {controlsOf(agent, '')}
                        </Box>
                      </Box>
                      {/* A run shows its status and last words; an idle agent its description. */}
                      <Box paddingLeft={2} flexDirection="row" gap={1}>
                        {current && (
                          <Box flexShrink={0}>
                            <Text color={status.color}>
                              {status.text} {ageOf(current.startedAt, now)} ·
                            </Text>
                          </Box>
                        )}
                        <Box flexShrink={1}>
                          <Text color={current ? undefined : 'inactive'} wrap="truncate-end">
                            {(current && lastWords[agent.name]) || agent.description || 'No description.'}
                          </Text>
                        </Box>
                      </Box>
                      {Input && drafting === agent.name && (
                        <Box paddingLeft={2} marginTop={1} flexDirection="row" gap={1}>
                          <Box flexGrow={1} flexShrink={1}>
                            <Input
                              key={`draft:${agent.name}`}
                              autoFocus
                              placeholder={current ? `Reply to ${agent.name}…` : `What should ${agent.name} do?`}
                              submitLabel={current ? 'send' : 'start'}
                              onSubmit={async text => {
                                await update($, draft, () => '')
                                await run($, agent, text.trim() === '' ? undefined : text.trim())
                              }}
                            />
                          </Box>
                          <Button key={`cancel:${agent.name}`} label="✕" onPress={() => update($, draft, () => '')} />
                        </Box>
                      )}
                    </Box>
                  )
                })}
              </Box>
            )
          })}

          <Box marginTop={1}>
            <Text color="inactive">▶ run asks for a task · ↩ reply answers an agent · /{COMMAND} to hide</Text>
          </Box>
        </Box>
      )
    }

    const found = Object.entries(all).find(([, one]) => paneIdFor(one.agentId) === e.requestId)
    if (found === undefined) return next(e)
    const [name, current] = found
    const agent = list.find(a => a.name === name) ?? { name, description: '', model: '', scope: 'built-in' as const }
    await read($, tick)
    const messages = await $.session.messages({ agentId: current.agentId })
    const status = statusLook(current)
    const dot = DOTS[Math.max(0, list.indexOf(agent)) % DOTS.length]

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" marginTop={1} alignItems="center">
          <Box flexGrow={1} flexShrink={1} flexDirection="row" gap={1}>
            <Text color={dot}>●</Text>
            <Text bold wrap="truncate-end">
              {name}
            </Text>
            <Text color="inactive">{agent.model || 'inherit'}</Text>
            <Text color={status.color}>
              {status.text} · {ageOf(current.startedAt, now)}
            </Text>
          </Box>
          <Box flexDirection="row" gap={1} flexShrink={0}>
            {controlsOf(agent, 't-')}
          </Box>
        </Box>
        {agent.description !== '' && (
          <Box paddingLeft={2}>
            <Text color="inactive" wrap="truncate-end">
              {agent.description}
            </Text>
          </Box>
        )}
        {'deny' in messages ? (
          <Box marginTop={1}>
            <Text color="inactive">Transcript not readable: {String(messages.deny)}</Text>
          </Box>
        ) : messages.length === 0 ? (
          <Box marginTop={1}>
            <Text color="inactive">Waiting for the first message…</Text>
          </Box>
        ) : (
          messages.slice(-TRANSCRIPT_ROWS).map(message =>
            message.role === 'user' ? (
              <Box flexDirection="column" marginTop={1}>
                <Text color="suggestion" bold>
                  TASK
                </Text>
                <Text>{message.text}</Text>
              </Box>
            ) : (
              <Box flexDirection="column" marginTop={1}>
                {message.text !== '' && <Markdown text={message.text} />}
                {message.toolUses.map(use => (
                  <Text color={use.isError ? 'error' : 'inactive'} wrap="truncate-end">
                    {'⎿ '}
                    {use.tool}
                  </Text>
                ))}
              </Box>
            ),
          )
        )}
        {Input && (
          <Box marginTop={1}>
            <Input
              key="t-message"
              placeholder={`Message ${name}…`}
              submitLabel="send"
              onSubmit={text => (text.trim() === '' ? undefined : run($, agent, text.trim()))}
            />
          </Box>
        )}
      </Box>
    )
  })
}
