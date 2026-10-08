// State contract of rephrase: whether a rewrite is running and the draft it replaced.

declare module 'claude-code' {
  interface PluginState {
    rephrase: {
      /** True while the model rewrites the draft. */
      busy: boolean
      /** The draft before the last rewrite, for Undo; '' when there is nothing to undo. */
      original: string
    }
  }
}

export {}
