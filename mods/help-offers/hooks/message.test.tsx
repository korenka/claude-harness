// Tests that a reply with a "How I can help" list is drawn with one button per offer.
import { expect, test } from 'claude-code/testing'

const DIGEST = `Done.

**How I can help**
- \`RED-217788\`: I can look in the code at how shard_mgr reads tree updates.
- \`RED-216700\`: I can build the state contract with the tdd skill.
`

test('offers in a reply become buttons', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'help-offers',
      surface,
      component: 'AssistantMessage',
      requestId: 'm1',
      props: { text: DIGEST, isFirstOfReply: true },
    })
    expect(await ui.find({ key: 'offer-0' })).toBeDefined()
    expect(await ui.find({ key: 'offer-1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /engine row/ })).toBeUndefined()
    await ui.unmount()
  }

  const plain = await $.ui.mount({
    plugin: 'help-offers',
    surface: 'desktop',
    component: 'AssistantMessage',
    requestId: 'm2',
    props: { text: 'No list here.', isFirstOfReply: true },
  })
  expect(await plain.find({ type: 'Text', text: /engine row/ })).toBeDefined()
})
