// Diagram mod: a button above the prompt (and a /diagram command) that turns
// the flow, feature, or architecture in Claude's latest response into a
// diagram, saves it as .svg, .drawio, .json and a zoomable .html viewer, and
// shows it in its own pane tab.

import { layout, parseGraph } from './layout.js'
import { renderDrawio } from './drawio.js'
import { EDGE_STYLES, renderSvg } from './svg.js'
import { renderViewer } from './viewer.js'

const PANE_PREFIX = 'diagram-'
const MAX_SVG_CHARS = 130000
const MAX_SOURCE_CHARS = 60000
// Rough size of one pane cell on the desktop, in CSS pixels, and the rows the
// title, summary, buttons and saved line take.
const CELL_WIDTH = 8
const CELL_HEIGHT = 18
const CHROME_ROWS = 9
const MAX_INLINE_SCALE = 1.6

const SCHEMA = `{
  "title": "short title",
  "summary": "one or two plain sentences on what the diagram shows",
  "groups": [{ "id": "g1", "label": "layer, service, or process name" }],
  "nodes": [{ "id": "a", "label": "max 4 words, real names", "kind": "service|component|function|state|event|store|external|user|decision", "group": "g1", "detail": "one sentence: what it does, file or function name" }],
  "edges": [{ "from": "a", "to": "b", "label": "max 4 words: the call, message, or trigger", "kind": "call|trigger|async|data|returns" }]
}`

const INSTRUCTIONS = [
  'Make a diagram of the feature, flow, or architecture described in the latest assistant response.',
  'Use everything this conversation showed (code read, files, functions, services) so the diagram makes clear who calls whom, what triggers what, and where data goes.',
  'Rules: 4 to 30 nodes. Use real names of services, classes, functions, and files where they help.',
  'Each edge goes from the caller or trigger to the thing it calls or starts. Edge kinds: call (sync call), trigger (event or schedule that starts work), async (queue, pub/sub, message), data (read or write of a store), returns (a reply worth showing).',
  'Group nodes by layer, process, or service. Use at most 8 groups. Keep the detail of each node to one plain sentence.',
  'Reply with ONLY one JSON object in exactly this shape, no prose, no code fence:',
  SCHEMA,
].join('\n')

const SIGNALS = [
  /->|→|=>|⇒/,
  /\b(calls?|invokes?|triggers?|dispatch(es)?|publishes?|subscribes?|emits?|enqueues?|forwards?|routes?)\b/i,
  /\b(flow|pipeline|architecture|layer(s|ed)?|sequence|lifecycle|state machine|workflow|handshake)\b/i,
  /\b(service|daemon|handler|controller|worker|queue|client|server|api|grpc|endpoint|watchdog)\b/i,
  /`[\w./-]+\.(py|go|rs|ts|js|tsx|java|cpp|c|h)`|`\w+\(\)`|\w+\.\w+\(/,
  /^\s*(\d+\.|[-*])\s+/m,
]

let canDiagram = false
let counter = 0
const diagrams = new Map()

// A free check: does this text read like something worth a diagram?
export function looksDiagrammable(text) {
  if (!text || text.length < 300) return false
  return SIGNALS.filter(re => re.test(text)).length >= 3
}

function latestResponse(messages) {
  const parts = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const text = (m.text || '').trim()
    if (m.role === 'assistant') {
      if (text) parts.unshift(text)
      continue
    }
    const isToolResult = Array.isArray(m.toolResults) && m.toolResults.length > 0
    if (m.role === 'user' && !isToolResult && text && parts.length) break
  }
  return parts.join('\n\n')
}

function slug(text) {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'diagram'
  )
}

async function askModel($) {
  const forked = await $.model.fork({ prompt: INSTRUCTIONS })
  if (forked.isAnswered) return forked.text
  if (forked.reason !== 'nothing-to-fork' && forked.reason !== 'empty-reply') {
    throw new Error('the model did not answer: ' + forked.reason)
  }
  const source = latestResponse(await $.session.messages())
  if (!source) throw new Error('there is no response to diagram yet')
  const r = await $.model.complete({
    model: 'sonnet',
    system: 'You turn technical explanations into diagram JSON.',
    prompt: INSTRUCTIONS + '\n\nThe response:\n\n' + source.slice(-MAX_SOURCE_CHARS),
    maxTokens: 4000,
    timeoutMs: 90000,
  })
  if (!r.isAnswered) throw new Error('the model did not answer: ' + r.reason)
  return r.text
}

async function saveFiles($, graph, svgs, drawio) {
  const home = await $.env.get('HOME')
  const repo = slug(String(await $.session.cwd()).split('/').pop())
  const stamp = new Date(await $.clock.now()).toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const base = `${home}/claude-diagrams/${repo}/${stamp}-${slug(graph.title)}`
  await $.fs.write(base + '.svg', svgs.LR)
  await $.fs.write(base + '.drawio', drawio)
  await $.fs.write(base + '.json', JSON.stringify(graph, null, 2))
  await $.fs.write(base + '.html', renderViewer(graph, svgs))
  return { svg: base + '.svg', drawio: base + '.drawio', json: base + '.json', html: base + '.html' }
}

async function generate($, id) {
  const entry = diagrams.get(id)
  entry.status = 'loading'
  entry.error = ''
  $.ui.invalidate('ui.render')
  try {
    const reply = await askModel($)
    if (!diagrams.has(id)) return
    const graph = parseGraph(reply)
    if (graph.nodes.length < 2) throw new Error('the response has nothing to draw')
    const laid = { LR: layout(graph, 'LR'), TB: layout(graph, 'TB') }
    const svgs = { LR: renderSvg(graph, laid.LR), TB: renderSvg(graph, laid.TB) }
    entry.graph = graph
    entry.laid = laid
    entry.svgs = svgs
    entry.files = await saveFiles($, graph, svgs, renderDrawio(graph, laid.LR))
    entry.status = 'done'
    await $.ui.open({ id, title: graph.title.slice(0, 40) })
  } catch (err) {
    entry.status = 'error'
    entry.error = err && err.message ? err.message : String(err)
  }
  $.ui.invalidate('ui.render')
}

async function newDiagram($) {
  counter += 1
  const id = PANE_PREFIX + counter
  diagrams.set(id, { status: 'loading', error: '', graph: null, laid: null, svgs: null, files: null, note: '' })
  await $.ui.open({ id, title: 'Diagram', focus: true, closeOnEscape: true, columns: 120 })
  await generate($, id)
}

async function openFile($, id, argv) {
  const entry = diagrams.get(id)
  try {
    const r = await $.process.run(argv)
    entry.note = r.exitCode === 0 ? '' : 'Could not open the file: ' + (r.stderr || 'exit ' + r.exitCode).trim()
  } catch (err) {
    entry.note = 'Could not open the file: ' + err.message
  }
  $.ui.invalidate('ui.render')
}

async function openInDrawio($, id) {
  const entry = diagrams.get(id)
  let hasApp = false
  try {
    hasApp = (await $.process.run(['open', '-Ra', 'draw.io'])).exitCode === 0
  } catch {
    hasApp = false
  }
  if (hasApp) return openFile($, id, ['open', '-a', 'draw.io', entry.files.drawio])
  entry.note =
    'The draw.io app is not installed. Install it with: brew install --cask drawio. ' +
    'Or drag the .drawio file onto app.diagrams.net in your browser.'
  $.ui.invalidate('ui.render')
}

// Picks the layout whose text is largest when drawn at the pane's width (the
// pane scrolls down), avoiding one more than three panes tall.
function fitToPane(entry, props) {
  const paneWidth = Math.max(240, (props.bodyColumns || 80) * CELL_WIDTH)
  const paneHeight = Math.max(200, ((props.scroll && props.scroll.bodyRows) || 30) - CHROME_ROWS) * CELL_HEIGHT
  let best = null
  for (const dir of ['LR', 'TB']) {
    const { width, height } = entry.laid[dir]
    const scale = Math.min(paneWidth / width, MAX_INLINE_SCALE)
    const fit = { dir, scale, width: Math.round(width * scale), height: Math.round(height * scale) }
    const isTooTall = fit.height > paneHeight * 3
    if (!best || (best.isTooTall && !isTooTall) || (isTooTall === best.isTooTall && fit.scale > best.scale)) {
      best = { ...fit, isTooTall }
    }
  }
  return best
}

function edgeLines(entry) {
  const label = new Map(entry.graph.nodes.map(n => [n.id, n.label]))
  return entry.graph.edges.map(
    e => `${label.get(e.from)} → ${label.get(e.to)}  (${EDGE_STYLES[e.kind].name}${e.label ? ': ' + e.label : ''})`,
  )
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    canDiagram = looksDiagrammable(latestResponse(await $.session.messages()))
    try {
      await $.command.register({
        name: 'diagram',
        description: 'Draw the flow or architecture from Claude\'s latest response',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('could not register /diagram: ' + err.message)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.reason === 'answer') {
      const verdict = looksDiagrammable(e.answer)
      if (verdict !== canDiagram) {
        canDiagram = verdict
        $.ui.invalidate('ui.render')
      }
    }
    return next(e)
  })

  on('command.run', { command: 'diagram' }, async $ => {
    await newDiagram($)
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (typeof e.id === 'string' && e.id.startsWith(PANE_PREFIX)) diagrams.delete(e.id)
    return next(e)
  })

  // The Diagram button, shown when the latest response reads like a flow or architecture.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    if (e.props.isWorking || !canDiagram) return theirs
    const { Box, Button } = $.ui.resolve(e)
    const button = Button({
      key: 'diagram-open',
      label: 'Diagram',
      onPress: () => newDiagram($),
    })
    return Box({
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 1,
      children: theirs ? [theirs, button] : [button],
    })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (typeof e.requestId !== 'string' || !e.requestId.startsWith(PANE_PREFIX)) return next(e)
    const id = e.requestId
    const { Box, Text, Button } = $.ui.resolve(e)
    const entry = diagrams.get(id)

    if (!entry) return Text({ dimColor: true, children: ['This diagram is gone. Run /diagram to draw a new one.'] })
    if (entry.status === 'loading') {
      return Text({ dimColor: true, children: ['Reading the conversation and drawing the diagram…'] })
    }

    const regenerate = Button({ key: 'diagram-regenerate', label: 'Regenerate', hotkey: 'r', onPress: () => generate($, id) })
    if (entry.status === 'error') {
      return Box({
        flexDirection: 'column',
        rowGap: 1,
        children: [Text({ color: 'red', children: ['Could not draw the diagram: ' + entry.error] }), regenerate],
      })
    }

    const actions = Box({
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 1,
      children: [
        Button({
          key: 'diagram-expand',
          label: 'Expand',
          hotkey: 'e',
          variant: 'primary',
          onPress: () => openFile($, id, ['open', entry.files.html]),
        }),
        Button({ key: 'diagram-open-drawio', label: 'Open in draw.io', hotkey: 'd', onPress: () => openInDrawio($, id) }),
        regenerate,
        Button({
          key: 'diagram-copy',
          label: 'Copy path',
          hotkey: 'c',
          onPress: press => $.ui.copy({ text: entry.files.drawio, surface: press.surface }),
        }),
      ],
    })

    const top = [
      Text({ bold: true, children: [entry.graph.title] }),
      ...(entry.graph.summary ? [Text({ dimColor: true, children: [entry.graph.summary] })] : []),
      actions,
      ...(entry.note ? [Text({ color: 'yellow', children: [entry.note] })] : []),
    ]
    const saved = Text({
      dimColor: true,
      wrap: 'truncate-start',
      children: ['Saved: ' + entry.files.drawio.replace(/\.drawio$/, '.{html,svg,drawio,json}')],
    })

    const fit = fitToPane(entry, e.props)
    const source = entry.svgs[fit.dir]
    let body
    if (e.surface === 'terminal' || e.surface === 'mobile' || source.length > MAX_SVG_CHARS) {
      const note =
        source.length > MAX_SVG_CHARS
          ? 'The diagram is too large to show here. Press Expand to open it.'
          : 'This surface cannot draw the diagram. Press Expand to open it in your browser. Links:'
      body = Box({
        flexDirection: 'column',
        children: [Text({ dimColor: true, children: [note] }), ...edgeLines(entry).map(line => Text({ children: [line] }))],
      })
    } else {
      const { Svg } = $.ui.resolve(e)
      body = Svg({
        source,
        alt: entry.graph.title + ': ' + edgeLines(entry).join('; ').slice(0, 2000),
        width: fit.width,
        height: fit.height,
        isInteractive: true,
      })
    }

    return Box({ flexDirection: 'column', rowGap: 1, children: [...top, body, saved] })
  })
}
