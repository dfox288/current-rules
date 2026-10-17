import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

// The Nuxt flat config, standalone (no @nuxt/eslint module in nuxt.config.ts). `.tmp/` holds the gate logs.
// `await`: ESLint 10 rejects the lazy composer createConfigForNuxt returns.
export default await createConfigForNuxt({}, { ignores: ['.tmp/**'] })
