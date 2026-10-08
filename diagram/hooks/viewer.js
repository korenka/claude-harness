// Builds a standalone HTML viewer for a diagram: fit-to-window, wheel zoom,
// drag to pan, and a toggle between the left-to-right and top-down layouts.

import { esc } from './svg.js'

export function renderViewer(graph, svgs) {
  const data = JSON.stringify({ LR: svgs.LR, TB: svgs.TB }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(graph.title)}</title>
<style>
  :root { color-scheme: light dark; --bg:#f1f5f9; --panel:#ffffff; --text:#0f172a; --muted:#64748b; --line:#e2e8f0; --accent:#6366f1; }
  @media (prefers-color-scheme: dark) { :root { --bg:#070b16; --panel:#111827; --text:#e2e8f0; --muted:#94a3b8; --line:#1f2937; } }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif; }
  header { position: fixed; inset: 0 0 auto 0; z-index: 2; display: flex; align-items: center; gap: 16px;
    padding: 12px 20px; background: color-mix(in srgb, var(--panel) 88%, transparent);
    backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
  .titles { flex: 1; min-width: 0; }
  h1 { margin: 0; font-size: 16px; font-weight: 650; }
  p { margin: 2px 0 0; color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tools { display: flex; gap: 8px; }
  button { font: inherit; font-size: 13px; color: var(--text); background: var(--panel); border: 1px solid var(--line);
    border-radius: 8px; padding: 6px 12px; cursor: pointer; }
  button:hover { border-color: var(--accent); }
  button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  #stage { position: fixed; inset: 0; overflow: hidden; cursor: grab; }
  #stage.dragging { cursor: grabbing; }
  #canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  #canvas svg { display: block; border-radius: 12px; box-shadow: 0 10px 30px rgba(15, 23, 42, .12); }
  .hint { position: fixed; right: 16px; bottom: 12px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header>
  <div class="titles"><h1>${esc(graph.title)}</h1><p>${esc(graph.summary)}</p></div>
  <div class="tools">
    <button id="lr">Left to right</button>
    <button id="tb">Top down</button>
    <button id="fit">Fit</button>
    <button id="out">−</button>
    <button id="in">+</button>
  </div>
</header>
<div id="stage"><div id="canvas"></div></div>
<div class="hint">Scroll to zoom · drag to pan · hover a box to trace its links</div>
<script>
  const SVGS = ${data};
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('canvas');
  let dir = 'LR', scale = 1, x = 0, y = 0, size = { w: 1, h: 1 };
  const apply = () => { canvas.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')'; };
  const fit = () => {
    const top = 72, pad = 32;
    const w = stage.clientWidth - pad * 2, h = stage.clientHeight - top - pad * 2;
    scale = Math.min(w / size.w, h / size.h, 3);
    x = (stage.clientWidth - size.w * scale) / 2;
    y = top + pad + (h - size.h * scale) / 2;
    apply();
  };
  const show = next => {
    dir = next;
    canvas.innerHTML = SVGS[dir];
    const svg = canvas.querySelector('svg');
    size = { w: +svg.getAttribute('width'), h: +svg.getAttribute('height') };
    document.getElementById('lr').classList.toggle('on', dir === 'LR');
    document.getElementById('tb').classList.toggle('on', dir === 'TB');
    fit();
  };
  const zoomAt = (factor, cx, cy) => {
    const next = Math.min(8, Math.max(0.1, scale * factor));
    x = cx - (cx - x) * (next / scale);
    y = cy - (cy - y) * (next / scale);
    scale = next;
    apply();
  };
  stage.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
  let drag = null;
  stage.addEventListener('pointerdown', e => { drag = { sx: e.clientX - x, sy: e.clientY - y }; stage.classList.add('dragging'); stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', e => { if (drag) { x = e.clientX - drag.sx; y = e.clientY - drag.sy; apply(); } });
  stage.addEventListener('pointerup', () => { drag = null; stage.classList.remove('dragging'); });
  document.getElementById('lr').onclick = () => show('LR');
  document.getElementById('tb').onclick = () => show('TB');
  document.getElementById('fit').onclick = fit;
  document.getElementById('in').onclick = () => zoomAt(1.25, stage.clientWidth / 2, stage.clientHeight / 2);
  document.getElementById('out').onclick = () => zoomAt(0.8, stage.clientWidth / 2, stage.clientHeight / 2);
  addEventListener('resize', fit);
  addEventListener('keydown', e => { if (e.key === '0') fit(); if (e.key === '+' || e.key === '=') zoomAt(1.25, stage.clientWidth / 2, stage.clientHeight / 2); if (e.key === '-') zoomAt(0.8, stage.clientWidth / 2, stage.clientHeight / 2); });
  show(SVGS.LR.length && (innerWidth >= innerHeight) ? 'LR' : 'TB');
</script>
</body>
</html>
`
}
