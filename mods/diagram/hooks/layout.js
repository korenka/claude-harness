// Graph parsing and a small layered layout (top-down or left-to-right): cycle breaking,
// longest-path ranks, dummy nodes for long edges, barycenter ordering.

const MAX_NODES = 40
const NODE_KINDS = ['service', 'component', 'function', 'state', 'event', 'store', 'external', 'user', 'decision']
const EDGE_KINDS = ['call', 'trigger', 'data', 'async', 'returns']

const RANK_GAP = 74
const NODE_GAP = 28
const PAD = 24
const DUMMY_WIDTH = 14

function clip(text, max) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// Pulls the first JSON object out of a model reply and normalizes it.
export function parseGraph(reply) {
  const raw = String(reply ?? '').replace(/```(?:json)?/g, '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('the model did not return JSON')
  const data = JSON.parse(raw.slice(start, end + 1))

  const groups = (Array.isArray(data.groups) ? data.groups : [])
    .filter(g => g && g.id)
    .map(g => ({ id: String(g.id), label: clip(g.label || g.id, 40) }))
  const groupIds = new Set(groups.map(g => g.id))

  const seen = new Set()
  const nodes = []
  for (const n of Array.isArray(data.nodes) ? data.nodes : []) {
    if (!n || !n.id || seen.has(String(n.id)) || nodes.length >= MAX_NODES) continue
    seen.add(String(n.id))
    const group = n.group && groupIds.has(String(n.group)) ? String(n.group) : undefined
    nodes.push({
      id: String(n.id),
      label: clip(n.label || n.id, 48),
      kind: NODE_KINDS.includes(n.kind) ? n.kind : 'component',
      group,
      detail: clip(n.detail, 400),
    })
  }

  const edges = []
  for (const ed of Array.isArray(data.edges) ? data.edges : []) {
    if (!ed || !seen.has(String(ed.from)) || !seen.has(String(ed.to))) continue
    edges.push({
      from: String(ed.from),
      to: String(ed.to),
      label: clip(ed.label, 32),
      kind: EDGE_KINDS.includes(ed.kind) ? ed.kind : 'call',
    })
  }

  return {
    title: clip(data.title || 'Diagram', 80),
    summary: clip(data.summary, 400),
    groups,
    nodes,
    edges,
  }
}

// Splits a label into at most two lines of about `width` characters.
export function wrapLabel(label, width = 24) {
  if (label.length <= width) return [label]
  const words = label.split(' ')
  let first = ''
  let i = 0
  while (i < words.length && (first + ' ' + words[i]).trim().length <= width) {
    first = (first + ' ' + words[i]).trim()
    i++
  }
  if (!first) return [label.slice(0, width), clip(label.slice(width), width)]
  return [first, clip(words.slice(i).join(' '), width)]
}

function nodeSize(node) {
  const lines = wrapLabel(node.label)
  const longest = Math.max(...lines.map(l => l.length), node.kind.length + 2)
  const width = Math.min(260, Math.max(120, Math.round(longest * 7.6 + 36)))
  const height = lines.length > 1 ? 62 : 48
  return { width, height, lines }
}

// Returns positioned nodes, routed edges ({ points, isBack }) and the canvas size for `dir` TB or LR.
export function layout(graph, dir = 'TB') {
  const isLR = dir === 'LR'
  const n = graph.nodes.length
  const index = new Map(graph.nodes.map((node, i) => [node.id, i]))

  // Break cycles: an edge into a node still on the DFS stack is laid out reversed.
  const out = graph.nodes.map(() => [])
  graph.edges.forEach((ed, k) => {
    if (ed.from !== ed.to) out[index.get(ed.from)].push(k)
  })
  const isBack = new Array(graph.edges.length).fill(false)
  const state = new Array(n).fill(0)
  const visit = v => {
    state[v] = 1
    for (const k of out[v]) {
      const w = index.get(graph.edges[k].to)
      if (state[w] === 1) isBack[k] = true
      else if (state[w] === 0) visit(w)
    }
    state[v] = 2
  }
  for (let v = 0; v < n; v++) if (state[v] === 0) visit(v)

  // Forward edges as [u, v, edgeIndex].
  const forward = []
  graph.edges.forEach((ed, k) => {
    if (ed.from === ed.to) return
    const u = index.get(ed.from)
    const v = index.get(ed.to)
    forward.push(isBack[k] ? [v, u, k] : [u, v, k])
  })

  // Longest-path ranks.
  const rank = new Array(n).fill(0)
  for (let pass = 0; pass < n; pass++) {
    let changed = false
    for (const [u, v] of forward) {
      if (rank[v] < rank[u] + 1) {
        rank[v] = rank[u] + 1
        changed = true
      }
    }
    if (!changed) break
  }
  // Pull sinks-free sources down next to their first child, so roots don't all pile on top.
  for (let v = 0; v < n; v++) {
    const children = forward.filter(([u]) => u === v).map(([, w]) => rank[w])
    const parents = forward.filter(([, w]) => w === v)
    if (parents.length === 0 && children.length) rank[v] = Math.min(...children) - 1
  }

  // Layout vertices: real nodes plus dummies along long edges.
  const verts = graph.nodes.map((node, i) => ({ real: i, rank: rank[i], ...nodeSize(node) }))
  const links = []
  const chains = new Map()
  for (const [u, v, k] of forward) {
    let prev = u
    const chain = [u]
    for (let r = rank[u] + 1; r < rank[v]; r++) {
      verts.push({ real: -1, rank: r, width: DUMMY_WIDTH, height: 0, lines: [] })
      const d = verts.length - 1
      links.push([prev, d])
      chain.push(d)
      prev = d
    }
    links.push([prev, v])
    chain.push(v)
    chains.set(k, chain)
  }

  const maxRank = Math.max(0, ...verts.map(v => v.rank))
  const layers = Array.from({ length: maxRank + 1 }, () => [])
  const groupOrder = new Map(graph.groups.map((g, i) => [g.id, i]))
  verts
    .map((v, i) => i)
    .sort((a, b) => {
      const ga = verts[a].real >= 0 ? groupOrder.get(graph.nodes[verts[a].real].group) ?? 99 : 99
      const gb = verts[b].real >= 0 ? groupOrder.get(graph.nodes[verts[b].real].group) ?? 99 : 99
      return ga - gb || a - b
    })
    .forEach(i => layers[verts[i].rank].push(i))

  const up = verts.map(() => [])
  const down = verts.map(() => [])
  for (const [a, b] of links) {
    down[a].push(b)
    up[b].push(a)
  }

  // Barycenter sweeps to reduce crossings.
  const pos = new Array(verts.length).fill(0)
  const setPos = () => layers.forEach(layer => layer.forEach((v, i) => (pos[v] = i)))
  setPos()
  const bary = (v, nbrs) => (nbrs[v].length ? nbrs[v].reduce((s, w) => s + pos[w], 0) / nbrs[v].length : pos[v])
  for (let sweep = 0; sweep < 6; sweep++) {
    const order = sweep % 2 === 0 ? layers.keys() : [...layers.keys()].reverse()
    for (const r of order) {
      const nbrs = sweep % 2 === 0 ? up : down
      layers[r].sort((a, b) => bary(a, nbrs) - bary(b, nbrs))
      setPos()
    }
  }

  // Cross-axis positions (x for TB, y for LR): pack each layer, then nudge toward neighbours.
  const cross = v => (verts[v].real < 0 ? DUMMY_WIDTH : isLR ? verts[v].height : verts[v].width)
  const along = v => (verts[v].real < 0 ? 0 : isLR ? verts[v].width : verts[v].height)
  const gap = isLR ? 22 : NODE_GAP
  const c = new Array(verts.length).fill(0)
  for (const layer of layers) {
    let cursor = 0
    for (const v of layer) {
      c[v] = cursor + cross(v) / 2
      cursor += cross(v) + gap
    }
  }
  const resolve = layer => {
    for (let i = 1; i < layer.length; i++) {
      const a = layer[i - 1]
      const b = layer[i]
      const min = c[a] + (cross(a) + cross(b)) / 2 + gap
      if (c[b] < min) c[b] = min
    }
    for (let i = layer.length - 2; i >= 0; i--) {
      const a = layer[i]
      const b = layer[i + 1]
      const max = c[b] - (cross(a) + cross(b)) / 2 - gap
      if (c[a] > max) c[a] = max
    }
  }
  for (let iter = 0; iter < 8; iter++) {
    const nbrs = iter % 2 === 0 ? up : down
    const order = iter % 2 === 0 ? [...layers.keys()] : [...layers.keys()].reverse()
    for (const r of order) {
      for (const v of layers[r]) {
        if (nbrs[v].length) c[v] = (c[v] + nbrs[v].reduce((s, w) => s + c[w], 0) / nbrs[v].length) / 2
      }
      resolve(layers[r])
    }
  }

  // Rank-axis positions (y for TB, x for LR). LR leaves room for edge labels between ranks.
  const longestLabel = Math.max(0, ...graph.edges.map(ed => ed.label.length))
  const rankGap = isLR ? Math.min(230, Math.max(90, Math.round(longestLabel * 6.2 + 44))) : RANK_GAP
  const layerSize = layers.map(layer => Math.max(0, ...layer.map(along)))
  const a = new Array(verts.length).fill(0)
  let top = 0
  layers.forEach((layer, r) => {
    for (const v of layer) a[v] = top + layerSize[r] / 2
    top += layerSize[r] + rankGap
  })

  // Shift into the canvas.
  const minC = Math.min(...verts.map((v, i) => c[i] - cross(i) / 2))
  const maxC = Math.max(...verts.map((v, i) => c[i] + cross(i) / 2))
  const dc = PAD - minC
  const crossSpan = Math.round(maxC - minC + PAD * 2 + 40)
  const alongSpan = Math.round(top - rankGap + PAD * 2)
  const at = i => (isLR ? { x: a[i] + PAD, y: c[i] + dc } : { x: c[i] + dc, y: a[i] + PAD })

  const nodes = graph.nodes.map((node, i) => ({
    ...node,
    ...at(i),
    width: verts[i].width,
    height: verts[i].height,
    lines: verts[i].lines,
  }))

  const edges = graph.edges.map((ed, k) => {
    if (ed.from === ed.to) return { ...ed, points: [], isSelf: true, isBack: false }
    const chain = chains.get(k)
    const points = chain.map(at)
    // Leave from the far side of the first box and enter the near side of the last.
    const first = chain[0]
    const last = chain[chain.length - 1]
    if (isLR) {
      points[0].x += along(first) / 2
      points[points.length - 1].x -= along(last) / 2
    } else {
      points[0].y += along(first) / 2
      points[points.length - 1].y -= along(last) / 2
    }
    if (isBack[k]) points.reverse()
    return { ...ed, points, isSelf: false, isBack: isBack[k] }
  })

  return isLR
    ? { dir, width: alongSpan, height: crossSpan, nodes, edges }
    : { dir, width: crossSpan, height: alongSpan, nodes, edges }
}
