// The shape of a repo's `checks.map.yml`, version 2 (`selection.md`, "Checks of the file"). One check for every repo,
// run by the repo's own test through `@dfox288/test-preset-vitest/checks-map-test`. A fault is one line; no line is
// a map that is well formed. The other half of the contract (what a map means for a change) is Current's evaluator.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

const TOP_KEYS = ['version', 'always', 'notest', 'kinds']
const KIND_KEYS = ['paths', 'tests', 'narrow', 'triggers', 'edges']
const EDGE_KEYS = ['paths', 'tests']
/** The steps of `selection.md`, "Narrowing steps per toolchain": a toolchain is added there when it has an import graph. */
export const NARROW_STEPS = ['vitest-related'] as const

export interface RepoFiles {
  /** `checks.map.yml`, parsed; undefined when the file is missing or empty. */
  map: unknown
  /** `checks.kinds.yml`, parsed. */
  kinds: unknown
  /** Every tracked file, relative to the repo root. */
  tracked: string[]
  /** Files that could not be read or parsed. */
  unreadable?: string[]
}

/** The two files and the tracked files of the repository at `root`. */
export function readRepoFiles(root: string): RepoFiles {
  const unreadable: string[] = []
  const load = (name: string): unknown => {
    const path = join(root, name)
    if (!existsSync(path)) return undefined
    try {
      return parse(readFileSync(path, 'utf8'))
    } catch (error) {
      unreadable.push(`${name} is not valid YAML: ${(error as Error).message.split('\n')[0]}`)
      return undefined
    }
  }
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean)
  return { map: load('checks.map.yml'), kinds: load('checks.kinds.yml'), tracked, unreadable }
}

/** A gitignore-syntax glob as a regex over a repo-root-relative path (or one of its parent directories). */
function globRegex(glob: string): RegExp {
  let p = glob.endsWith('/') ? glob.slice(0, -1) : glob
  // a slash at the start or in the middle anchors the glob to the root
  const anchored = p.includes('/')
  if (p.startsWith('/')) p = p.slice(1)
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!
    if (p.startsWith('**/', i)) {
      re += '(?:.*/)?'
      i += 2
    } else if (p.startsWith('/**', i) && i + 3 === p.length) {
      re += '/.*'
      i += 2
    } else if (p.startsWith('**', i)) {
      re += '.*'
      i += 1
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '[') {
      const end = p.indexOf(']', i + 1)
      if (end === -1) re += '\\['
      else {
        re += p.slice(i, end + 1).replace(/^\[!/, '[^')
        i = end
      }
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&')
  }
  return new RegExp(anchored ? `^${re}$` : `^(?:.*/)?${re}$`)
}

const compiled = new Map<string, RegExp>()

/** gitignore semantics: a glob that matches a directory matches every file under it. */
export function globMatches(glob: string, path: string): boolean {
  let re = compiled.get(glob)
  if (!re) compiled.set(glob, (re = globRegex(glob)))
  const parts = path.split('/')
  return parts.some((_, i) => re.test(parts.slice(0, i + 1).join('/')))
}

/** A glob that matches every file: nothing is left of it but `*` and `/` (a file nothing matches already runs everything). */
const isCatchAll = (glob: string) => /^[*/]+$/.test(glob)

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((e) => typeof e === 'string')

/** Every fault of the map, one line each. */
export function checksMapProblems(files: RepoFiles): string[] {
  const out: string[] = [...(files.unreadable ?? [])]
  const { map, tracked } = files
  if (map === undefined || map === null) {
    if (!out.some((p) => p.startsWith('checks.map.yml'))) out.push('checks.map.yml is missing or empty')
    return out
  }
  if (!isMap(map)) return [...out, 'checks.map.yml is not a mapping']

  // the kinds are the ones checks.kinds.yml defines
  let defined: string[] | undefined
  if (files.kinds === undefined || files.kinds === null) {
    if (!out.some((p) => p.startsWith('checks.kinds.yml'))) out.push('checks.kinds.yml is missing or empty')
  } else if (!isMap(files.kinds) || !isMap(files.kinds.kinds)) out.push('checks.kinds.yml has no kinds mapping')
  else defined = Object.keys(files.kinds.kinds)

  if (map.version !== 2) out.push(`version is ${JSON.stringify(map.version)}, not 2`)
  for (const key of Object.keys(map)) if (!TOP_KEYS.includes(key)) out.push(`unknown key ${key}`)

  /** Checks a list of globs against the tracked files; `where` names the list in the message. */
  const globs = (where: string, list: unknown, field = where): string[] => {
    if (list === undefined) return []
    if (!isStrings(list)) {
      out.push(`${field} is not a list of strings`)
      return []
    }
    for (const glob of list) {
      if (isCatchAll(glob)) out.push(`${where}: glob "${glob}" is a catch-all`)
      else if (!tracked.some((path) => globMatches(glob, path))) out.push(`${where}: glob "${glob}" matches no tracked file`)
    }
    return list
  }

  const alwaysOk = map.always === undefined || isStrings(map.always)
  if (!alwaysOk) out.push('always is not a list of strings')
  const always = isStrings(map.always) ? map.always : []
  if (defined)
    for (const entry of always) if (!defined.includes(entry)) out.push(`always entry ${JSON.stringify(entry)} is not a kind`)
  globs('notest', map.notest)

  const kinds = map.kinds === undefined ? {} : isMap(map.kinds) ? map.kinds : (out.push('kinds is not a mapping'), {})
  if (defined)
    for (const name of Object.keys(kinds)) if (!defined.includes(name)) out.push(`kind ${name} is missing from checks.kinds.yml`)

  for (const [name, body] of Object.entries(kinds)) {
    if (!isMap(body)) {
      out.push(`kind ${name} is not a mapping`)
      continue
    }
    for (const key of Object.keys(body)) if (!KIND_KEYS.includes(key)) out.push(`kind ${name} has unknown key ${key}`)
    globs(`kind ${name} paths`, body.paths, `kind ${name} paths`)
    const tests = globs(`kind ${name} tests`, body.tests)
    globs(`kind ${name} triggers`, body.triggers)
    if (body.narrow !== undefined && !(NARROW_STEPS as readonly unknown[]).includes(body.narrow))
      out.push(`kind ${name} narrow ${JSON.stringify(body.narrow)} is not a step of selection.md (${NARROW_STEPS.join(', ')})`)
    if (body.narrow === undefined) {
      if (body.triggers !== undefined) out.push(`kind ${name} has triggers but no narrow`)
      if (body.edges !== undefined) out.push(`kind ${name} has edges but no narrow`)
    }
    if (body.edges !== undefined) {
      if (!Array.isArray(body.edges)) out.push(`kind ${name} edges is not a list`)
      else
        body.edges.forEach((edge: unknown, i: number) => {
          const at = `kind ${name} edge ${i}`
          if (!isMap(edge)) return out.push(`${at} is not a mapping`)
          for (const key of Object.keys(edge)) if (!EDGE_KEYS.includes(key)) out.push(`${at} has unknown key ${key}`)
          for (const field of EDGE_KEYS) if (edge[field] === undefined || (Array.isArray(edge[field]) && edge[field].length === 0)) out.push(`${at} has no ${field}`)
          globs(`${at} paths`, edge.paths)
          // the tests of an edge are the kind's test files: that is what rule 5 of the reading rules runs
          for (const glob of globs(`${at} tests`, edge.tests))
            if (!isCatchAll(glob))
              for (const path of tracked)
                if (globMatches(glob, path) && !tests.some((t) => globMatches(t, path)))
                  out.push(`${at}: ${path} is not one of the kind's test files`)
        })
    }
  }

  for (const name of new Set([...(defined ?? []), ...Object.keys(kinds)])) {
    const body = kinds[name]
    const paths = isMap(body) ? body.paths : undefined
    // a malformed always or paths is reported above; its kinds are not reported again as having none
    if (!alwaysOk || (paths !== undefined && !Array.isArray(paths))) continue
    if (!always.includes(name) && !(Array.isArray(paths) && paths.length > 0)) out.push(`kind ${name} has neither always nor paths`)
  }
  return out
}
