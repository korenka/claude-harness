// State contract of agent-dock: the agent types it lists, the runs it controls
// and the context window fill shown above the prompt.

/** Where an agent is defined: the project's or the user's agents folder, or the engine. */
export type AgentScope = 'project' | 'user' | 'built-in'

/** One agent type the person can run. */
export type AgentEntry = { name: string; description: string; model: string; scope: AgentScope }

/**
 * A run of one agent type. `paused` is a run stopped with TaskStop whose
 * transcript is kept, so a message can resume it under the same id.
 */
export type AgentRunStatus = 'running' | 'paused' | 'done'
export type AgentRun = { agentId: string; status: AgentRunStatus; startedAt: number }

/** The context window's fill as the status line reads it. */
export type ContextFill = { tokens: number; window: number; percent: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-dock': {
      agents: AgentEntry[]
      runs: Record<string, AgentRun>
      tick: number
      context: ContextFill | null
      /** The agent whose task or reply field is open in the panel; '' for none. */
      draft: string
      /** Each run's last answer by agent name, kept when its turn ends. */
      said: Record<string, string>
    }
  }
}
