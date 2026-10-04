// The docs gate: no doc the diff makes untrue. Compares the tree with its base and looks for the old names of
// everything the diff removed or renamed (paths, package.json scripts, pyproject scripts) in README.md, docs/**/*.md
// and CLAUDE.md. `--all` reports every backticked path in those files that does not exist in the tree.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

export interface DocsConfig {
  /** The base ref of the diff (default `origin/main`; `--base` wins). */
  base?: string
  /** Doc globs besides the defaults (`README.md`, `docs/**\/*.md`, `CLAUDE.md`). */
  globs?: string[]
  /** Names that may stay in the docs: a path or name, exact, or a prefix when it ends in `*`. */
  ignore?: string[]
}

export const DEFAULT_DOC_GLOBS = ['README.md', 'docs/**/*.md', 'CLAUDE.md']

export interface DocsOptions {
  base?: string
  all?: boolean
}

/** One name the diff took away: a path (file or directory) or a script, with where it went if known. */
export interface Removed {
  kind: 'path' | 'script'
  name: string
  /** For a script: the runner the docs would name it with. */
  runners?: string[]
  renamedTo?: string
}

export interface DocHit {
  file: string
  line: number
  text: string
}

const git = (root: string, args: string[]): string =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?'
        i += 2
      } else {
        re += '.*'
        i += 1
      }
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

function ignored(name: string, ignore: string[]): boolean {
  return ignore.some((i) => (i.endsWith('*') ? name.startsWith(i.slice(0, -1)) : name === i))
}

/** Backtick spans and link targets of one doc line. */
export function spansOf(line: string): { text: string; link: boolean }[] {
  const out: { text: string; link: boolean }[] = []
  for (const m of line.matchAll(/`([^`]+)`/g)) out.push({ text: m[1].trim(), link: false })
  for (const m of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.push({ text: m[1].split('#')[0], link: true })
  return out.filter((s) => s.text !== '')
}

const normalize = (p: string): string => posix.normalize(p.replace(/^\.\//, '')).replace(/\/$/, '')

/** The repo-relative paths a doc span can mean: from the repo root and from the doc's own directory. */
function candidates(span: string, docFile: string): string[] {
  const p = span.replace(/^\.\//, '')
  const rootRel = normalize(p)
  const docRel = normalize(posix.join(posix.dirname(docFile), p))
  return rootRel === docRel ? [rootRel] : [rootRel, docRel]
}

function pathLike(span: string): boolean {
  if (span.startsWith('@') || /\s/.test(span) || /[<>{}$*|:~?!=,;()]/.test(span) || span.startsWith('/') || span.startsWith('-')) return false
  if (span.includes('..') && !span.startsWith('..')) return false
  return span.includes('/') || /\.[A-Za-z][A-Za-z0-9]{0,5}$/.test(span)
}

const SCRIPT_RUNNERS = ['pnpm', 'pnpm run', 'npm run', 'yarn', 'yarn run', 'bun run']

function namesScript(span: string, name: string): boolean {
  return SCRIPT_RUNNERS.some((r) => span === `${r} ${name}` || span.startsWith(`${r} ${name} `))
}

function namesPyScript(span: string, name: string): boolean {
  const words = span.split(/\s+/)
  return words[0] === name || (words[0] === 'uv' && words[1] === 'run' && words[2] === name)
}

/** Does one doc span name something removed? Returns the removed entry it names. */
export function spanHits(span: string, docFile: string, removed: Removed[]): Removed | undefined {
  for (const r of removed) {
    if (r.kind === 'script') {
      if (r.runners?.includes('py') ? namesPyScript(span, r.name) : namesScript(span, r.name)) return r
      continue
    }
    if (!pathLike(span)) continue
    for (const c of candidates(span, docFile)) if (c === r.name || c.startsWith(`${r.name}/`)) return r
  }
  return undefined
}

/** Scans doc text for spans that name a removed thing. Fences count: a command in a code block is named too. */
export function scanText(file: string, text: string, removed: Removed[], ignore: string[] = []): DocHit[] {
  const hits: DocHit[] = []
  for (const [i, line] of text.split('\n').entries()) {
    for (const span of spansOf(line)) {
      const r = spanHits(span.text, file, removed)
      if (!r || ignored(r.name, ignore)) continue
      hits.push({
        file,
        line: i + 1,
        text: `names ${r.name}, which this change ${r.renamedTo ? `renamed to ${r.renamedTo}` : 'removed'}`,
      })
    }
  }
  return hits
}

/** Every backticked or linked path that is in no place of the tree. */
export function scanMissing(
  file: string,
  text: string,
  exists: (path: string) => boolean,
  ignore: string[] = [],
): DocHit[] {
  const hits: DocHit[] = []
  let fenced = false
  for (const [i, line] of text.split('\n').entries()) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    for (const span of spansOf(line)) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(span.text) || span.text.startsWith('mailto:') || span.text.startsWith('#')) continue
      if (!pathLike(span.text) || ignored(span.text, ignore)) continue
      if (candidates(span.text, file).some(exists)) continue
      hits.push({ file, line: i + 1, text: `names ${span.text}, which does not exist` })
    }
  }
  return hits
}

// ---- what the diff removed -------------------------------------------------------------------------------------

function lsTree(root: string, ref: string): string[] {
  return git(root, ['ls-tree', '-r', '--name-only', '-z', ref]).split('\0').filter(Boolean)
}

const dirsOf = (files: string[]): Set<string> => {
  const dirs = new Set<string>()
  for (const f of files) for (let d = posix.dirname(f); d !== '.' && !dirs.has(d); d = posix.dirname(d)) dirs.add(d)
  return dirs
}

/** Scripts of a package.json text (`{}` when it does not parse). */
export function packageScripts(text: string | undefined): Record<string, string> {
  if (!text) return {}
  try {
    const scripts = (JSON.parse(text) as { scripts?: Record<string, string> }).scripts
    return scripts && typeof scripts === 'object' ? scripts : {}
  } catch {
    return {}
  }
}

/** `[project.scripts]` of a pyproject.toml text: name -> target. */
export function pyprojectScripts(text: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!text) return out
  let inSection = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inSection = line === '[project.scripts]'
      continue
    }
    const m = inSection ? line.match(/^["']?([^"'=\s]+)["']?\s*=\s*(.+)$/) : null
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

/** Names present in `before` and not in `after`; one that kept its value under another name is a rename. */
export function removedScripts(before: Record<string, string>, after: Record<string, string>, py: boolean): Removed[] {
  const added = Object.entries(after).filter(([k]) => !(k in before))
  const out: Removed[] = []
  for (const [name, value] of Object.entries(before)) {
    if (name in after) continue
    const moved = added.find(([, v]) => v === value)
    out.push({ kind: 'script', name, runners: py ? ['py'] : [], ...(moved ? { renamedTo: moved[0] } : {}) })
  }
  return out
}

function showAt(root: string, ref: string, path: string): string | undefined {
  try {
    return git(root, ['show', `${ref}:${path}`])
  } catch {
    return undefined
  }
}

/** Everything removed or renamed between `base` (merge base with HEAD) and HEAD. */
export function removedByDiff(root: string, base: string): Removed[] {
  const mergeBase = git(root, ['merge-base', base, 'HEAD']).trim()
  const rows = git(root, ['diff', '--name-status', '-M', '-z', mergeBase, 'HEAD']).split('\0').filter(Boolean)
  const removed: Removed[] = []
  const moves: [string, string][] = []
  const packageFiles: string[] = []
  for (let i = 0; i < rows.length; ) {
    const status = rows[i++]
    if (status.startsWith('R') || status.startsWith('C')) {
      const [from, to] = [rows[i++], rows[i++]]
      if (status.startsWith('R')) {
        removed.push({ kind: 'path', name: from, renamedTo: to })
        moves.push([from, to])
      }
      if (/(^|\/)(package\.json|pyproject\.toml)$/.test(from)) packageFiles.push(to)
      continue
    }
    const path = rows[i++]
    if (status === 'D') removed.push({ kind: 'path', name: path })
    if (/(^|\/)(package\.json|pyproject\.toml)$/.test(path) && status !== 'D') packageFiles.push(path)
    if (status === 'D' && /(^|\/)(package\.json|pyproject\.toml)$/.test(path)) packageFiles.push(path)
  }

  // a directory that has no file left names what moved out of it
  const headFiles = new Set(lsTree(root, 'HEAD'))
  const headDirs = dirsOf([...headFiles])
  const gone = [...dirsOf(lsTree(root, mergeBase))].filter((d) => !headDirs.has(d))
  for (const dir of gone) {
    const move = moves.find(([from]) => from.startsWith(`${dir}/`))
    removed.push({ kind: 'path', name: dir, ...(move ? { renamedTo: posix.dirname(move[1]) } : {}) })
  }

  for (const file of packageFiles) {
    const py = file.endsWith('pyproject.toml')
    const parse = py ? pyprojectScripts : (t: string | undefined) => packageScripts(t)
    const beforeFile = moves.find(([, to]) => to === file)?.[0] ?? file
    const before = parse(showAt(root, mergeBase, beforeFile))
    const after = parse(showAt(root, 'HEAD', file))
    removed.push(...removedScripts(before, after, py))
  }
  // a path that still exists at HEAD (a type change, a re-add) is not removed
  return removed.filter((r) => r.kind === 'script' || !headFiles.has(r.name))
}

// ---- the gate --------------------------------------------------------------------------------------------------

export interface DocsResult {
  ok: boolean
  mode: 'diff' | 'all'
  hits: DocHit[]
  detail: string
}

/** Which of these paths `.gitignore` covers (git check-ignore, which also answers for paths that do not exist). */
function gitIgnored(root: string, paths: string[]): Set<string> {
  if (paths.length === 0) return new Set()
  try {
    const out = execFileSync('git', ['-C', root, 'check-ignore', '-z', '--stdin'], {
      input: [...new Set(paths)].join('\0'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    return new Set(out.split('\0').filter(Boolean))
  } catch (error) {
    // exit 1 means none matched; anything else leaves them reported
    const stdout = (error as { stdout?: string }).stdout ?? ''
    return new Set(stdout.split('\0').filter(Boolean))
  }
}

function refExists(root: string, ref: string): boolean {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}

export function runDocsGate(root: string, config: DocsConfig = {}, options: DocsOptions = {}): DocsResult {
  const explicit = options.base ?? config.base
  const base = explicit ?? 'origin/main'
  const globs = [...DEFAULT_DOC_GLOBS, ...(config.globs ?? [])].map(globToRegExp)
  const ignore = config.ignore ?? []

  let tracked: string[]
  try {
    tracked = git(root, ['ls-files', '-z']).split('\0').filter(Boolean)
  } catch {
    return { ok: false, mode: 'diff', hits: [], detail: 'not a git work tree: the docs gate is NOT MEASURED' }
  }
  const docs = tracked.filter((f) => globs.some((g) => g.test(f)) && existsSync(join(root, f)))
  const hasBase = refExists(root, base)
  if (explicit && !hasBase) return { ok: false, mode: 'diff', hits: [], detail: `base ${base} not found: the docs gate is NOT MEASURED` }

  const hits: DocHit[] = []
  const mode = options.all || !hasBase ? 'all' : 'diff'
  if (mode === 'diff') {
    const removed = removedByDiff(root, base)
    for (const f of docs) hits.push(...scanText(f, readFileSync(join(root, f), 'utf8'), removed, ignore))
  } else {
    const files = new Set(tracked)
    const dirs = dirsOf(tracked)
    const names = new Set(tracked.map((f) => posix.basename(f)))
    // a bare file name (no directory) may live anywhere in the tree
    const exists = (p: string) => files.has(p) || dirs.has(p) || p === '.' || p === '' || (!p.includes('/') && names.has(p))
    const missing: DocHit[] = []
    for (const f of docs) missing.push(...scanMissing(f, readFileSync(join(root, f), 'utf8'), exists, ignore))
    // build output, dependencies and other ignored paths are not in the tree on purpose
    const ignoredPaths = gitIgnored(root, missing.map((h) => h.text.split(' ')[1]))
    hits.push(...missing.filter((h) => !ignoredPaths.has(h.text.split(' ')[1])))
  }
  const scope = mode === 'all' ? `full scan of ${docs.length} docs` : `${docs.length} docs against ${base}`
  return { ok: hits.length === 0, mode, hits, detail: hits.length === 0 ? scope : `${hits.length} stale doc line(s), ${scope}` }
}
