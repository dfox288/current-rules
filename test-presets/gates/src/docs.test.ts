import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { removedScripts, runDocsGate, scanMissing, scanText, spansOf, pyprojectScripts } from './docs.ts'

const sh = (root: string, ...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })

function put(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

const body = (name: string) => `export const ${name} = 1\n// padding so a move is detected as a rename\n`.repeat(5)

/** A repo with a base commit on `main`, then a branch `pr` the case edits and commits. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'gates-docs-'))
  sh(root, 'init', '-q', '-b', 'main')
  put(root, 'README.md', 'Run `pnpm lint` and see `src/old.ts` and [guide](docs/guide.md).\n')
  put(root, 'CLAUDE.md', 'Use `pnpm run seed` before tests.\n')
  put(root, 'docs/guide.md', 'The helper lives in `src/util/helper.ts`.\n')
  put(root, 'src/old.ts', body('a'))
  put(root, 'src/util/helper.ts', body('h'))
  put(root, 'package.json', JSON.stringify({ scripts: { lint: 'eslint .', seed: 'tsx seed.ts' } }, null, 2))
  sh(root, 'add', '-A')
  sh(root, 'commit', '-q', '-m', 'base')
  sh(root, 'checkout', '-q', '-b', 'pr')
  return root
}

const commit = (root: string) => {
  sh(root, 'add', '-A')
  sh(root, 'commit', '-q', '-m', 'change')
}
const gate = (root: string) => runDocsGate(root, {}, { base: 'main' })
const lines = (r: ReturnType<typeof gate>) => r.hits.map((h) => `${h.file}:${h.line}: ${h.text}`)

test('a rename that leaves a README line stale is red, with file:line and the new name', () => {
  const root = fixture()
  renameSync(join(root, 'src/old.ts'), join(root, 'src/new.ts'))
  commit(root)
  const r = gate(root)
  assert.equal(r.ok, false)
  assert.deepEqual(lines(r), ['README.md:1: names src/old.ts, which this change renamed to src/new.ts'])
})

test('the fixed README is green', () => {
  const root = fixture()
  renameSync(join(root, 'src/old.ts'), join(root, 'src/new.ts'))
  put(root, 'README.md', 'Run `pnpm lint` and see `src/new.ts` and [guide](docs/guide.md).\n')
  commit(root)
  assert.equal(gate(root).ok, true)
})

test('a removed script named in CLAUDE.md is red', () => {
  const root = fixture()
  put(root, 'package.json', JSON.stringify({ scripts: { lint: 'eslint .' } }, null, 2))
  commit(root)
  const r = gate(root)
  assert.equal(r.ok, false)
  assert.deepEqual(lines(r), ['CLAUDE.md:1: names seed, which this change removed'])
})

test('a renamed script names its new name', () => {
  const root = fixture()
  put(root, 'package.json', JSON.stringify({ scripts: { lint: 'eslint .', 'db:seed': 'tsx seed.ts' } }, null, 2))
  commit(root)
  assert.deepEqual(lines(gate(root)), ['CLAUDE.md:1: names seed, which this change renamed to db:seed'])
})

test('a removed doc is named by a link target', () => {
  const root = fixture()
  rmSync(join(root, 'docs/guide.md'))
  commit(root)
  assert.deepEqual(lines(gate(root)), ['README.md:1: names docs/guide.md, which this change removed'])
})

test('a directory that moved away is named by a path inside it', () => {
  const root = fixture()
  renameSync(join(root, 'src/util'), join(root, 'src/lib'))
  commit(root)
  const r = gate(root)
  assert.equal(r.ok, false)
  assert.deepEqual(lines(r), ['docs/guide.md:1: names src/util/helper.ts, which this change renamed to src/lib/helper.ts'])
})

test('an unrelated rename is green', () => {
  const root = fixture()
  put(root, 'src/other.ts', body('o'))
  commit(root)
  sh(root, 'branch', '-f', 'main', 'HEAD')
  renameSync(join(root, 'src/other.ts'), join(root, 'src/renamed-other.ts'))
  commit(root)
  assert.equal(gate(root).ok, true)
})

test('control: an unchanged branch is green, and a missing base is not green', () => {
  const root = fixture()
  assert.equal(gate(root).ok, true)
  const missing = runDocsGate(root, {}, { base: 'no-such-ref' })
  assert.equal(missing.ok, false)
  assert.match(missing.detail, /NOT MEASURED/)
})

test('the ignore list keeps a name in the docs', () => {
  const root = fixture()
  renameSync(join(root, 'src/old.ts'), join(root, 'src/new.ts'))
  commit(root)
  assert.equal(runDocsGate(root, { ignore: ['src/old.ts'] }, { base: 'main' }).ok, true)
})

test('extra doc globs are scanned', () => {
  const root = fixture()
  put(root, 'notes/arch.md', 'See `src/old.ts`.\n')
  commit(root)
  sh(root, 'branch', '-f', 'main', 'HEAD')
  renameSync(join(root, 'src/old.ts'), join(root, 'src/new.ts'))
  commit(root)
  const files = (globs: string[]) => runDocsGate(root, { globs }, { base: 'main' }).hits.map((h) => h.file).sort()
  assert.deepEqual(files([]), ['README.md'])
  assert.deepEqual(files(['notes/*.md']), ['README.md', 'notes/arch.md'])
})

test('full scan: a backticked path that does not exist is reported; existing paths, commands and fences are not', () => {
  const root = fixture()
  put(root, 'README.md', 'See `src/old.ts`, `src/gone.ts` and `pnpm lint`.\n```\n`src/in-fence.ts`\n```\n')
  commit(root)
  const r = runDocsGate(root, {}, { base: 'main', all: true })
  assert.equal(r.mode, 'all')
  assert.deepEqual(lines(r), ['README.md:1: names src/gone.ts, which does not exist'])
})

test('no base and no --all is NOT MEASURED, never a silent full scan', () => {
  const root = fixture()
  const r = runDocsGate(root, {}, {})
  assert.equal(r.ok, false)
  assert.equal(r.detail, 'NOT MEASURED: no base to diff against (pass --base or --changes)')
  assert.equal(runDocsGate(root, {}, { all: true }).mode, 'all')
})

test('a base with no common ancestor is NOT MEASURED with the reason, not a crash', () => {
  const root = fixture()
  sh(root, 'checkout', '-q', '--orphan', 'unrelated')
  commit(root)
  const r = gate(root)
  assert.equal(r.ok, false)
  assert.match(r.detail, /^NOT MEASURED: .*merge-base/)
})

test('a changes file needs no history: a single root commit and a rename list flag the old name', () => {
  const root = fixture()
  rmSync(join(root, '.git'), { recursive: true })
  sh(root, 'init', '-q', '-b', 'main')
  renameSync(join(root, 'src/old.ts'), join(root, 'src/new.ts'))
  put(root, 'changes.txt', 'R100\tsrc/old.ts\tsrc/new.ts\nM\tREADME.md\nD\tdocs/gone.md\n')
  sh(root, 'add', '-A')
  sh(root, 'commit', '-q', '-m', 'only commit')
  const r = runDocsGate(root, {}, { changes: join(root, 'changes.txt') })
  assert.equal(r.ok, false)
  assert.deepEqual(lines(r), ['README.md:1: names src/old.ts, which this change renamed to src/new.ts'])
  put(root, 'README.md', 'Run `pnpm lint` and see `src/new.ts`.\n')
  assert.equal(runDocsGate(root, {}, { changes: join(root, 'changes.txt') }).ok, true)
  assert.match(runDocsGate(root, {}, {}).detail, /^NOT MEASURED/)
})

test('a changes file that is not there is NOT MEASURED', () => {
  const root = fixture()
  assert.match(runDocsGate(root, {}, { changes: join(root, 'nope.txt') }).detail, /^NOT MEASURED: .*nope\.txt/)
})

test('a bare directory name with a slash that is the repo itself is not a hit; docs.ignore handles paths inside', () => {
  const root = fixture()
  const self = basename(root)
  put(root, 'README.md', `The manifests live in \`${self}/\` of the other repo, and \`${self}/deploy.yaml\`.\n`)
  put(root, `${self}/deploy.yaml`, body('d'))
  commit(root)
  sh(root, 'branch', '-f', 'main', 'HEAD')
  renameSync(join(root, self), join(root, 'app'))
  commit(root)
  const r = gate(root)
  assert.deepEqual(lines(r), [`README.md:1: names ${self}/deploy.yaml, which this change renamed to app/deploy.yaml`])
  assert.equal(runDocsGate(root, { ignore: [`${self}/*`] }, { base: 'main' }).ok, true)
})

test('unit: spans, script rename detection, pyproject scripts', () => {
  assert.deepEqual(spansOf('a `x/y.ts` and [t](docs/z.md#h "title")'), [
    { text: 'x/y.ts', link: false },
    { text: 'docs/z.md', link: true },
  ])
  assert.deepEqual(removedScripts({ a: '1', b: '2' }, { c: '2' }, false), [
    { kind: 'script', name: 'a', runners: [] },
    { kind: 'script', name: 'b', runners: [], renamedTo: 'c' },
  ])
  assert.deepEqual(pyprojectScripts('[project]\nname = "x"\n[project.scripts]\ntool = "x:main"\n[tool.y]\nz = "1"\n'), { tool: '"x:main"' })
  assert.equal(scanText('README.md', '`uv run tool --help`', [{ kind: 'script', name: 'tool', runners: ['py'] }]).length, 1)
  assert.equal(scanMissing('README.md', '`https://x.dev/a/b`', () => false).length, 0)
})
