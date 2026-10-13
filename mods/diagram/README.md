# diagram

Draws the flow, feature or architecture from Claude's latest answer as a diagram in its own pane tab, and saves it as SVG and draw.io.

![Diagram pane showing a generated architecture diagram](docs/diagram.png)

## How to use

- Press **Diagram** above the prompt, or type `/diagram`.
- The diagram opens in a new pane tab with a title and a short summary.
- Pane buttons: **Regenerate** (`r`), **Expand** (`e`), **Open in draw.io** (`d`) and **Copy path** (`c`).

## How it works

- A fork of the current conversation describes the diagram as JSON: groups, nodes (service, store, state, event and more) and edges.
- The mod lays out the graph itself, left to right and top to bottom, and picks the one that fits the pane.
- Every diagram is saved to `~/claude-diagrams/<repo>/<timestamp>-<title>` in four formats:
  - `.svg` for docs and slides
  - `.drawio` to edit in draw.io
  - `.json` with the graph data
  - `.html`, a zoomable viewer you can open in a browser

## Install

```
/plugin install diagram --marketplace korenka/claude-harness
```
