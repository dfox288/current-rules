import { it } from 'vitest'

// No test runs here (the only one is skipped), and an error outside any test reaches Vitest: a run that measured nothing.
it.skip('never runs', () => {})
void Promise.reject(new Error('planted unhandled rejection'))
