// TLDR mod: a button above the prompt (and a /tldr command) that summarizes
// Claude's latest response with a small model and shows it in a side pane.

const PANE = 'tldr'
const MAX_SOURCE_CHARS = 60000

const SYSTEM = [
  'You write a TLDR of an AI coding assistant\'s reply for a busy engineer.',
  'Lead with the bottom line in one sentence.',
  'Then at most 4 short bullets with the key facts, decisions, or things the reader must do.',
  'Use simple, plain language (CEFR B2). Short sentences. Keep real names of files, commands, and tools.',
  'Do not use em dashes, en dashes, or semicolons. No filler, no praise, no closing summary.',
  'Output Markdown only. Never add facts that are not in the reply.',
].join(' ')

// idle | loading | done | error
let status = 'idle'
let summary = ''
let lastSource = ''

// The assistant text of the most recent turn that has any, joined in order.
function latestResponse(messages) {
  const parts = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const text = (m.text || '').trim()
    if (m.role === 'assistant') {
      if (text) parts.unshift(text)
      continue
    }
    const isToolResult = Array.isArray(m.toolResults) && m.toolResults.length > 0
    if (m.role === 'user' && !isToolResult && text && parts.length) break
  }
  return parts.join('\n\n')
}

async function summarize($, force) {
  const source = latestResponse(await $.session.messages())
  if (!source) {
    status = 'error'
    summary = 'There is no response to summarize yet.'
    $.ui.invalidate('ui.render')
    return
  }
  if (!force && source === lastSource && status === 'done') return

  status = 'loading'
  $.ui.invalidate('ui.render')

  try {
    const r = await $.model.complete({
      model: 'haiku',
      system: SYSTEM,
      prompt: 'Write a TLDR of this reply:\n\n' + source.slice(-MAX_SOURCE_CHARS),
      maxTokens: 400,
      timeoutMs: 30000,
    })
    const text = r.isAnswered ? r.text : null
    if (text && text.trim()) {
      status = 'done'
      summary = text.trim()
      lastSource = source
    } else {
      status = 'error'
      summary = 'The model did not answer: ' + r.reason
    }
  } catch (err) {
    status = 'error'
    summary = 'TLDR failed: ' + (err && err.message ? err.message : String(err))
  }
  $.ui.invalidate('ui.render')
}

async function openAndSummarize($, force) {
  await $.ui.open({ id: PANE, title: 'TLDR', focus: true, closeOnEscape: true })
  await summarize($, force)
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'tldr',
        description: 'Summarize Claude\'s latest response in a side pane',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('could not register /tldr: ' + err.message)
    }
    return next(e)
  })

  on('command.run', { command: 'tldr' }, async ($) => {
    await openAndSummarize($, false)
    return {}
  })

  // The TLDR button in the band above the prompt. Keeps other mods' band content.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    if (e.props.isWorking) return theirs
    const { Box, Button } = $.ui.resolve(e)
    const button = Button({
      key: 'tldr-open',
      label: 'TLDR',
      onPress: () => openAndSummarize($, false),
    })
    return Box({
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 1,
      children: theirs ? [theirs, button] : [button],
    })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)

    const body =
      status === 'loading'
        ? Text({ dimColor: true, children: ['Summarizing the latest response…'] })
        : status === 'idle'
          ? Text({ dimColor: true, children: ['Press Refresh to summarize the latest response.'] })
          : Markdown({ key: 'tldr-text', text: summary })

    const actions = [
      Button({ key: 'tldr-refresh', label: 'Refresh', hotkey: 'r', onPress: () => summarize($, true) }),
    ]
    if (status === 'done') {
      actions.push(Button({ key: 'tldr-copy', label: 'Copy', hotkey: 'c', onPress: (press) => $.ui.copy({ text: summary, surface: press.surface }) }))
    }

    return Box({
      flexDirection: 'column',
      rowGap: 1,
      children: [body, Box({ flexDirection: 'row', columnGap: 2, children: actions })],
    })
  })
}
