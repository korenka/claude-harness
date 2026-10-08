// Draws a laid-out graph as a styled SVG document: group-colored cards, typed
// edges with labels, hover tooltips, and hover highlighting of a node's links.

const GROUP_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#14b8a6', '#f97316']
const NO_GROUP_COLOR = '#64748b'

export const EDGE_STYLES = {
  call: { color: '#475569', dash: '', name: 'calls' },
  trigger: { color: '#d97706', dash: '6 4', name: 'triggers' },
  async: { color: '#7c3aed', dash: '6 4', name: 'async / message' },
  data: { color: '#0891b2', dash: '2 4', name: 'reads / writes data' },
  returns: { color: '#94a3b8', dash: '4 3', name: 'returns' },
}

const KIND_GLYPH = {
  service: '▣',
  component: '◧',
  function: 'ƒ',
  state: '◉',
  event: '⚡',
  store: '⛁',
  external: '↗',
  user: '☺',
  decision: '◆',
}

const BACK_OFFSET = 14
const LEGEND_ROW = 22

export function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function groupColor(graph, groupId) {
  const i = graph.groups.findIndex(g => g.id === groupId)
  return i < 0 ? NO_GROUP_COLOR : GROUP_COLORS[i % GROUP_COLORS.length]
}

function curve(points, isLR) {
  if (points.length < 2) return ''
  const f = v => v.toFixed(1)
  let d = `M${f(points[0].x)},${f(points[0].y)}`
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (isLR) {
      const dx = (b.x - a.x) * 0.5
      d += ` C${f(a.x + dx)},${f(a.y)} ${f(b.x - dx)},${f(b.y)} ${f(b.x)},${f(b.y)}`
    } else {
      const dy = (b.y - a.y) * 0.5
      d += ` C${f(a.x)},${f(a.y + dy)} ${f(b.x)},${f(b.y - dy)} ${f(b.x)},${f(b.y)}`
    }
  }
  return d
}

function midpoint(points) {
  if (points.length === 2) return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
  return points[Math.floor(points.length / 2)]
}

function edgePath(edge, nodeById, isLR) {
  if (edge.isSelf) {
    const n = nodeById.get(edge.from)
    const x = n.x + n.width / 2
    const y = n.y
    return {
      d: `M${x},${y - 10} C${x + 46},${y - 34} ${x + 46},${y + 34} ${x},${y + 10}`,
      mid: { x: x + 40, y },
    }
  }
  const shift = p => (isLR ? { x: p.x, y: p.y + BACK_OFFSET } : { x: p.x + BACK_OFFSET, y: p.y })
  const points = edge.isBack ? edge.points.map(shift) : edge.points
  return { d: curve(points, isLR), mid: midpoint(points) }
}

export function renderSvg(graph, laid) {
  const nodeById = new Map(laid.nodes.map(n => [n.id, n]))
  const usedKinds = [...new Set(laid.edges.map(e => e.kind))]
  const legendItems = [
    ...graph.groups.map(g => ({ type: 'group', label: g.label, color: groupColor(graph, g.id) })),
    ...usedKinds.map(k => ({ type: 'edge', label: EDGE_STYLES[k].name, kind: k })),
  ]
  const legendCols = Math.max(1, Math.floor(laid.width / 190))
  const legendRows = Math.ceil(legendItems.length / legendCols)
  const legendTop = laid.height + 6
  const height = laid.height + (legendItems.length ? legendRows * LEGEND_ROW + 26 : 0)
  const width = Math.max(laid.width, 380)

  const css = [
    'svg{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Helvetica,Arial,sans-serif}',
    '.bg{fill:#f8fafc}',
    '.card{fill:#ffffff;stroke:#e2e8f0;stroke-width:1}',
    '.label{fill:#0f172a;font-size:13px;font-weight:600}',
    '.kind{font-size:10px;font-weight:600;letter-spacing:.06em}',
    '.elabel-bg{fill:#f8fafc;stroke:#e2e8f0;stroke-width:.8}',
    '.elabel{fill:#334155;font-size:11px}',
    '.legend{fill:#475569;font-size:11px}',
    '.edge path.line{fill:none;stroke-width:1.6}',
    '.edge,.node{transition:opacity .15s}',
    '.node:hover .card{stroke:#6366f1;stroke-width:2}',
    'svg:has(.node:hover) .edge{opacity:.12}',
    'svg:has(.node:hover) .node{opacity:.35}',
    '@media (prefers-color-scheme: dark){',
    '.bg{fill:#0b1020}.card{fill:#151b2e;stroke:#2a3350}.label{fill:#e2e8f0}',
    '.elabel-bg{fill:#0b1020;stroke:#2a3350}.elabel{fill:#cbd5e1}.legend{fill:#94a3b8}}',
  ]
  // Hovering a node keeps it, its neighbours and its edges lit.
  laid.nodes.forEach((n, i) => {
    const touching = laid.edges
      .map((e, k) => (e.from === n.id || e.to === n.id ? k : -1))
      .filter(k => k >= 0)
    const neighbours = new Set(touching.flatMap(k => [laid.edges[k].from, laid.edges[k].to]))
    const lit = [
      ...touching.map(k => `svg:has(.n${i}:hover) .e${k}`),
      ...[...neighbours].map(id => `svg:has(.n${i}:hover) .n${laid.nodes.findIndex(m => m.id === id)}`),
      `svg:has(.n${i}:hover) .n${i}`,
    ]
    css.push(`${lit.join(',')}{opacity:1}`)
  })

  const markers = Object.entries(EDGE_STYLES)
    .map(
      ([k, s]) =>
        `<marker id="arrow-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${s.color}"/></marker>`,
    )
    .join('')

  const edgeSvg = laid.edges
    .map((e, k) => {
      const s = EDGE_STYLES[e.kind]
      const { d, mid } = edgePath(e, nodeById, laid.dir === 'LR')
      const from = nodeById.get(e.from).label
      const to = nodeById.get(e.to).label
      const title = `${from} ${s.name} ${to}${e.label ? ': ' + e.label : ''}`
      let label = ''
      if (e.label) {
        const w = Math.round(e.label.length * 6.1 + 12)
        label =
          `<rect class="elabel-bg" x="${(mid.x - w / 2).toFixed(1)}" y="${(mid.y - 9).toFixed(1)}" width="${w}" height="18" rx="9"/>` +
          `<text class="elabel" x="${mid.x.toFixed(1)}" y="${(mid.y + 4).toFixed(1)}" text-anchor="middle">${esc(e.label)}</text>`
      }
      return (
        `<g class="edge e${k}"><title>${esc(title)}</title>` +
        `<path class="line" d="${d}" stroke="${s.color}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} marker-end="url(#arrow-${e.kind})"/>` +
        `${label}</g>`
      )
    })
    .join('')

  const nodeSvg = laid.nodes
    .map((n, i) => {
      const color = groupColor(graph, n.group)
      const x = n.x - n.width / 2
      const y = n.y - n.height / 2
      const group = graph.groups.find(g => g.id === n.group)
      const title = [n.label, `${n.kind}${group ? ' · ' + group.label : ''}`, n.detail].filter(Boolean).join('\n')
      const rx = n.kind === 'event' ? n.height / 2 : 10
      const lines = n.lines
        .map(
          (line, j) =>
            `<text class="label" x="${(x + 16).toFixed(1)}" y="${(y + 36 + j * 16).toFixed(1)}">${esc(line)}</text>`,
        )
        .join('')
      return (
        `<g class="node n${i}"><title>${esc(title)}</title>` +
        `<rect class="card" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${n.width}" height="${n.height}" rx="${rx}" filter="url(#shadow)"/>` +
        `<rect x="${x.toFixed(1)}" y="${(y + 8).toFixed(1)}" width="4" height="${n.height - 16}" rx="2" fill="${color}"/>` +
        `<text class="kind" x="${(x + 16).toFixed(1)}" y="${(y + 18).toFixed(1)}" fill="${color}">${esc(KIND_GLYPH[n.kind] + ' ' + n.kind.toUpperCase())}</text>` +
        `${lines}</g>`
      )
    })
    .join('')

  const colWidth = width / legendCols
  const legendSvg = legendItems
    .map((item, i) => {
      const lx = 18 + (i % legendCols) * colWidth
      const ly = legendTop + 18 + Math.floor(i / legendCols) * LEGEND_ROW
      const swatch =
        item.type === 'group'
          ? `<rect x="${lx}" y="${ly - 9}" width="12" height="12" rx="3" fill="${item.color}"/>`
          : `<line x1="${lx}" y1="${ly - 3}" x2="${lx + 22}" y2="${ly - 3}" stroke="${EDGE_STYLES[item.kind].color}" stroke-width="1.8"${EDGE_STYLES[item.kind].dash ? ` stroke-dasharray="${EDGE_STYLES[item.kind].dash}"` : ''}/>`
      const tx = item.type === 'group' ? lx + 18 : lx + 28
      return `${swatch}<text class="legend" x="${tx}" y="${ly + 1}">${esc(item.label)}</text>`
    })
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<style>${css.join('')}</style>` +
    `<defs>${markers}<filter id="shadow" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#0f172a" flood-opacity=".10"/></filter></defs>` +
    `<rect class="bg" x="0" y="0" width="${width}" height="${height}" rx="12"/>` +
    `<g>${edgeSvg}</g><g>${nodeSvg}</g>` +
    (legendItems.length ? `<line x1="18" y1="${legendTop}" x2="${width - 18}" y2="${legendTop}" stroke="#e2e8f0"/>${legendSvg}` : '') +
    `</svg>`
  )
}
