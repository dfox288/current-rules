#!/usr/bin/env node
// init: writes the entry files of a repo that has app code and no test standards, and checks them (horizon-surveyor#387, D-499).
//
//   node init.mjs --stack nuxt --dir <repo>            write the entry files, one line per file; exit 0
//   node init.mjs --stack nuxt --dir <repo> --check    exit 0 when the repo meets the entry standard, else 1, one line per miss
//   another --stack                                    exit 2, "no init for stack <x> yet"
//
// The entry standard: the gate script, checks.map.yml (version 2) and checks.kinds.yml with lint and typecheck kinds only (no
// test kind), the package.json scripts and devDependencies those two kinds need, a lint config, README and CLAUDE.md.
// Node built-ins only. It never overwrites a file: a file it would create that exists is named and nothing is written.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const TEMPLATES = join(import.meta.dirname, 'templates')
const template = (name) => readFileSync(join(TEMPLATES, name), 'utf8')

/** Pinned to what the apps use (cove, beacon) and the released presets. */
export const DEV_DEPENDENCIES = {
  '@dfox288/test-gates': '0.7.0',
  '@nuxt/eslint-config': '^1.17.0',
  eslint: '^10.8.1',
  typescript: '~5.9.3',
  'vue-tsc': '^3.3.8',
}
export const SCRIPTS = {
  lint: 'eslint .',
  typecheck: 'nuxt typecheck',
  gates: 'node scripts/gates.mjs',
}
const NPMRC_LINE = '@dfox288:registry=https://npm.registry.tastatur-und-maus.net/'
const README_HEADING = '## Tests'
const ESLINT_CONFIGS = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map((x) => `eslint.config.${x}`)

/** Files init creates; any of them already there stops it. [path in the repo, template name]. */
const NEW_FILES = [
  ['scripts/gates.mjs', 'gates.mjs'],
  ['gates.config.json', 'gates.config.json'],
  ['checks.map.yml', 'checks.map.yml'],
  ['checks.kinds.yml', 'checks.kinds.yml'],
]

const usage = 'usage: node init.mjs --stack nuxt --dir <repo> [--check]'

// ---- a small YAML reader (block and flow mappings and lists, scalars, comments): enough for the two files; throws otherwise ----

function stripComment(line) {
  let quote = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

function flowDepth(text) {
  let depth = 0
  let quote = ''
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') depth--
  }
  return depth
}

function scalar(raw) {
  const s = raw.trim()
  if (/^"(?:[^"\\]|\\.)*"$/.test(s)) return JSON.parse(s)
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'")
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~' || s === '') return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}

function flow(text) {
  let i = 0
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++
  }
  const value = () => {
    ws()
    if (text[i] === '{') {
      i++
      const out = {}
      ws()
      while (text[i] !== '}') {
        const key = token(':')
        if (text[i] !== ':') throw new Error('flow mapping: missing ":"')
        i++
        out[key] = value()
        ws()
        if (text[i] === ',') i++
        ws()
        if (i >= text.length) throw new Error('flow mapping: unclosed "{"')
      }
      i++
      return out
    }
    if (text[i] === '[') {
      i++
      const out = []
      ws()
      while (text[i] !== ']') {
        out.push(value())
        ws()
        if (text[i] === ',') i++
        ws()
        if (i >= text.length) throw new Error('flow list: unclosed "["')
      }
      i++
      return out
    }
    return scalar(token(',}]'))
  }
  const token = (stops) => {
    ws()
    const start = i
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i++]
      while (i < text.length && text[i] !== q) i += text[i] === '\\' && q === '"' ? 2 : 1
      i++
      return scalar(text.slice(start, i))
    }
    while (i < text.length && !stops.includes(text[i])) i++
    return text.slice(start, i).trim()
  }
  const result = value()
  ws()
  if (i < text.length) throw new Error('trailing text after a flow value')
  return result
}

const KEY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s:#'"{[\-][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+(.*))?$/

export function parseYaml(text) {
  const lines = []
  const raw = text.split(/\r?\n/)
  for (let n = 0; n < raw.length; n++) {
    let body = stripComment(raw[n]).trimEnd()
    if (body.trim() === '') continue
    const indent = body.length - body.trimStart().length
    body = body.trim()
    // a flow value that continues on the next lines
    while (flowDepth(body) > 0 && n + 1 < raw.length) body += ' ' + stripComment(raw[++n]).trim()
    lines.push({ indent, text: body })
  }
  let pos = 0
  const inline = (s) => (s.startsWith('{') || s.startsWith('[') ? flow(s) : scalar(s))
  const isSeq = (l) => l.text === '-' || l.text.startsWith('- ')

  function block(indent) {
    if (lines[pos].text.startsWith('{') || lines[pos].text.startsWith('[')) return inline(lines[pos++].text)
    return isSeq(lines[pos]) ? seq(indent) : map(indent)
  }
  function map(indent) {
    const out = {}
    while (pos < lines.length && lines[pos].indent === indent && !isSeq(lines[pos])) {
      const m = KEY.exec(lines[pos].text)
      if (!m) throw new Error(`cannot read "${lines[pos].text.slice(0, 40)}"`)
      const key = scalar(m[1])
      pos++
      if (m[2] !== undefined && m[2] !== '' && !/^&\S+$/.test(m[2])) // a bare anchor (`&name`) opens a block; aliases are not read
        out[key] = inline(m[2])
      else if (pos < lines.length && (lines[pos].indent > indent || (lines[pos].indent === indent && isSeq(lines[pos])))) out[key] = block(lines[pos].indent)
      else out[key] = null
    }
    return out
  }
  function seq(indent) {
    const out = []
    while (pos < lines.length && lines[pos].indent === indent && isSeq(lines[pos])) {
      const rest = lines[pos].text.slice(1).trim()
      if (rest === '') {
        pos++
        out.push(pos < lines.length && lines[pos].indent > indent ? block(lines[pos].indent) : null)
      } else if (KEY.test(rest) && !rest.startsWith('{') && !rest.startsWith('[')) {
        // "- key: value" opens a mapping whose first line sits two columns in
        lines[pos] = { indent: indent + 2, text: rest }
        out.push(map(indent + 2))
      } else {
        pos++
        out.push(inline(rest))
      }
    }
    return out
  }
  if (lines.length === 0) return null
  const result = block(lines[0].indent)
  if (pos < lines.length) throw new Error(`cannot read "${lines[pos].text.slice(0, 40)}"`)
  return result
}

// ---- the entry standard: the shape Current accepts (packages/shared checks-kinds.ts, checks-map.ts, core repo-kinds.ts) ----

const KIND_NAME = /^[a-z][a-z0-9-]{0,31}$/
const KINDS_FILE_KEYS = ['kinds', 'gateStatuses']
const KIND_KEYS = ['cache', 'describe', 'image', 'services', 'localhostNames', 'dir', 'env', 'tools']
const MAP_KEYS = ['version', 'always', 'notest', 'kinds']
const MAP_KIND_KEYS = ['paths', 'tests', 'narrow', 'triggers', 'edges']
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The problems Current's reader finds in a parsed checks.kinds.yml (shapes only); empty when it accepts the file. */
export function kindsProblems(parsed) {
  if (!isObject(parsed)) return ['checks.kinds.yml is not a mapping']
  const out = []
  for (const key of Object.keys(parsed)) if (!KINDS_FILE_KEYS.includes(key)) out.push(`checks.kinds.yml: unknown top-level key "${key}"`)
  if (!isObject(parsed.kinds)) return [...out, 'checks.kinds.yml: kinds is not a mapping']
  if (Object.keys(parsed.kinds).length === 0) out.push('checks.kinds.yml: kinds names no kind')
  if ('gateStatuses' in parsed && typeof parsed.gateStatuses !== 'boolean') out.push('checks.kinds.yml: gateStatuses is not true or false')
  for (const [name, body] of Object.entries(parsed.kinds)) {
    if (!KIND_NAME.test(name)) out.push(`checks.kinds.yml: kind "${name}" is not a short lowercase name`)
    if (!isObject(body)) {
      out.push(`checks.kinds.yml: kind "${name}" is not a mapping`)
      continue
    }
    if ('paths' in body) out.push(`checks.kinds.yml: kind "${name}": paths belongs in checks.map.yml, not here`)
    for (const key of Object.keys(body)) if (key !== 'paths' && !KIND_KEYS.includes(key)) out.push(`checks.kinds.yml: kind "${name}" has unknown key "${key}"`)
    if ('describe' in body && (typeof body.describe !== 'string' || body.describe.trim() === '' || body.describe.length > 300))
      out.push(`checks.kinds.yml: kind "${name}": describe is not a text of 1 to 300 characters`)
  }
  return out
}

/** The problems with a parsed version 2 checks.map.yml against the kind names of checks.kinds.yml (shapes; globs are not matched against files). */
export function mapProblems(parsed, kindNames) {
  if (!isObject(parsed)) return ['checks.map.yml is not a mapping']
  const out = []
  if (parsed.version !== 2) out.push(`checks.map.yml: version is ${JSON.stringify(parsed.version)}, not 2`)
  for (const key of Object.keys(parsed)) if (!MAP_KEYS.includes(key)) out.push(`checks.map.yml: unknown top-level key "${key}"`)
  if (!isObject(parsed.kinds)) out.push('checks.map.yml: kinds is not a mapping')
  const always = Array.isArray(parsed.always) ? parsed.always : parsed.always === undefined ? [] : null
  if (always === null) out.push('checks.map.yml: always is not a list')
  for (const entry of always ?? []) if (typeof entry !== 'string' || !kindNames.includes(entry)) out.push(`checks.map.yml: always entry ${JSON.stringify(entry)} is not a kind of checks.kinds.yml`)
  const mapKinds = isObject(parsed.kinds) ? parsed.kinds : {}
  for (const [name, body] of Object.entries(mapKinds)) {
    if (!kindNames.includes(name)) out.push(`checks.map.yml: kind "${name}" is missing from checks.kinds.yml`)
    if (!isObject(body)) out.push(`checks.map.yml: kind "${name}" is not a mapping`)
    else for (const key of Object.keys(body)) if (!MAP_KIND_KEYS.includes(key)) out.push(`checks.map.yml: kind "${name}" has unknown key "${key}"`)
  }
  for (const name of kindNames) {
    const paths = isObject(mapKinds[name]) ? mapKinds[name].paths : undefined
    if (!(always ?? []).includes(name) && !(Array.isArray(paths) && paths.length > 0)) out.push(`checks.map.yml: kind "${name}" has neither always nor paths`)
  }
  return out
}

function readJson(path) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (error) {
    return { error: error instanceof Error ? error.message.split('\n')[0] : String(error) }
  }
}

/** One line per miss; empty when the repo meets the entry standard. */
export function check(dir) {
  const misses = []
  const at = (path) => join(dir, path)
  const need = (path) => {
    if (existsSync(at(path))) return true
    misses.push(`missing: ${path}`)
    return false
  }

  let kindNames = []
  if (need('checks.kinds.yml')) {
    try {
      const parsed = parseYaml(readFileSync(at('checks.kinds.yml'), 'utf8'))
      const problems = kindsProblems(parsed)
      misses.push(...problems)
      if (isObject(parsed) && isObject(parsed.kinds)) kindNames = Object.keys(parsed.kinds)
    } catch (error) {
      misses.push(`checks.kinds.yml does not parse: ${error.message}`)
    }
  }
  if (need('checks.map.yml')) {
    try {
      misses.push(...mapProblems(parseYaml(readFileSync(at('checks.map.yml'), 'utf8')), kindNames))
    } catch (error) {
      misses.push(`checks.map.yml does not parse: ${error.message}`)
    }
  }

  let scripts = {}
  let deps = {}
  if (need('package.json')) {
    const pkg = readJson(at('package.json'))
    if (pkg.error) misses.push(`package.json does not parse: ${pkg.error}`)
    else {
      scripts = pkg.value.scripts ?? {}
      deps = { ...pkg.value.dependencies, ...pkg.value.devDependencies }
    }
  }

  if (need('gates.config.json')) {
    const config = readJson(at('gates.config.json'))
    if (config.error) misses.push(`gates.config.json does not parse: ${config.error}`)
    else if (config.value.stack !== 'vitest' && config.value.stack !== 'pytest') misses.push('gates.config.json: stack is not "vitest" or "pytest"')
  }
  if (!deps['@dfox288/test-gates']) misses.push('package.json: devDependency @dfox288/test-gates is missing (scripts/gates.mjs runs test-gates)')
  if (!scripts.gates) misses.push('package.json: script "gates" is missing')
  if (kindNames.includes('lint') && !scripts.lint) misses.push('package.json: script "lint" is missing (kind lint)')
  if (kindNames.includes('typecheck') && !scripts.typecheck) misses.push('package.json: script "typecheck" is missing (kind typecheck)')
  if (kindNames.includes('lint') && !ESLINT_CONFIGS.some((f) => existsSync(at(f)))) misses.push('missing: eslint.config.* (kind lint)')

  if (need('scripts/gates.mjs') && kindNames.length > 0) {
    // the gate script must know every kind the repo declares: `--list` prints the names
    const listed = spawnSync(process.execPath, ['scripts/gates.mjs', '--list'], { cwd: dir, encoding: 'utf8' })
    if (listed.status !== 0) misses.push(`scripts/gates.mjs --list exits ${listed.status}`)
    else {
      const known = listed.stdout.split('\n').filter(Boolean)
      for (const name of kindNames) if (!known.includes(name)) misses.push(`scripts/gates.mjs does not know kind "${name}" (it lists: ${known.join(', ') || 'none'})`)
    }
  }

  if (!existsSync(at('.npmrc')) || !readFileSync(at('.npmrc'), 'utf8').includes('@dfox288:registry=')) misses.push('.npmrc: no @dfox288:registry line')
  if (need('README.md') && !readFileSync(at('README.md'), 'utf8').split('\n').some((l) => l.trim() === README_HEADING)) misses.push(`README.md: no "${README_HEADING}" section`)
  need('CLAUDE.md')
  return misses
}

// ---- writing ----

function isNuxtRepo(dir) {
  const pkg = readJson(join(dir, 'package.json'))
  if (pkg.error) return `no usable package.json (${pkg.error})`
  const all = { ...pkg.value.dependencies, ...pkg.value.devDependencies }
  return all.nuxt ? null : 'package.json has no nuxt dependency'
}

/** Writes the entry files. Returns { lines, conflicts }: with conflicts nothing was written. */
export function init(dir) {
  const notNuxt = !existsSync(join(dir, 'package.json')) ? 'no package.json' : isNuxtRepo(dir)
  if (notNuxt) return { lines: [], conflicts: [`not a Nuxt repo: ${notNuxt}`] }

  // 1. conflicts, before anything is written
  const conflicts = []
  for (const [path] of NEW_FILES) if (existsSync(join(dir, path))) conflicts.push(`${path} exists; init does not overwrite it`)
  const pkgText = readFileSync(join(dir, 'package.json'), 'utf8')
  const pkg = JSON.parse(pkgText)
  for (const [name, command] of Object.entries(SCRIPTS))
    if (pkg.scripts?.[name] !== undefined && pkg.scripts[name] !== command) conflicts.push(`package.json script "${name}" is "${pkg.scripts[name]}", init needs "${command}"`)
  if (conflicts.length > 0) return { lines: [], conflicts }

  const lines = []
  const write = (path, content, verb = 'wrote') => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
    lines.push(`${verb} ${path}`)
  }

  for (const [path, name] of NEW_FILES) write(path, template(name))

  // package.json: scripts and devDependencies added, nothing existing changed
  const indent = /^\{\n(\s+)"/.exec(pkgText)?.[1] ?? '  '
  pkg.scripts = { ...pkg.scripts }
  const added = []
  for (const [name, command] of Object.entries(SCRIPTS)) if (pkg.scripts[name] === undefined) (pkg.scripts[name] = command), added.push(`script ${name}`)
  const present = { ...pkg.dependencies, ...pkg.devDependencies }
  pkg.devDependencies = { ...pkg.devDependencies }
  for (const [name, version] of Object.entries(DEV_DEPENDENCIES)) if (present[name] === undefined) (pkg.devDependencies[name] = version), added.push(name)
  pkg.devDependencies = Object.fromEntries(Object.entries(pkg.devDependencies).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, indent) + '\n')
  lines.push(`updated package.json (${added.length ? 'added ' + added.join(', ') : 'nothing to add'})`)

  // a lint config, if the repo has none
  if (ESLINT_CONFIGS.some((f) => existsSync(join(dir, f)))) lines.push('kept its own eslint.config.*')
  else write('eslint.config.mjs', template('eslint.config.mjs'))

  // pnpm 11 stops `pnpm install` on a dependency build script nobody decided on
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) lines.push('kept its own pnpm-workspace.yaml (it must decide the build scripts of esbuild and unrs-resolver: allowBuilds)')
  else write('pnpm-workspace.yaml', template('pnpm-workspace.yaml'))

  // the registry scope for @dfox288
  const npmrc = join(dir, '.npmrc')
  if (!existsSync(npmrc)) write('.npmrc', NPMRC_LINE + '\n')
  else if (!readFileSync(npmrc, 'utf8').includes('@dfox288:registry=')) {
    const text = readFileSync(npmrc, 'utf8')
    writeFileSync(npmrc, text + (text === '' || text.endsWith('\n') ? '' : '\n') + NPMRC_LINE + '\n')
    lines.push('appended the @dfox288 registry line to .npmrc')
  }

  // gate logs go to .tmp/
  const ignore = join(dir, '.gitignore')
  if (!existsSync(ignore)) write('.gitignore', 'node_modules\n.nuxt\n.output\n.tmp\n')
  else {
    const text = readFileSync(ignore, 'utf8')
    if (!text.split('\n').some((l) => /^\/?\.tmp\/?$/.test(l.trim()))) {
      writeFileSync(ignore, text + (text === '' || text.endsWith('\n') ? '' : '\n') + '.tmp\n')
      lines.push('appended .tmp to .gitignore')
    }
  }

  // README: the section on how tests will be added; appended to an existing README, never replacing it
  const readme = join(dir, 'README.md')
  if (!existsSync(readme)) write('README.md', template('README.section.md'))
  else {
    const text = readFileSync(readme, 'utf8')
    if (text.split('\n').some((l) => l.trim() === README_HEADING)) lines.push('kept the Tests section of README.md')
    else {
      writeFileSync(readme, text + (text === '' || text.endsWith('\n') ? '' : '\n') + '\n' + template('README.section.md'))
      lines.push('appended the Tests section to README.md')
    }
  }

  if (existsSync(join(dir, 'CLAUDE.md'))) lines.push('kept its own CLAUDE.md')
  else write('CLAUDE.md', template('CLAUDE.md'))

  return { lines, conflicts: [] }
}

function main(argv) {
  let stack
  let dir
  let checkOnly = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--stack') stack = argv[++i]
    else if (arg.startsWith('--stack=')) stack = arg.slice('--stack='.length)
    else if (arg === '--dir') dir = argv[++i]
    else if (arg.startsWith('--dir=')) dir = arg.slice('--dir='.length)
    else if (arg === '--check') checkOnly = true
    else {
      console.error(`init: unknown argument "${arg}"\n${usage}`)
      return 2
    }
  }
  if (!stack || !dir) {
    console.error(`init: --stack and --dir are required\n${usage}`)
    return 2
  }
  if (stack !== 'nuxt') {
    console.error(`no init for stack ${stack} yet`)
    return 2
  }
  if (!existsSync(dir)) {
    console.error(`init: ${dir} does not exist`)
    return 2
  }
  if (checkOnly) {
    const misses = check(dir)
    for (const miss of misses) console.log(miss)
    if (misses.length === 0) console.log('entry standard met')
    return misses.length === 0 ? 0 : 1
  }
  const { lines, conflicts } = init(dir)
  for (const line of lines) console.log(line)
  for (const conflict of conflicts) console.error(`init: ${conflict}`)
  if (conflicts.length > 0) {
    console.error('init: nothing written')
    return 1
  }
  // its own check, on what it just wrote
  const misses = check(dir)
  for (const miss of misses) console.error(`init: check: ${miss}`)
  return misses.length === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.filename === process.argv[1]) process.exitCode = main(process.argv.slice(2))
