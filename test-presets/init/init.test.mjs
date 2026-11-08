// node --test test-presets/init/init.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { commandsOf, lockfileProblems, NO_LOCKFILE, parseYaml, PRESETS_VERSION } from './init.mjs'

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

/**
 * What the entry step does after init (D-500: `pnpm install --lockfile-only` in Current's package container), as a small v9
 * lockfile in pnpm's own layout: its root importer has package.json's specifiers. `extra` adds lines to `packages:`.
 */
function lock(dir, { extra = [], overrides } = {}) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const lines = ['---', "lockfileVersion: '9.0'", '', 'importers:', '', '  .:', '    configDependencies: {}', '', '---', "lockfileVersion: '9.0'", '', 'settings:', '  autoInstallPeers: true', '']
  if (overrides) lines.push('overrides:', ...Object.entries(overrides).map(([k, v]) => `  ${k}: ${v}`), '')
  lines.push('importers:', '', '  .:')
  for (const field of ['dependencies', 'devDependencies']) {
    if (!pkg[field]) continue
    lines.push(`    ${field}:`)
    for (const [name, spec] of Object.entries(pkg[field])) lines.push(`      '${name}':`, `        specifier: ${spec}`, `        version: 1.0.0`)
  }
  lines.push('', 'packages:', '', ...extra.map((name) => `  ${name}@1.0.0:\n    resolution: {integrity: sha512-x}`), '')
  writeFileSync(join(dir, 'pnpm-lock.yaml'), lines.join('\n'))
}

const check = (dir) => run('--stack', 'nuxt', '--dir', dir, '--check')

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
    const gatesVersion = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'gates', 'package.json'), 'utf8')).version
    assert.equal(PRESETS_VERSION, gatesVersion)
    assert.equal(pkg.devDependencies['@dfox288/test-gates'], gatesVersion, 'the version of this checkout, no repin')
    assert.equal(pkg.packageManager, 'pnpm@12.8.1')
    assert.equal(pkg.engines.node, '>=24')
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'gates.config.json'), 'utf8')).tiers, [], 'no test tier')
    assert.match(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8'), /^minimumReleaseAge: 1440$/m)
    assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /^# starter\n\n## Tests and gates$/m)
    assert.match(done.stdout, /^next: pnpm-lock\.yaml, made by the entry step/m)
    lock(dir)
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

test('lint and typecheck must run their tools: a script or gate command that only exists turns --check red', () => {
  const dir = starter()
  try {
    assert.equal(run('--stack', 'nuxt', '--dir', dir).status, 0)
    const pkgPath = join(dir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const configPath = join(dir, 'gates.config.json')
    const config = readFileSync(configPath, 'utf8')
    const red = (pattern) => {
      const checked = run('--stack', 'nuxt', '--dir', dir, '--check')
      assert.equal(checked.status, 1, checked.stdout)
      assert.match(checked.stdout, pattern)
    }

    writeFileSync(pkgPath, JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, lint: 'echo hi' } }))
    red(/script "lint" is "echo hi", which does not run eslint/)
    writeFileSync(pkgPath, JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, typecheck: 'true' } }))
    red(/script "typecheck" is "true", which does not run nuxt typecheck or vue-tsc/)
    writeFileSync(pkgPath, JSON.stringify(pkg))

    writeFileSync(configPath, JSON.stringify({ stack: 'vitest', tiers: [], gates: { typecheck: ['pnpm', 'typecheck'] } }))
    red(/gate "lint" has no command/)
    writeFileSync(configPath, JSON.stringify({ stack: 'vitest', tiers: [], gates: { lint: ['pnpm', 'build'], typecheck: ['pnpm', 'typecheck'] } }))
    red(/gate "lint" runs "pnpm build" \("nuxt build"\), which does not run eslint/)
    lock(dir)
    writeFileSync(configPath, JSON.stringify({ stack: 'vitest', tiers: [], gates: { lint: ['eslint', '.'], typecheck: ['sh', '-c', 'nuxi prepare && vue-tsc --noEmit'] } }))
    assert.equal(run('--stack', 'nuxt', '--dir', dir, '--check').status, 0, 'a gate that runs the tool itself is fine')
    writeFileSync(configPath, config)
    assert.equal(run('--stack', 'nuxt', '--dir', dir, '--check').status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('commandsOf splits a script into its commands', () => {
  assert.deepEqual(commandsOf('nuxi prepare && eslint .'), [['nuxi', 'prepare'], ['eslint', '.']])
  assert.deepEqual(commandsOf('NODE_OPTIONS=x pnpm exec vue-tsc --noEmit'), [['vue-tsc', '--noEmit']])
  assert.deepEqual(commandsOf("sh -c 'pnpm build && uv run check'"), [['pnpm', 'build'], ['uv', 'run', 'check']])
  assert.deepEqual(commandsOf('echo eslint'), [['echo', 'eslint']])
})

test('an existing package.json keeps its own packageManager and engines; an own eslint config is kept, without @nuxt/eslint-config', () => {
  const dir = starter()
  try {
    writeFileSync(join(dir, 'eslint.config.js'), 'export default []\n')
    const pkgPath = join(dir, 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ ...JSON.parse(readFileSync(pkgPath, 'utf8')), packageManager: 'pnpm@11.0.0', engines: { node: '>=22' } }, null, 2))
    assert.equal(run('--stack', 'nuxt', '--dir', dir).status, 0)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    assert.equal(pkg.packageManager, 'pnpm@11.0.0')
    assert.equal(pkg.engines.node, '>=22')
    assert.equal(pkg.devDependencies['@nuxt/eslint-config'], undefined)
    assert.equal(pkg.devDependencies.eslint, '^10.8.1')
    assert.ok(!existsSync(join(dir, 'eslint.config.mjs')))
    assert.equal(readFileSync(join(dir, 'eslint.config.js'), 'utf8'), 'export default []\n')
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

test('B1: no lockfile, or one that does not cover package.json, is a miss; init says the lockfile comes next', () => {
  const dir = starter()
  try {
    const done = run('--stack', 'nuxt', '--dir', dir)
    assert.equal(done.status, 0, done.stderr)
    assert.match(done.stdout, /next: pnpm-lock\.yaml, made by the entry step \(pnpm install --lockfile-only .*D-500\); then --check/)
    const none = check(dir)
    assert.equal(none.status, 1)
    assert.deepEqual(none.stdout.trim().split('\n'), [NO_LOCKFILE], 'the lockfile is the one miss after init')

    // the lockfile of before init: it lacks the devDependencies init added
    const pkgPath = join(dir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    writeFileSync(pkgPath, JSON.stringify({ ...pkg, devDependencies: undefined }))
    lock(dir)
    writeFileSync(pkgPath, JSON.stringify(pkg))
    const stale = check(dir)
    assert.equal(stale.status, 1)
    assert.match(stale.stdout, /^pnpm-lock\.yaml does not cover @dfox288\/test-gates, @nuxt\/eslint-config, eslint, typescript, vue-tsc /m)

    // a changed specifier
    lock(dir)
    assert.equal(check(dir).status, 0)
    writeFileSync(pkgPath, JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, nuxt: '^4.7.0' } }))
    assert.match(check(dir).stdout, /^pnpm-lock\.yaml does not cover nuxt /m)
    writeFileSync(pkgPath, JSON.stringify(pkg))

    // overrides the lockfile was not made with
    assert.deepEqual(lockfileProblems(readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8'), pkg, { 'a>b': '^1.0.0' }).length, 1)
    lock(dir, { overrides: { 'a>b': '^1.0.0' } })
    assert.deepEqual(lockfileProblems(readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8'), pkg, { 'a>b': '^1.0.0' }), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S1 and N5: a kept pnpm-workspace.yaml must decide the builds and hold the release age; init exits 1 with the lines to add', () => {
  const dir = starter()
  try {
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), "overrides:\n  a>b: ^1.0.0\n")
    const done = run('--stack', 'nuxt', '--dir', dir)
    assert.equal(done.status, 1)
    assert.match(done.stderr, /does not decide the build of esbuild .*; add:\n {4}allowBuilds:\n {6}esbuild: true/)
    assert.match(done.stderr, /does not decide the build of unrs-resolver .*; add:\n {4}allowBuilds:\n {6}unrs-resolver: false/)
    assert.match(done.stderr, /no minimumReleaseAge \(the release-age hold, D-439\); add:\n {4}minimumReleaseAge: 1440/)
    assert.match(done.stderr, /minimumReleaseAgeExclude does not list '@dfox288\/\*'/)
    assert.ok(!existsSync(join(dir, 'scripts/gates.mjs')), 'nothing written')

    // pnpm 11's likely case: esbuild decided, unrs-resolver (brought by @nuxt/eslint-config) not
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), "minimumReleaseAge: 1440\nminimumReleaseAgeExclude: ['@dfox288/*']\nallowBuilds: { esbuild: true }\n")
    const one = run('--stack', 'nuxt', '--dir', dir)
    assert.equal(one.status, 1)
    assert.deepEqual(one.stderr.match(/does not decide the build of \S+/g), ['does not decide the build of unrs-resolver'])

    writeFileSync(join(dir, 'pnpm-workspace.yaml'), "minimumReleaseAge: 1440\nminimumReleaseAgeExclude: ['@dfox288/*']\nallowBuilds: { esbuild: true, unrs-resolver: false }\n")
    assert.equal(run('--stack', 'nuxt', '--dir', dir).status, 0)
    lock(dir, { extra: ['esbuild', 'unrs-resolver'] })
    assert.equal(check(dir).status, 0)

    // --check: the same misses on a workspace file changed after init; a build absent from the lockfile needs no decision
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), "allowBuilds:\n  esbuild: true\n")
    const red = check(dir)
    assert.equal(red.status, 1)
    assert.match(red.stdout, /^pnpm-workspace\.yaml does not decide the build of unrs-resolver/m)
    assert.match(red.stdout, /^pnpm-workspace\.yaml has no minimumReleaseAge/m)
    lock(dir, { extra: ['esbuild'] })
    assert.doesNotMatch(check(dir).stdout, /unrs-resolver/)
    rmSync(join(dir, 'pnpm-workspace.yaml'))
    assert.match(check(dir).stdout, /^missing: pnpm-workspace\.yaml$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("S2: --check applies Current's kinds-file rules and refuses a duplicate key", () => {
  const dir = starter()
  try {
    assert.equal(run('--stack', 'nuxt', '--dir', dir).status, 0)
    lock(dir)
    const kindsPath = join(dir, 'checks.kinds.yml')
    const kinds = readFileSync(kindsPath, 'utf8')
    // the reviewer's case, with Current's own words for it (current 1699738, loadKindsFile)
    writeFileSync(kindsPath, "kinds:\n  lint: { describe: 'x', cache: always, image: 'Bad Image', env: { GITHUB_TOKEN: x } }\n  typecheck: { describe: 'y' }\n")
    const values = check(dir)
    assert.equal(values.status, 1)
    assert.match(values.stdout, /^checks\.kinds\.yml: kind "lint": cache is "always", only "never" exists$/m)
    assert.match(values.stdout, /^checks\.kinds\.yml: kind "lint": image is not a catalog image name$/m)
    assert.match(values.stdout, /^checks\.kinds\.yml: kind "lint": env name GITHUB_TOKEN looks like a secret; a kind's env is non-secret$/m)
    writeFileSync(kindsPath, "kinds:\n  lint: { describe: x, env: { PATH: /x, lower: y }, dir: ../up, services: [Bad], tools: { apt: [ok], brew: [x] } }\n  typecheck: { describe: 'y' }\n")
    const more = check(dir).stdout
    for (const line of ["env name PATH is Current's or the container's own", 'env name "lower" is not UPPER_SNAKE_CASE', 'dir is not a repo-relative directory', 'services is not a list of service names', 'tools has unknown key "brew"'])
      assert.ok(more.includes(`kind "lint": ${line}`), `${line}\n${more}`)
    // lint written twice
    writeFileSync(kindsPath, "kinds:\n  lint: { describe: 'x' }\n  lint: { describe: 'z' }\n  typecheck: { describe: 'y' }\n")
    assert.match(check(dir).stdout, /^checks\.kinds\.yml does not parse: Map keys must be unique \("lint"\)$/m)
    writeFileSync(kindsPath, kinds)
    assert.equal(check(dir).status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S3: the lint and typecheck kinds are required', () => {
  const dir = starter()
  try {
    assert.equal(run('--stack', 'nuxt', '--dir', dir).status, 0)
    lock(dir)
    rmSync(join(dir, 'eslint.config.mjs'))
    writeFileSync(join(dir, 'checks.kinds.yml'), "kinds:\n  typecheck: { describe: 'y' }\n")
    writeFileSync(join(dir, 'checks.map.yml'), 'version: 2\nalways: [typecheck]\nkinds: {}\n')
    const one = check(dir)
    assert.equal(one.status, 1)
    assert.match(one.stdout, /^checks\.kinds\.yml: no kind lint \(the entry has the lint and typecheck kinds, D-499\)$/m)
    assert.match(one.stdout, /^missing: eslint\.config\.\* \(kind lint\)$/m)
    writeFileSync(join(dir, 'checks.kinds.yml'), 'kinds:\n  build: {}\n')
    writeFileSync(join(dir, 'checks.map.yml'), 'version: 2\nalways: [build]\nkinds: {}\n')
    const neither = check(dir).stdout
    assert.match(neither, /no kind lint/)
    assert.match(neither, /no kind typecheck/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S4: the tools the two kinds run are required dependencies, and @nuxt/eslint-config when the config imports it', () => {
  const dir = starter()
  try {
    assert.equal(run('--stack', 'nuxt', '--dir', dir).status, 0)
    const pkgPath = join(dir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const { eslint, typescript, 'vue-tsc': vueTsc, '@nuxt/eslint-config': nuxtConfig, ...rest } = pkg.devDependencies
    assert.ok(eslint && typescript && vueTsc && nuxtConfig)
    writeFileSync(pkgPath, JSON.stringify({ ...pkg, devDependencies: rest }))
    lock(dir)
    const red = check(dir).stdout
    for (const name of ['eslint', 'typescript', 'vue-tsc']) assert.match(red, new RegExp(`^package\\.json: dependency ${name} is missing`, 'm'))
    assert.match(red, /^package\.json: dependency @nuxt\/eslint-config is missing \(eslint\.config\.mjs imports it\)$/m)
    // a repo's own config that does not import it needs no @nuxt/eslint-config
    rmSync(join(dir, 'eslint.config.mjs'))
    writeFileSync(join(dir, 'eslint.config.js'), 'export default []\n')
    writeFileSync(pkgPath, JSON.stringify({ ...pkg, devDependencies: { ...rest, eslint, typescript, 'vue-tsc': vueTsc } }))
    lock(dir)
    assert.equal(check(dir).status, 0, check(dir).stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("N3: package.json keeps its line endings, indentation and key order; new keys come after the ones there", () => {
  const dir = starter()
  try {
    const pkgPath = join(dir, 'package.json')
    const own = { name: 'starter', type: 'module', private: true, scripts: { build: 'nuxt build' }, dependencies: { nuxt: '^4.6.1' }, devDependencies: { zod: '^4.0.0', 'a-tool': '^1.0.0' } }
    writeFileSync(pkgPath, JSON.stringify(own, null, '\t').replace(/\n/g, '\r\n') + '\r\n')
    assert.equal(run('--stack', 'nuxt', '--dir', dir).status, 0)
    const text = readFileSync(pkgPath, 'utf8')
    assert.ok(!/[^\r]\n/.test(text), 'CRLF kept')
    assert.match(text, /^\{\r\n\t"name": "starter",\r\n/, 'tabs kept')
    assert.ok(text.endsWith('}\r\n'))
    const pkg = JSON.parse(text)
    assert.deepEqual(Object.keys(pkg).slice(0, 6), Object.keys(own), 'its keys in their order, new ones after')
    assert.deepEqual(Object.keys(pkg.devDependencies), ['zod', 'a-tool', '@dfox288/test-gates', '@nuxt/eslint-config', 'eslint', 'typescript', 'vue-tsc'], 'not re-sorted')
    assert.deepEqual(Object.keys(pkg.scripts), ['build', 'lint', 'typecheck', 'gates'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('N1: the YAML reader reads block scalars and refuses duplicate keys', () => {
  assert.deepEqual(parseYaml('kinds:\n  lint:\n    describe: >-\n      ESLint over\n      the repo\n  t:\n    describe: |\n      a\n      b\n\n  x: 1\n'), {
    kinds: { lint: { describe: 'ESLint over the repo' }, t: { describe: 'a\nb\n' }, x: 1 },
  })
  assert.throws(() => parseYaml('a: 1\na: 2\n'), /Map keys must be unique \("a"\)/)
  assert.throws(() => parseYaml('a: { b: 1, b: 2 }\n'), /Map keys must be unique \("b"\)/)
})
