// Blind Spots: a button above the prompt (and /blind-spots) that asks Claude to review the plan or design in this conversation for engineering gaps.
import type { EngineInterface, Register } from 'claude-code'

export const PROMPT = `Review the feature plan, design or task list discussed in this conversation so far. List the engineering blind spots it has not addressed yet. Focus mainly on architecture, then on the task breakdown.

Sweep every topic below. Report only the ones that apply and are not already covered. For each one give:
- the gap, in one line
- why it matters for this specific design (a concrete failure, cost or scenario)
- a suggested way to prevent it during planning

Topics to sweep:
1. Trade-offs: what was chosen, what was given up, and whether the alternatives were weighed.
2. Time complexity: hot paths, loops over large collections, N+1 calls, work that grows with nodes, shards or databases.
3. Space complexity: memory growth, unbounded caches, queues or lists, payload and state size.
4. Concurrency: race conditions, ordering, locking, lost updates, check-then-act gaps, two writers on the same record.
5. Consistency and atomicity: multi-step writes, transactions and optimistic locking, partial updates, source of truth.
6. Idempotency and retries: can each step run twice safely, resume after a crash, and be retried without side effects.
7. Failure modes: partial failure, timeouts, dependency down, network partition, leader change or failover mid-operation.
8. Throughput and traffic: expected load, peaks, fan-out, hot keys or hot nodes, scaling limits.
9. Rate: rate limiting, polling intervals, retry storms, backoff, thundering herd.
10. Backpressure: what happens when a consumer is slower than the producer.
11. Design and OOP: responsibilities, coupling, abstraction leaks, layering rules, extension points, duplication with existing code.
12. API and data contracts: versioning, backward compatibility, schema changes, defaults for existing objects.
13. Upgrade, rollout and rollback: mixed-version clusters, migrations, feature flags, safe downgrade.
14. Security: authentication, authorization, input validation, secrets, data exposure in logs.
15. Observability: logs, metrics, alerts and events needed to debug this in production.
16. Configuration: new settings, sane defaults, limits, who can change them.
17. Testing: unit, component and e2e coverage, hard-to-test paths, how to reproduce races and failures.
18. Operations: support burden, manual steps, cleanup of leftovers, resource leaks.
19. Tasks: missing tasks, wrong order, hidden dependencies, unclear owners, scope creep, rough effort risks.
20. Anything else an experienced engineer would raise in a design review.

Format: group the findings by topic, most severe first. Skip the topics with nothing to report, then list their names on one line at the end as "No gaps found in: ...". If there is no plan or design in this conversation yet, say so in one sentence and stop.`

const ask = ($: EngineInterface) => $.prompt.submit({ text: PROMPT })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'blind-spots',
      description: 'List engineering blind spots in the current plan or design',
    })

    return next(e)
  })

  on('command.run', { command: 'blind-spots' }, async $ => {
    void ask($)

    return { text: 'Blind spots check queued.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const others = await next(e)
    if (e.props.hasSurvey) return others
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {others}
        <Button
          key="blind-spots"
          label="Blind Spots"
          onPress={() => {
            $.ui.toast('Blind spots check queued')
            void ask($)
          }}
        />
      </Box>
    )
  })
}
