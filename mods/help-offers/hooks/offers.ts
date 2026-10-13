// Finds the "How I can help" list in an answer and builds the subagent prompt for one offer.

const HEADING = /^(#+\s*|\*\*)?\s*(how i can help|איך אני יכול לעזור)(?![a-z֐-׿])/i
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/
const MARKS = /[‎‏‪-‮]/g

export const NOTES_FILE = '/Users/koren.kazoom/Documents/Notes/Walk to Work/Action Items.md'
export const REPORTS_DIR = '/Users/koren.kazoom/Documents/Notes/Walk to Work/Agent Reports'

export type OfferSplit = { before: string; heading: string; offers: string[]; after: string }

/** Splits an answer around its last "How I can help" list, or returns null when there is none. */
export function splitOffers(answer: string): OfferSplit | null {
  const lines = answer.split('\n')
  let start = -1
  lines.forEach((line, i) => {
    if (HEADING.test(line.replace(MARKS, '').trim())) start = i
  })
  if (start < 0) return null

  const offers: string[] = []
  let end = start + 1
  for (; end < lines.length; end++) {
    const line = lines[end] ?? ''
    const bullet = BULLET.exec(line.replace(MARKS, ''))
    if (bullet?.[1]) {
      offers.push(bullet[1].trim())
    } else if (line.trim() !== '' && offers.length > 0) {
      break
    }
  }
  if (offers.length === 0) return null

  return {
    before: lines.slice(0, start).join('\n').trimEnd(),
    heading: (lines[start] ?? '').replace(MARKS, '').replace(/[#*]/g, '').trim(),
    offers,
    after: lines.slice(end).join('\n').trim(),
  }
}

/** Returns the bullet texts under the last "How I can help" heading, or [] when there is none. */
export function parseOffers(answer: string): string[] {
  return splitOffers(answer)?.offers ?? []
}

/** A short one-line label for a button. */
export function labelOf(text: string, max = 90): string {
  const plain = text.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim()

  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}

export function slugOf(text: string): string {
  return labelOf(text, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'offer'
}

export function promptFor(text: string): string {
  return [
    `Koren clicked this offer from the "How I can help" list of the action items digest:`,
    '',
    `> ${text}`,
    '',
    'Do this task now.',
    '',
    `Background: the action items note is ${NOTES_FILE}. Read the matching item there first.`,
    'If the offer names a skill (for example tdd, classify-owning-team, cluster-architecture, close-pending-verification), load it with the Skill tool and follow it.',
    '',
    'Rules:',
    '- Research, read code, and draft. Local code and test changes in a feature branch are fine.',
    '- Do not send Slack messages or emails, create or edit Jira tickets, push, open PRs, or post anything. If the task is to file or send something, put the draft in your report.',
    '- Do not edit the action items note.',
    '',
    'End with a short report in plain English: what you found or built, the files you changed, open questions, and the next step for Koren. No em dashes, no semicolons.',
  ].join('\n')
}
