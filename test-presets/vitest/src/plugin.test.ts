import { describe, expect, it } from 'vitest'
import { expandShapeTestImport } from './plugin.js'

const IMPORT = `import '@dfox288/test-preset-vitest/checks-map-test'`

describe('the shape test file, expanded for Vitest\'s static scan', () => {
  it('turns a file that is only the import into an it the scan can see', () => {
    const code = expandShapeTestImport(`${IMPORT}\n`)
    expect(code).toMatch(/^it\('checks\.map\.yml has the shape of version 2 \(selection\.md\)', checksMapTest\)$/m)
    expect(code).toContain(`from 'vitest'`)
  })

  it('reads the usual spellings of that file: semicolon, double quotes, comments, no final newline', () => {
    for (const source of [
      `${IMPORT};`,
      `import "@dfox288/test-preset-vitest/checks-map-test"\n\n`,
      `// the shape test of checks.map.yml\n${IMPORT}\n`,
      `/* the shape test */\n// and more\n${IMPORT}`,
    ])
      expect(expandShapeTestImport(source), source).toBeDefined()
  })

  it('leaves every other file alone, including one that has its own test beside the import', () => {
    for (const source of [
      '',
      `import { it } from 'vitest'\nit('x', () => {})\n`,
      `${IMPORT}\nimport { it } from 'vitest'\nit('version is 2', () => {})\n`,
      `import '@dfox288/test-preset-vitest/checks-map'\n`,
      `import '@dfox288/test-preset-vitest/checks-map-test-extra'\n`,
      `const x = 1 // ${IMPORT}\n`,
    ])
      expect(expandShapeTestImport(source), source).toBeUndefined()
  })
})
