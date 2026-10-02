import { expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import Greeting from '../../app/components/Greeting.vue'

it('renders the name', async () => {
  const wrapper = await mountSuspended(Greeting, { props: { name: 'Ada' } })
  expect(wrapper.text()).toBe('Hello Ada')
})
