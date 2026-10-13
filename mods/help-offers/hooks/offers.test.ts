// Tests for the offer parser.
import { expect, test } from 'claude-code/testing'
import { labelOf, parseOffers } from './offers'

const DIGEST = `**Question for you:** whose incident?

**How I can help**
- \`RED-217788\`: I can look in the code at how shard_mgr and dmc_mgr read tree updates.
- Genspark incident: I can run classify-owning-team.
- \`RED-216700\`: I can build the state contract with the tdd skill.

Something after.`

test('finds the bullets under the English heading', () => {
  const offers = parseOffers(DIGEST)
  expect(offers.length).toBe(3)
  expect(offers[1]).toBe('Genspark incident: I can run classify-owning-team.')
})

test('finds the bullets under the Hebrew heading with RTL marks', () => {
  const offers = parseOffers('‏**איך אני יכול לעזור**\n- ‏בטסטים: אני יכול לנסח\n- ‏בתקלה: אני יכול לבדוק\n')
  expect(offers).toEqual(['בטסטים: אני יכול לנסח', 'בתקלה: אני יכול לבדוק'])
})

test('returns nothing without the heading', () => {
  expect(parseOffers('- a\n- b')).toEqual([])
})

test('labels drop markdown', () => {
  expect(labelOf('`RED-1`: do **x**')).toBe('RED-1: do x')
})
