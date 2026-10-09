// The Nuxt/TypeScript commit hook, against stub tools in a throwaway repo: what it runs, in which order, what it refuses
// and what it names. The real tools are exercised by the measurement on the app repos (README), not here.
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { runHook } from './hook.js'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..')
mkdirSync(join(pkg, '.tmp'), { recursive: true })
const scratch = mkdtempSync(join(pkg, '.tmp/hook-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

// Stub tools: prettier drops a trailing `;`, fails on SYNTAX; eslint fails on `debugger`; the typechecker fails on TYPEERR.
// Each logs its argv to `.calls` in the cwd it ran in.
const STUBS: Record<string, string> = {
  prettier: `
    for (const f of args.filter((a) => !a.startsWith('-'))) {
      const s = fs.readFileSync(f, 'utf8')
      if (s.includes('SYNTAX')) { console.error(f + ': SyntaxError: Unexpected token'); process.exit(2) }
      fs.writeFileSync(f, s.replace(/;$/gm, ''))
    }`,
  eslint: `
    let bad = false
    for (const f of args.filter((a) => !a.startsWith('-')))
      if (fs.readFileSync(f, 'utf8').includes('debugger')) { console.log(f + '\\n  1:1  error  Unexpected debugger  no-debugger'); bad = true }
    if (bad) process.exit(1)`,
  'vue-tsc': `
    for (const f of fs.readdirSync('app'))
      if (fs.readFileSync('app/' + f, 'utf8').includes('TYPEERR')) { console.log('app/' + f + '(1,7): error TS2322: Type is not assignable'); process.exit(2) }`,
}

interface Repo {
  root: string
  dir: string
}

/** A repo with the stub tools in `<sub>/node_modules/.bin` and the file `app/ok.ts` committed. */
function repo(name: string, opts: { sub?: string; skip?: string[]; tsconfig?: string } = {}): Repo {
  const root = join(scratch, name)
  const dir = opts.sub ? join(root, opts.sub) : root
  mkdirSync(join(dir, 'app'), { recursive: true })
  mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true })
  for (const [tool, body] of Object.entries(STUBS)) {
    if (opts.skip?.includes(tool)) continue
    const file = join(dir, 'node_modules/.bin', tool)
    writeFileSync(
      file,
      `#!/usr/bin/env node\nconst fs = require('node:fs')\nconst args = process.argv.slice(2)\nfs.appendFileSync(process.env.CALLS ?? '/dev/null', ${JSON.stringify(tool)} + ' ' + args.join(' ') + '\\n')\n${body}\n`,
    )
    chmodSync(file, 0o755)
  }
  writeFileSync(join(dir, 'tsconfig.json'), opts.tsconfig ?? '{ "files": [], "references": [{ "path": "./.nuxt/tsconfig.app.json" }] }\n')
  writeFileSync(join(dir, 'package.json'), '{ "type": "commonjs" }\n')
  writeFileSync(join(dir, 'app/ok.ts'), 'export const ok = 1\n')
  writeFileSync(join(root, '.gitignore'), 'node_modules\n.calls\n')
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.email', 'a@b.c')
  git('config', 'user.name', 'a')
  git('add', '-A')
  git('commit', '-q', '-m', 'init', '--no-verify')
  return { root, dir }
}

const stage = (r: Repo, file: string, content: string) => {
  mkdirSync(dirname(join(r.root, file)), { recursive: true })
  writeFileSync(join(r.root, file), content)
  execFileSync('git', ['add', '--', file], { cwd: r.root })
}

function hook(r: Repo, dir = r.dir) {
  const calls = join(r.root, '.calls')
  rmSync(calls, { force: true })
  process.env.CALLS = calls
  let err = ''
  const code = runHook({ root: r.root, dir, stdout: (s) => (err += s), stderr: (s) => (err += s) })
  return { code, out: err, calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [] }
}

const tools = (calls: string[]) => calls.map((c) => c.split(' ')[0])

describe('the Nuxt/TypeScript commit hook', () => {
  it('runs Prettier, then ESLint, then the typecheck, on a staged TypeScript file', () => {
    const r = repo('order')
    stage(r, 'app/a.ts', 'export const a = 1\n')
    const h = hook(r)
    expect(h.code).toBe(0)
    expect(tools(h.calls)).toEqual(['prettier', 'eslint', 'vue-tsc'])
    expect(h.calls[0]).toContain('app/a.ts')
    expect(h.calls[1]).toContain('app/a.ts')
  })

  it('formats a staged file and stages the formatted content', () => {
    const r = repo('format')
    stage(r, 'app/a.ts', 'export const a = 1;\n')
    expect(hook(r).code).toBe(0)
    expect(execFileSync('git', ['show', ':app/a.ts'], { cwd: r.root, encoding: 'utf8' })).toBe('export const a = 1\n')
  })

  it('refuses a partly staged file by name and runs no tool', () => {
    const r = repo('partly')
    stage(r, 'app/a.ts', 'export const a = 1\n')
    writeFileSync(join(r.root, 'app/a.ts'), 'export const a = 1\nexport const extra = 2\n')
    const h = hook(r)
    expect(h.code).toBe(1)
    expect(h.out).toContain('app/a.ts')
    expect(h.out).toMatch(/partly staged/)
    expect(h.calls).toEqual([])
  })

  it('fails on an ESLint violation and names the file and the rule', () => {
    const r = repo('eslint')
    stage(r, 'app/a.ts', 'debugger\n')
    const h = hook(r)
    expect(h.code).toBe(1)
    expect(tools(h.calls)).toContain('eslint')
    expect(h.out).toContain('app/a.ts')
    expect(h.out).toContain('no-debugger')
  })

  it('fails on a type error and names the file and the code', () => {
    const r = repo('types')
    stage(r, 'app/a.ts', 'export const a: number = TYPEERR\n')
    const h = hook(r)
    expect(h.code).toBe(1)
    expect(h.out).toContain('app/a.ts(1,7)')
    expect(h.out).toContain('TS2322')
  })

  it('stops at a Prettier failure and names the file', () => {
    const r = repo('syntax')
    stage(r, 'app/a.ts', 'SYNTAX\n')
    const h = hook(r)
    expect(h.code).toBe(1)
    expect(h.out).toContain('app/a.ts: SyntaxError')
    expect(tools(h.calls)).toEqual(['prettier'])
  })

  it('formats a Markdown file and runs neither ESLint nor the typecheck', () => {
    const r = repo('markdown')
    stage(r, 'README.md', '# Title\n')
    const h = hook(r)
    expect(h.code).toBe(0)
    expect(tools(h.calls)).toEqual(['prettier'])
  })

  it('does nothing when no file in its directory is staged', () => {
    const r = repo('none', { sub: 'web' })
    stage(r, 'docs/notes.ts', 'debugger\n')
    const h = hook(r)
    expect(h.code).toBe(0)
    expect(h.calls).toEqual([])
  })

  it('works on the staged files below its directory, with paths relative to it', () => {
    const r = repo('sub', { sub: 'web' })
    stage(r, 'web/app/a.ts', 'export const a = 1\n')
    stage(r, 'other/b.ts', 'debugger\n')
    const h = hook(r)
    expect(h.code).toBe(0)
    expect(h.calls[0]).toBe('prettier --ignore-unknown --write app/a.ts')
    expect(h.calls[1]).toBe('eslint --no-warn-ignored app/a.ts')
  })

  it('typechecks a tsconfig with project references as a build, any other one as an incremental check', () => {
    const refs = repo('tsc-refs')
    stage(refs, 'app/a.ts', 'export const a = 1\n')
    expect(hook(refs).calls.at(-1)).toBe('vue-tsc -b --noEmit')

    const plain = repo('tsc-plain', { tsconfig: '{ "compilerOptions": { "strict": true } }\n' })
    stage(plain, 'app/a.ts', 'export const a = 1\n')
    expect(hook(plain).calls.at(-1)).toMatch(/^vue-tsc --noEmit --incremental --tsBuildInfoFile .*\.tsbuildinfo$/)
  })

  it('names a missing tool and fails, rather than skipping it', () => {
    const r = repo('missing', { skip: ['eslint'] })
    stage(r, 'app/a.ts', 'export const a = 1\n')
    const h = hook(r)
    expect(h.code).toBe(1)
    expect(h.out).toContain('eslint is not installed')
  })

  it('skips the typecheck for a change that no type sees', () => {
    const r = repo('json')
    stage(r, 'app/data.json', '{"a":1}\n')
    expect(tools(hook(r).calls)).toEqual(['prettier'])
  })

  it('never runs a test runner', () => {
    const r = repo('no-tests')
    stage(r, 'app/a.test.ts', 'export const a = 1\n')
    expect(tools(hook(r).calls).filter((t) => /vitest|playwright|pytest/.test(t))).toEqual([])
  })
})

describe('the shipped hooks/pre-commit', () => {
  // The wrapper a repo points core.hooksPath at: it derives the project directory from where the package sits.
  it('is executable, and finds its project directory from the package location', () => {
    const r = repo('wrapper', { sub: 'web' })
    const link = join(r.dir, 'node_modules/@dfox288/test-preset-vitest')
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(pkg, link)
    execFileSync('git', ['config', 'core.hooksPath', 'web/node_modules/@dfox288/test-preset-vitest/hooks'], { cwd: r.root })
    stage(r, 'web/app/a.ts', 'export const a = 1;\n')
    const c = spawnSync('git', ['commit', '-q', '-m', 'x'], { cwd: r.root, encoding: 'utf8', env: { ...process.env, CALLS: join(r.root, '.calls') } })
    expect(c.status, `${c.stdout}${c.stderr}`).toBe(0)
    expect(execFileSync('git', ['show', 'HEAD:web/app/a.ts'], { cwd: r.root, encoding: 'utf8' })).toBe('export const a = 1\n')
    expect(readFileSync(join(r.root, '.calls'), 'utf8')).toContain('eslint')
  })

  it('refuses the commit when a tool fails', () => {
    const r = repo('wrapper-red')
    const link = join(r.dir, 'node_modules/@dfox288/test-preset-vitest')
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(pkg, link)
    execFileSync('git', ['config', 'core.hooksPath', 'node_modules/@dfox288/test-preset-vitest/hooks'], { cwd: r.root })
    stage(r, 'app/a.ts', 'debugger\n')
    const c = spawnSync('git', ['commit', '-q', '-m', 'x'], { cwd: r.root, encoding: 'utf8' })
    expect(c.status).not.toBe(0)
    expect(`${c.stdout}${c.stderr}`).toContain('no-debugger')
  })
})
