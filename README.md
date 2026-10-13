# claude-harness

My personal Claude Code harness: mods (UI plugins) and the rules I load into every session.

## Mods

Each mod lives in its own folder under `mods/`.

| Mod | What it does |
| --- | --- |
| `tldr` | Adds a TLDR button that summarizes Claude's latest response in a side pane. |
| `diagram` | Adds a Diagram button that draws the flow or architecture from Claude's latest response, saved as SVG and draw.io. |
| `agent-dock` | Agents side panel with run, pause, stop and open-in-tab controls, plus a context window bar with a Compact button. |
| `rephrase` | Adds a Rephrase button that rewrites your draft prompt with Haiku so the LLM reads it clearly, with an Undo button. |
| `blind-spots` | Adds a Blind Spots button (and `/blind-spots`) that asks Claude to list the engineering gaps in the current plan or design. |
| `help-offers` | Turns the "How I can help" list at the end of an answer into buttons that start a subagent for each offer. |

### Install

Type this at the Claude Code prompt, once per mod:

```
/plugin install tldr --marketplace korenka/claude-harness
```

Answer `y` to add the marketplace, then pick a scope.

### Updates

Plugins here have no `version` field, so every push is a new version. To get updates without running `/plugin update` by hand, turn on auto-update for this marketplace in `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "claude-harness": {
      "source": { "source": "github", "repo": "korenka/claude-harness" },
      "autoUpdate": true
    }
  }
}
```

## Rules

`rules/` holds plain Markdown instructions. Plugins can't ship them, so import the ones you want from your own `~/.claude/CLAUDE.md`:

```
@~/path/to/claude-harness/rules/communication.md
@~/path/to/claude-harness/rules/writing.md
@~/path/to/claude-harness/rules/engineering.md
```

## Developing

Clone the repo and add the clone as a local marketplace:

```
claude plugin marketplace add ~/path/to/claude-harness
```

Edits to a folder under `mods/` take effect after `/reload-plugins`. No version bump is needed.
