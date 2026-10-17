// node --test test-presets/init/init.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseYaml } from './init.mjs'

const INIT = join(import.meta.dirname, 'init.mjs')
const run = (...args) => spawnSync(process.execPath, [INIT, ...args], { encoding: 'utf8' })

/** A minimal Nuxt starter (what `nuxi init --template minimal` writes), in a fresh temp dir. */
function starter() {
  const dir = mkdtempSync(join(tmpdir(), 'init-test-'))
  mkdirSync(join(dir, 'app'))
  writeFileSync(join(dir, 'app/app.vue'), '<template><div>Hello</div></template>\n')
  writeFileSync(join(dir, 'nuxt.config.ts'), 'export default defineNuxtConfig({ compatibilityDate: "2026-01-01" })\n')
  writeFileSync(join(dir, 'README.md'), '# starter\n')
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n.nuxt\n')
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'starter', type: 'module', private: true, scripts: { build: 'nuxt build' }, dependencies: { nuxt: '^4.6.1', vue: '^3.5.43' } }, null, 2) + '\n',
  )
  return dir
}

test('init writes the entry files and --check passes', () => {
  const dir = starter()
  try {
    const done = run('--stack', 'nuxt', '--dir', dir)
    assert.equal(done.status, 0, done.stderr)
    for (const file of ['scripts/gates.mjs', 'gates.config.json', 'checks.map.yml', 'checks.kinds.yml', 'eslint.config.mjs', 'CLAUDE.md', '.npmrc'])
      assert.ok(existsSync(join(dir, file)), `${file} written`)
    assert.match(done.stdout, /^wrote checks\.kinds\.yml$/m)
    const kinds = parseYaml(readFileSync(join(dir, 'checks.kinds.yml'), 'utf8'))
    assert.deepEqual(Object.keys(kinds.kinds), ['lint', 'typecheck'], 'lint and typecheck only, no test kind')
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts.build, 'nuxt build', 'its own script kept')
    assert.equal(pkg.scripts.lint, 'eslint .')
    assert.equal(pkg.devDependencies['@dfox288/test-gates'], '0.7.0')
    assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /^# starter\n\n## Tests$/m)
    const checked = run('--stack', 'nuxt', '--dir', dir, '--check')
    assert.equal(checked.status, 0, checked.stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a planted miss turns --check red, one line per miss', () => {
  const dir = starter()
  try {
    assert.equal(run('--stack', 'nuxt', '--dir', dir).status, 0)
    rmSync(join(dir, 'checks.kinds.yml'))
    const checked = run('--stack', 'nuxt', '--dir', dir, '--check')
    assert.equal(checked.status, 1)
    assert.match(checked.stdout, /^missing: checks\.kinds\.yml$/m)

    // an empty kinds block is refused by Current ("kinds names no kind")
    writeFileSync(join(dir, 'checks.kinds.yml'), 'kinds: {}\n')
    const empty = run('--stack', 'nuxt', '--dir', dir, '--check')
    assert.equal(empty.status, 1)
    assert.match(empty.stdout, /kinds names no kind/)

    // a kind the gate script does not know
    writeFileSync(join(dir, 'checks.kinds.yml'), "kinds:\n  lint: { describe: 'x' }\n  typecheck: { describe: 'y' }\n  test: { describe: 'z' }\n")
    const unknown = run('--stack', 'nuxt', '--dir', dir, '--check')
    assert.equal(unknown.status, 1)
    assert.match(unknown.stdout, /does not know kind "test"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an existing file is not overwritten: init names it and writes nothing', () => {
  const dir = starter()
  try {
    writeFileSync(join(dir, 'checks.map.yml'), '# mine\n')
    const done = run('--stack', 'nuxt', '--dir', dir)
    assert.equal(done.status, 1)
    assert.match(done.stderr, /checks\.map\.yml exists/)
    assert.equal(readFileSync(join(dir, 'checks.map.yml'), 'utf8'), '# mine\n')
    assert.ok(!existsSync(join(dir, 'scripts/gates.mjs')), 'nothing else written')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('another stack exits 2', () => {
  const done = run('--stack', 'python', '--dir', tmpdir())
  assert.equal(done.status, 2)
  assert.match(done.stderr, /no init for stack python yet/)
})

test('the YAML reader reads the files the apps have', () => {
  assert.deepEqual(parseYaml("# c\nversion: 2\nalways: [lint, format]\nkinds:\n  test:\n    paths: ['app/**']\n    edges:\n      - paths: [a, b]\n        tests: [t]\n"), {
    version: 2,
    always: ['lint', 'format'],
    kinds: { test: { paths: ['app/**'], edges: [{ paths: ['a', 'b'], tests: ['t'] }] } },
  })
  assert.deepEqual(parseYaml('gateStatuses: true\nkinds:\n  e2e:\n    { cache: never,\n      describe: "x # y" }\n'), { gateStatuses: true, kinds: { e2e: { cache: 'never', describe: 'x # y' } } })
})
