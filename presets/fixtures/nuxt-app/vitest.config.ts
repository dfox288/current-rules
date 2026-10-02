import { defineTestConfig } from '@dfox288/test-preset-vitest'

export default defineTestConfig({
  unit: { include: ['test/unit/**/*.test.ts'] },
  nuxt: { include: ['test/nuxt/**/*.test.ts'] },
  e2e: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    globalSetup: ['test/e2e/global-setup.ts'],
    hookTimeout: 120_000,
  },
})
