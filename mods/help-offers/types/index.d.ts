// State contract for the help-offers mod.
export type OfferStatus = 'idle' | 'running' | 'done' | 'failed'

export type Offer = {
  id: string
  text: string
  status: OfferStatus
  agentId?: string
  reportPath?: string
}

declare module 'claude-code' {
  interface PluginState {
    'help-offers': { offers: Offer[] }
  }
}
