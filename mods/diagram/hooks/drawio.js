// Exports a laid-out graph as an editable draw.io (diagrams.net) file.

import { EDGE_STYLES, esc, groupColor } from './svg.js'

export function renderDrawio(graph, laid) {
  const ids = new Map(laid.nodes.map((n, i) => [n.id, 'n' + i]))
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']

  laid.nodes.forEach((n, i) => {
    const color = groupColor(graph, n.group)
    const shape = n.kind === 'store' ? 'shape=cylinder3;boundedLbl=1;size=8;' : n.kind === 'decision' ? 'rhombus;' : ''
    const rounded = n.kind === 'event' ? 'rounded=1;arcSize=50;' : 'rounded=1;arcSize=18;'
    const style = `${shape}${rounded}whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=${color};strokeWidth=2;fontStyle=1;fontSize=13;`
    const value = `<span style="font-size:10px;color:${color}">${esc(n.kind.toUpperCase())}</span><br>${esc(n.label)}`
    cells.push(
      `<mxCell id="n${i}" value="${esc(value)}" tooltip="${esc(n.detail)}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${Math.round(n.x - n.width / 2)}" y="${Math.round(n.y - n.height / 2)}" width="${n.width}" height="${n.height}" as="geometry"/></mxCell>`,
    )
  })

  laid.edges.forEach((e, k) => {
    const s = EDGE_STYLES[e.kind]
    const dash = s.dash ? `dashed=1;dashPattern=${s.dash};` : ''
    const style = `edgeStyle=orthogonalEdgeStyle;curved=1;rounded=1;html=1;endArrow=block;endFill=1;strokeColor=${s.color};strokeWidth=1.6;fontSize=11;${dash}`
    cells.push(
      `<mxCell id="e${k}" value="${esc(e.label)}" style="${style}" edge="1" parent="1" source="${ids.get(e.from)}" target="${ids.get(e.to)}">` +
        `<mxGeometry relative="1" as="geometry"/></mxCell>`,
    )
  })

  return (
    `<mxfile host="claude-code-diagram-mod"><diagram name="${esc(graph.title)}">` +
    `<mxGraphModel dx="${laid.width}" dy="${laid.height}" grid="1" gridSize="10" guides="1" page="0">` +
    `<root>${cells.join('')}</root></mxGraphModel></diagram></mxfile>\n`
  )
}
