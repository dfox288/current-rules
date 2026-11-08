#!/usr/bin/env node
// init: writes the entry files of a repo that has app code and no test standards, and checks them (horizon-surveyor#387, D-499).
//
//   node init.mjs --stack nuxt --dir <repo>            write the entry files, one line per file; exit 0
//   node init.mjs --stack nuxt --dir <repo> --check    exit 0 when the repo meets the entry standard, else 1, one line per miss
//   another --stack                                    exit 2, "no init for stack <x> yet"
//
// The entry standard: the gate script, checks.map.yml (version 2) and checks.kinds.yml with the lint and typecheck kinds
// (D-499; more kinds may follow, no test kind is needed), both files under Current's own rules; the package.json scripts and
// dependencies those kinds need (their gates and scripts run eslint and nuxt typecheck or vue-tsc, not just exist); a lint
// config; a pnpm-workspace.yaml that decides the esbuild and unrs-resolver builds and holds the release age (D-439); a
// pnpm-lock.yaml that covers package.json and was made for its packageManager; the registry line, README and CLAUDE.md.
// --check decides only those two builds: a build another dependency of the repo has (better-sqlite3, sharp) is not seen
// (a v9 lockfile does not say which packages build), so a green --check does not mean a frozen install passes. The entry
// commit is accepted only by Current building the dependency image from it (horizon-surveyor#388), not by --check alone.
// Node built-ins only. It never overwrites a file: a file it would create that exists is named and nothing is written. It
// rewrites package.json with its new keys added after the ones there (indentation, line endings and key order kept; the
// rest is JSON.stringify's: inline arrays and objects come out one entry per line, an escape such as \u00e9 is decoded).
// It writes no lockfile: the entry step makes pnpm-lock.yaml next (D-500), and --check is red until it covers package.json.
// Run it from a checkout of current-rules at a release tag: it pins @dfox288/test-gates to that release (PRESETS_VERSION).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const TEMPLATES = join(import.meta.dirname, 'templates')
const template = (name) => readFileSync(join(TEMPLATES, name), 'utf8')

/**
 * The presets' version is the version of this checkout's own `gates/package.json`: init run from the tag
 * `test-presets-vX.Y.Z` pins `@dfox288/test-gates` X.Y.Z, the release that tag published, so a new repo needs no repin.
 */
export const PRESETS_VERSION = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'gates', 'package.json'), 'utf8')).version

/** The others are pinned to what the five apps use (bridge, cove, beacon, lookout's web app; tide's are older). */
export const DEV_DEPENDENCIES = {
  '@dfox288/test-gates': PRESETS_VERSION,
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
/** Set only when absent, as in the five apps: the pnpm Current also uses when a repo names none, and test-gates' Node. */
const PACKAGE_MANAGER = 'pnpm@12.8.1'
const NODE_ENGINE = '>=24'
const NPMRC_LINE = '@dfox288:registry=https://npm.registry.tastatur-und-maus.net/'
/** The apps' heading of the section (bridge, cove, beacon, lookout, tide); --check takes any `## Tests...` heading. */
const README_HEADING = '## Tests and gates'
const hasTestsSection = (text) => text.split('\n').some((l) => /^## Tests\b/.test(l.trim()))
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
        if (Object.hasOwn(out, key)) throw new Error(`Map keys must be unique ("${String(key).slice(0, 40)}")`)
        out[key] = value()
        ws()
        if (i >= text.length) throw new Error('flow mapping: unclosed "{"')
        if (text[i] === ',') i++
        else if (text[i] !== '}') throw new Error('Missing , between flow mapping items')
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
        if (i >= text.length) throw new Error('flow list: unclosed "["')
        if (text[i] === ',') i++
        else if (text[i] !== ']') throw new Error('Missing , between flow sequence items')
        ws()
        if (i >= text.length) throw new Error('flow list: unclosed "["')
      }
      i++
      return out
    }
    const quoted = text[i] === '"' || text[i] === "'"
    const raw = token(',}]')
    // a plain value that holds `key: value` is an item that lost its comma (`{ a: true b: false }`)
    if (!quoted && /:\s/.test(raw)) throw new Error('Missing , between flow items (a plain value holds ": ")')
    return scalar(raw)
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
    // a block scalar (`key: >-`, `- |`): its more-indented lines become one quoted value
    const blockScalar = /^(.*?:|-)\s+([|>])([+-]?)$/.exec(body)
    if (blockScalar && (blockScalar[1] === '-' || KEY.test(blockScalar[1]))) {
      const content = []
      while (n + 1 < raw.length && (raw[n + 1].trim() === '' || raw[n + 1].length - raw[n + 1].trimStart().length > indent)) content.push(raw[++n])
      let trailing = 0
      while (content.length > 0 && content[content.length - 1].trim() === '') content.pop(), trailing++
      const cut = Math.min(...content.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length))
      const texts = content.map((l) => (l.trim() === '' ? '' : l.slice(cut).trimEnd()))
      let value = blockScalar[2] === '|' ? texts.join('\n') : texts.reduce((acc, l, k) => (k === 0 ? l : l === '' ? acc + '\n' : acc.endsWith('\n') ? acc + l : acc + ' ' + l), '')
      if (content.length > 0 && blockScalar[3] !== '-') value += '\n' + (blockScalar[3] === '+' ? '\n'.repeat(trailing) : '')
      lines.push({ indent, text: `${blockScalar[1]} ${JSON.stringify(value)}` })
      continue
    }
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
      if (Object.hasOwn(out, key)) throw new Error(`Map keys must be unique ("${String(key).slice(0, 40)}")`)
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

// ---- the entry standard: the rules Current applies to the two files (current 1699738: packages/shared/src/checks-kinds.ts
// kindsFileProblems and checks-map.ts kindProblems and mapProblemsV2, ported as they are). Not checked here: what the instance
// allows (images, services, apt names it grants, core/src/repo-kinds.ts) and whether a map glob matches a tracked file. ----

const KIND_NAME = /^[a-z][a-z0-9-]{0,31}$/
const KINDS_FILE_KEYS = ['kinds', 'gateStatuses']
const KIND_KEYS = ['cache', 'describe', 'image', 'services', 'localhostNames', 'dir', 'env', 'paths', 'tools']
const APT_NAME = /^[a-z0-9][a-z0-9+.-]{0,63}$/
const SERVICE_NAME = /^[a-z][a-z0-9-]{0,31}$/
const LOCALHOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.localhost$/
const DIR = /^(\.|[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*)$/
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
const ENV_RESERVED = new RegExp(
  '^(CURRENT_|pnpm_config_|npm_config_|NPM_CONFIG_|PNPM_CONFIG_|LD_|DOCKER_|GIT_|XDG_|PYTHON)' +
    '|^(PATH|HOME|USER|SHELL|ENV|BASH_ENV|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|PNPM_HOME|TMPDIR|IFS|PS4|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|FTP_PROXY)$',
)
const ENV_SECRETISH = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|API_?KEY|AUTH)/
const MAP_KEYS = ['version', 'always', 'notest', 'kinds']
const MAP_KIND_KEYS = ['paths', 'tests', 'narrow', 'triggers', 'edges']
const NARROW_STEPS = ['vitest-related']
const CATCH_ALL = /^\/?\*{1,2}$/
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStringList = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s !== '')
const short = (name) => String(name).slice(0, 40)

/** The problems of one kind's body, as Current's kindProblems words them. */
function kindProblems(name, body) {
  const out = []
  const at = `kind "${name}"`
  for (const key of Object.keys(body)) if (!KIND_KEYS.includes(key)) out.push(`${at} has unknown key "${key}"`)
  if ('cache' in body && body.cache !== 'never') out.push(`${at}: cache is ${JSON.stringify(body.cache)}, only "never" exists`)
  if ('describe' in body && (typeof body.describe !== 'string' || body.describe.trim() === '' || body.describe.length > 300)) out.push(`${at}: describe is not a text of 1 to 300 characters`)
  if ('image' in body && (typeof body.image !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(body.image))) out.push(`${at}: image is not a catalog image name`)
  if ('services' in body && !(Array.isArray(body.services) && body.services.length <= 8 && body.services.every((x) => typeof x === 'string' && SERVICE_NAME.test(x)))) out.push(`${at}: services is not a list of service names`)
  if ('localhostNames' in body && !(Array.isArray(body.localhostNames) && body.localhostNames.length <= 8 && body.localhostNames.every((x) => typeof x === 'string' && LOCALHOST.test(x)))) out.push(`${at}: localhostNames is not a list of *.localhost names`)
  if ('dir' in body && !(typeof body.dir === 'string' && DIR.test(body.dir))) out.push(`${at}: dir is not a repo-relative directory`)
  if ('tools' in body) {
    if (!isObject(body.tools)) out.push(`${at}: tools is not a mapping`)
    else {
      for (const key of Object.keys(body.tools)) if (key !== 'apt') out.push(`${at}: tools has unknown key "${short(key)}"`)
      const apt = body.tools.apt
      if ('apt' in body.tools && !(Array.isArray(apt) && apt.length <= 24 && apt.every((x) => typeof x === 'string' && APT_NAME.test(x)))) out.push(`${at}: tools.apt is not a list of package names`)
    }
  }
  if ('paths' in body && typeof body.paths !== 'boolean') out.push(`${at}: paths is not true or false`)
  if ('env' in body) {
    if (!isObject(body.env) || Object.keys(body.env).length > 16) out.push(`${at}: env is not a mapping of at most 16 variables`)
    else
      for (const [k, v] of Object.entries(body.env)) {
        if (!ENV_NAME.test(k)) out.push(`${at}: env name "${short(k)}" is not UPPER_SNAKE_CASE`)
        else if (ENV_RESERVED.test(k)) out.push(`${at}: env name ${k} is Current's or the container's own`)
        else if (ENV_SECRETISH.test(k)) out.push(`${at}: env name ${k} looks like a secret; a kind's env is non-secret`)
        // eslint-disable-next-line no-control-regex
        if (typeof v !== 'string' || v.length > 200 || /[\u0000-\u001f]/.test(v)) out.push(`${at}: env ${k} is not a short text`)
      }
  }
  return out
}

/** The problems Current's reader finds in a parsed checks.kinds.yml; empty when it accepts the file. */
export function kindsProblems(parsed) {
  if (!isObject(parsed)) return ['checks.kinds.yml is not a mapping']
  const out = []
  for (const key of Object.keys(parsed)) if (!KINDS_FILE_KEYS.includes(key)) out.push(`unknown top-level key "${short(key)}"`)
  if (!isObject(parsed.kinds)) return [...out, 'kinds is not a mapping'].map((p) => `checks.kinds.yml: ${p}`)
  if (Object.keys(parsed.kinds).length === 0) out.push('kinds names no kind')
  if ('gateStatuses' in parsed && typeof parsed.gateStatuses !== 'boolean') out.push('gateStatuses is not true or false')
  for (const [name, body] of Object.entries(parsed.kinds)) {
    if (!KIND_NAME.test(name)) out.push(`kind "${short(name)}" is not a short lowercase name`)
    if (!isObject(body)) out.push(`kind "${short(name)}" is not a mapping`)
    else if ('paths' in body) out.push(`kind "${short(name)}": paths belongs in checks.map.yml (its globs), not here`)
    else out.push(...kindProblems(name, body))
  }
  return out.map((p) => `checks.kinds.yml: ${p}`)
}

/** The problems Current finds in a parsed version 2 checks.map.yml against the kind names of checks.kinds.yml (globs are not matched against files). */
export function mapProblems(parsed, kindNames) {
  if (!isObject(parsed)) return ['checks.map.yml is not a mapping']
  const out = []
  if (parsed.version !== 2) out.push(`version is ${JSON.stringify(parsed.version)}, not 2`)
  for (const key of Object.keys(parsed)) if (!MAP_KEYS.includes(key)) out.push(`unknown top-level key "${short(key)}"`)
  if (!('kinds' in parsed)) out.push('missing top-level key "kinds"')
  const globs = (at, list, optional = false) => {
    if (list === undefined && optional) return []
    if (!isStringList(list)) return out.push(`${at} is not a list of globs`), []
    for (const pattern of list) if (CATCH_ALL.test(pattern)) out.push(`${at}: "${pattern}" is a catch-all; a file nothing matches already runs everything`)
    return list
  }
  let always = []
  if ('always' in parsed && !Array.isArray(parsed.always)) out.push('always is not a list')
  else if (Array.isArray(parsed.always)) {
    always = parsed.always.filter((e) => typeof e === 'string')
    for (const entry of parsed.always) if (typeof entry !== 'string' || !kindNames.includes(entry)) out.push(`always entry ${JSON.stringify(entry)} is not a kind of checks.kinds.yml`)
  }
  globs('notest', parsed.notest, true)
  const kinds = isObject(parsed.kinds) ? parsed.kinds : {}
  if ('kinds' in parsed && !isObject(parsed.kinds)) out.push('kinds is not a mapping')
  for (const [name, body] of Object.entries(kinds)) {
    const at = `kind "${short(name)}"`
    if (!KIND_NAME.test(name)) out.push(`${at} is not a short lowercase name`)
    if (!kindNames.includes(name)) out.push(`${at} is missing from checks.kinds.yml`)
    if (!isObject(body)) {
      out.push(`${at} is not a mapping`)
      continue
    }
    for (const key of Object.keys(body)) if (!MAP_KIND_KEYS.includes(key)) out.push(`${at} has unknown key "${short(key)}"`)
    globs(`${at}: paths`, body.paths, true)
    globs(`${at}: tests`, body.tests, true)
    if ('narrow' in body && !NARROW_STEPS.includes(body.narrow)) out.push(`${at}: narrow ${JSON.stringify(body.narrow)?.slice(0, 40)} is not a known step (${NARROW_STEPS.join(', ')})`)
    if (!('narrow' in body)) {
      if ('triggers' in body) out.push(`${at}: triggers on a kind without narrow`)
      if ('edges' in body) out.push(`${at}: edges on a kind without narrow`)
    }
    globs(`${at}: triggers`, body.triggers, true)
    if ('edges' in body) {
      if (!Array.isArray(body.edges)) out.push(`${at}: edges is not a list`)
      else
        body.edges.forEach((edge, i) => {
          const here = `${at}: edge ${i + 1}`
          if (!isObject(edge)) return void out.push(`${here} is not a mapping`)
          for (const key of Object.keys(edge)) if (key !== 'paths' && key !== 'tests') out.push(`${here} has unknown key "${short(key)}"`)
          globs(`${here}: paths`, edge.paths)
          globs(`${here}: tests`, edge.tests)
        })
    }
  }
  // Current: a declared kind with neither always nor an entry of its own in the map's kinds
  for (const name of kindNames) if (!Object.hasOwn(kinds, name) && !always.includes(name)) out.push(`kind "${short(name)}" has neither always nor paths`)
  for (const [name, body] of Object.entries(kinds)) if (isObject(body) && !(isStringList(body.paths) && body.paths.length > 0) && !always.includes(name)) out.push(`kind "${short(name)}" has neither always nor paths`)
  return out.map((p) => `checks.map.yml: ${p}`)
}

/**
 * The commands of a script or shell line, each as its words: `nuxi prepare && eslint .` gives [nuxi, prepare] and
 * [eslint, .]. Quotes around words, leading `VAR=value` words and the prefixes `sh -c`, `pnpm exec` and `npx` are taken
 * off; it is a reading of the usual script shapes, not a shell parser.
 */
export function commandsOf(line) {
  const out = []
  for (const part of line.split(/&&|\|\||[;|]/)) {
    let words = part.split(/\s+/).map((w) => w.replace(/^[('"]+|[)'"]+$/g, '')).filter(Boolean)
    for (let before = -1; before !== words.length; ) {
      before = words.length
      while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift()
      if ((words[0] === 'sh' || words[0] === 'bash') && words[1] === '-c') words = words.slice(2)
      else if (words[0] === 'pnpm' && words[1] === 'exec') words = words.slice(2)
      else if (words[0] === 'npx') words = words.slice(1)
    }
    if (words.length > 0) out.push(words)
  }
  return out
}

/** What the lint and typecheck kinds must run, as one of the commands of their script or gate command. */
const TOOLS = {
  lint: { tool: 'eslint', runs: (w) => w[0] === 'eslint' },
  typecheck: { tool: 'nuxt typecheck or vue-tsc', runs: (w) => ((w[0] === 'nuxt' || w[0] === 'nuxi') && w[1] === 'typecheck') || w[0] === 'vue-tsc' },
}

function readJson(path) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (error) {
    return { error: error instanceof Error ? error.message.split('\n')[0] : String(error) }
  }
}

/** The tools the two kinds run, which must be in package.json (an offline install has nothing else). */
const KIND_DEPENDENCIES = { lint: ['eslint'], typecheck: ['typescript', 'vue-tsc'] }
/**
 * Builds a Nuxt repo with init's devDependencies has, which pnpm 11+ stops `pnpm install` on until the workspace file decides
 * them. The only builds --check decides; the repo's own dependencies' builds are the repo's, found by the dependency image build.
 */
const BUILDS = ['esbuild', 'unrs-resolver']
/** The release-age hold (D-439), and the scope that skips it. */
const HOLD_EXCLUDE = '@dfox288/*'

/**
 * How a top-level key of the workspace file is written (bare, or quoted as `"key":` or `'key':`): 'absent'; 'block' (its
 * entries on the next lines, `indent` being theirs); 'flow' (`key: { … }` or `key: [ … ]`); or 'value' (a scalar on the
 * key's line).
 */
function keyForm(text, key) {
  const lines = text.split(/\r?\n/)
  const head = new RegExp(`^(?:${key}|"${key}"|'${key}')[ \\t]*:`)
  const i = lines.findIndex((l) => head.test(l))
  if (i < 0) return { form: 'absent' }
  const rest = stripComment(lines[i]).replace(head, '').trim()
  if (rest.startsWith('{') || rest.startsWith('[')) return { form: 'flow' }
  if (rest !== '' && !/^&\S+$/.test(rest)) return { form: 'value' }
  const next = lines.slice(i + 1).find((l) => stripComment(l).trim() !== '')
  const lead = next === undefined ? '' : /^[ \t]*/.exec(next)[0]
  return { form: 'block', indent: lead !== '' || next?.trimStart().startsWith('-') ? lead : '  ' }
}

/** A value written as YAML on one line: strings single-quoted, a mapping's keys bare when they can be. */
function flowText(value) {
  if (Array.isArray(value)) return `[${value.map(flowText).join(', ')}]`
  if (isObject(value)) return `{ ${Object.entries(value).map(([k, v]) => `${/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(k) ? k : flowText(k)}: ${flowText(v)}`).join(', ')} }`
  return typeof value === 'string' ? `'${value.replace(/'/g, "''")}'` : String(value)
}

/**
 * What to write so that the top-level key `key` also has `additions` (a mapping, or a list), as `how:` and the lines: under
 * the key for a block, the key's whole new value for a flow collection (whatever its commas and lines were), the key with
 * its entries when it is absent or a scalar.
 */
function addTo(text, key, current, additions) {
  const { form, indent } = keyForm(text, key)
  const list = Array.isArray(additions)
  const entries = list ? additions.map((e) => `- ${flowText(e)}`) : Object.entries(additions).map(([k, v]) => `${k}: ${flowText(v)}`)
  const lines = (how, body) => `${how}:\n${body.map((l) => `    ${l}`).join('\n')}`
  if (form === 'block') return lines(`under ${key}, add`, entries.map((e) => indent + e))
  if (form === 'flow') {
    const merged = list ? [...(Array.isArray(current) ? current : []), ...additions] : { ...(isObject(current) ? current : {}), ...additions }
    return lines(`replace ${key} and its whole value with`, [`${key}: ${flowText(merged)}`])
  }
  return lines(form === 'value' ? `replace ${key} with` : 'add', [`${key}:`, ...entries.map((e) => `  ${e}`)])
}

/**
 * The problems with a pnpm-workspace.yaml for the entry: every build in BUILDS decided (allowBuilds, or the older
 * onlyBuiltDependencies / ignoredBuiltDependencies / neverBuiltDependencies lists), and the release-age hold. Each is
 * { miss, fix }, fix being what to add, under the key when the file has it (never a second key of the same name). A build
 * absent from the lockfile, when there is one, needs no decision. Only BUILDS are decided here: a build another dependency
 * of the repo has is the repo's to decide, and the entry step's dependency image build finds it.
 */
export function workspaceProblems(text, lockText) {
  let ws
  try {
    ws = parseYaml(text) ?? {}
  } catch (error) {
    return [{ miss: `pnpm-workspace.yaml: init's reader cannot read it (${error.message}); its builds and release-age hold are unchecked` }]
  }
  if (!isObject(ws)) return [{ miss: 'pnpm-workspace.yaml is not a mapping' }]
  const out = []
  if (ws.dangerouslyAllowAllBuilds !== true) {
    const decided = new Set([
      ...(isObject(ws.allowBuilds) ? Object.keys(ws.allowBuilds) : []),
      ...['onlyBuiltDependencies', 'ignoredBuiltDependencies', 'neverBuiltDependencies'].flatMap((key) => (Array.isArray(ws[key]) ? ws[key].filter((x) => typeof x === 'string') : [])),
    ])
    const inTree = (name) => lockText === undefined || new RegExp(`^\\s+'?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@`, 'm').test(lockText)
    const template = parseYaml(readFileSync(join(TEMPLATES, 'pnpm-workspace.yaml'), 'utf8')).allowBuilds
    const undecided = BUILDS.filter((name) => !decided.has(name) && inTree(name))
    if (undecided.length > 0)
      out.push({
        miss: `pnpm-workspace.yaml does not decide the build${undecided.length > 1 ? 's' : ''} of ${undecided.join(' and ')} (pnpm install exits 1, ERR_PNPM_IGNORED_BUILDS)`,
        fix: addTo(text, 'allowBuilds', ws.allowBuilds, Object.fromEntries(undecided.map((name) => [name, template[name]]))),
      })
  }
  if (!(typeof ws.minimumReleaseAge === 'number' && ws.minimumReleaseAge > 0))
    out.push({
      miss: 'pnpm-workspace.yaml has no minimumReleaseAge (the release-age hold, D-439)',
      fix: `${keyForm(text, 'minimumReleaseAge').form === 'absent' ? 'add' : 'set it to'}:\n    minimumReleaseAge: 1440`,
    })
  if (!(Array.isArray(ws.minimumReleaseAgeExclude) && ws.minimumReleaseAgeExclude.includes(HOLD_EXCLUDE)))
    out.push({ miss: `pnpm-workspace.yaml: minimumReleaseAgeExclude does not list '${HOLD_EXCLUDE}' (our scope skips the hold, D-439)`, fix: addTo(text, 'minimumReleaseAgeExclude', ws.minimumReleaseAgeExclude, [HOLD_EXCLUDE]) })
  return out
}

/**
 * The pnpm version a frozen install needs the lockfile to be made for: `packageManager: pnpm@X.Y.Z` (a `+sha…` suffix
 * taken off) from pnpm 12 on. pnpm 12 writes it into the lockfile's first document (the environment document,
 * `importers['.'].packageManagerDependencies.pnpm.specifier`), and `pnpm install --frozen-lockfile` exits 1 when that is
 * missing or another version (ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE). pnpm 11 and older write no such document
 * and do not ask for one; a range is not pinned (pnpm runs as it is). Undefined when nothing is required.
 */
export function pinnedPnpm(packageManager) {
  const m = typeof packageManager === 'string' ? /^pnpm@((\d+)\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+.*)?$/.exec(packageManager) : null
  return m && Number(m[2]) >= 12 ? m[1] : undefined
}

/**
 * Whether pnpm-lock.yaml covers package.json, read statically (no install): the root importer (`.`) lists each dependency,
 * devDependency and optionalDependency with package.json's specifier (or the workspace file's override for that name);
 * the lockfile's overrides are the workspace file's; and it was made for package.json's packageManager (pinnedPnpm).
 * Returns the misses.
 */
export function lockfileProblems(lockText, pkg, overrides = {}) {
  const importer = {}
  let lockOverrides
  let lockPnpm
  try {
    for (const doc of lockText.replace(/\r\n/g, '\n').split(/^---[ \t]*$/m)) {
      const lines = doc.split('\n')
      const section = (key) => {
        const i = lines.indexOf(`${key}:`)
        if (i < 0) return undefined
        let j = i + 1
        while (j < lines.length && (lines[j] === '' || /^\s/.test(lines[j]))) j++
        return parseYaml(lines.slice(i, j).join('\n'))[key]
      }
      const root = section('importers')?.['.']
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) if (isObject(root?.[field])) Object.assign(importer, root[field])
      const pm = root?.packageManagerDependencies?.pnpm
      if (lockPnpm === undefined && isObject(pm) && pm.specifier !== undefined && pm.specifier !== null) lockPnpm = String(pm.specifier)
      lockOverrides ??= section('overrides')
    }
  } catch (error) {
    return [`pnpm-lock.yaml does not parse: ${error.message}`]
  }
  const stale = []
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'])
    for (const [name, spec] of Object.entries(isObject(pkg[field]) ? pkg[field] : {})) {
      const locked = importer[name]?.specifier
      if (locked !== spec && !(Object.hasOwn(overrides, name) && locked === overrides[name])) stale.push(name)
    }
  const out = stale.length > 0 ? [`pnpm-lock.yaml does not cover ${stale.join(', ')} (the entry step makes it again, D-500)`] : []
  if (JSON.stringify(Object.entries(overrides ?? {}).sort()) !== JSON.stringify(Object.entries(lockOverrides ?? {}).sort())) out.push("pnpm-lock.yaml: its overrides are not pnpm-workspace.yaml's (the entry step makes it again, D-500)")
  const pnpm = pinnedPnpm(pkg.packageManager)
  if (pnpm !== undefined && lockPnpm !== pnpm)
    out.push(
      `pnpm-lock.yaml was not made for packageManager pnpm@${pnpm}: ${lockPnpm === undefined ? 'it has no environment document naming pnpm' : `its environment document names pnpm ${lockPnpm}`} ` +
        '(a frozen install exits 1, ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE; the entry step makes it again, D-500)',
    )
  return out
}

/** The miss when there is no lockfile; init's own run ends at it with exit 0, the entry step makes the lockfile next. */
export const NO_LOCKFILE = 'missing: pnpm-lock.yaml (the entry step makes it with pnpm install --lockfile-only, D-500)'

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

  // the entry standard's two kinds (D-499: a test-less repo enters with exactly these, and possibly more)
  for (const kind of Object.keys(TOOLS)) if (!kindNames.includes(kind)) misses.push(`checks.kinds.yml: no kind ${kind} (the entry has the lint and typecheck kinds, D-499)`)

  let scripts = {}
  let deps = {}
  let pkgValue
  if (need('package.json')) {
    const pkg = readJson(at('package.json'))
    if (pkg.error) misses.push(`package.json does not parse: ${pkg.error}`)
    else {
      pkgValue = pkg.value
      scripts = pkg.value.scripts ?? {}
      deps = { ...pkg.value.dependencies, ...pkg.value.devDependencies }
    }
  }

  let gateCommands
  if (need('gates.config.json')) {
    const config = readJson(at('gates.config.json'))
    if (config.error) misses.push(`gates.config.json does not parse: ${config.error}`)
    else if (config.value.stack !== 'vitest' && config.value.stack !== 'pytest') misses.push('gates.config.json: stack is not "vitest" or "pytest"')
    else gateCommands = isObject(config.value.gates) ? config.value.gates : {}
  }
  if (!deps['@dfox288/test-gates']) misses.push('package.json: devDependency @dfox288/test-gates is missing (scripts/gates.mjs runs test-gates)')
  if (!scripts.gates) misses.push('package.json: script "gates" is missing')
  // lint and typecheck run what their names say, all the way down: the kind's gate in gates.config.json, and the package.json
  // script that gate calls (`pnpm <script>`), run the kind's tool. A script that only exists (`lint: echo hi`) is a miss.
  for (const kind of Object.keys(TOOLS)) {
    const { runs, tool } = TOOLS[kind]
    for (const name of KIND_DEPENDENCIES[kind]) if (!deps[name]) misses.push(`package.json: dependency ${name} is missing (kind ${kind} runs it; the offline install has nothing else)`)
    if (typeof scripts[kind] !== 'string') misses.push(`package.json: script "${kind}" is missing (kind ${kind})`)
    else if (!commandsOf(scripts[kind]).some(runs)) misses.push(`package.json: script "${kind}" is "${scripts[kind]}", which does not run ${tool} (kind ${kind})`)
    if (gateCommands === undefined) continue
    const argv = gateCommands[kind]
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === 'string')) {
      misses.push(`gates.config.json: gate "${kind}" has no command (test-gates skips it, so kind ${kind} would run no gate)`)
      continue
    }
    const script = argv[0] === 'pnpm' ? (argv[1] === 'run' ? argv[2] : argv[1]) : undefined
    const viaScript = script !== undefined && argv.length === (argv[1] === 'run' ? 3 : 2) && typeof scripts[script] === 'string'
    const line = viaScript ? scripts[script] : argv.join(' ')
    if (!commandsOf(line).some(runs)) misses.push(`gates.config.json: gate "${kind}" runs "${argv.join(' ')}"${viaScript ? ` ("${line}")` : ''}, which does not run ${tool}`)
  }
  const eslintConfig = ESLINT_CONFIGS.find((f) => existsSync(at(f)))
  if (!eslintConfig) misses.push('missing: eslint.config.* (kind lint)')
  else if (readFileSync(at(eslintConfig), 'utf8').includes('@nuxt/eslint-config') && !deps['@nuxt/eslint-config']) misses.push(`package.json: dependency @nuxt/eslint-config is missing (${eslintConfig} imports it)`)

  // the install Current's dependency image runs: pnpm install --offline --frozen-lockfile, on the base's files
  let lockText
  if (existsSync(at('pnpm-lock.yaml'))) lockText = readFileSync(at('pnpm-lock.yaml'), 'utf8')
  let overrides = {}
  if (need('pnpm-workspace.yaml')) {
    const text = readFileSync(at('pnpm-workspace.yaml'), 'utf8')
    misses.push(...workspaceProblems(text, lockText).map((p) => p.miss))
    try {
      const ws = parseYaml(text)
      if (isObject(ws?.overrides)) overrides = ws.overrides
    } catch {
      // named by workspaceProblems
    }
  }
  if (lockText === undefined) misses.push(NO_LOCKFILE)
  else if (pkgValue) misses.push(...lockfileProblems(lockText, pkgValue, overrides))

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
  if (need('README.md') && !hasTestsSection(readFileSync(at('README.md'), 'utf8'))) misses.push(`README.md: no "${README_HEADING}" section`)
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
  // a kept pnpm-workspace.yaml must already decide the builds and hold the release age: init does not edit it
  // (no lockfile passed: the one there is made again after init, with init's devDependencies in it)
  if (existsSync(join(dir, 'pnpm-workspace.yaml')))
    for (const { miss, fix } of workspaceProblems(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')))
      conflicts.push(fix ? `${miss}; ${fix}` : miss)
  if (conflicts.length > 0) return { lines: [], conflicts }

  const lines = []
  const write = (path, content, verb = 'wrote') => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
    lines.push(`${verb} ${path}`)
  }

  for (const [path, name] of NEW_FILES) write(path, template(name))

  // package.json: scripts and devDependencies added after the ones there, nothing existing changed or moved; its
  // indentation, line endings and final newline kept
  const crlf = pkgText.includes('\r\n')
  const indent = /^\{\r?\n([ \t]+)"/.exec(pkgText)?.[1] ?? '  '
  pkg.scripts = { ...pkg.scripts }
  const added = []
  for (const [name, command] of Object.entries(SCRIPTS)) if (pkg.scripts[name] === undefined) (pkg.scripts[name] = command), added.push(`script ${name}`)
  const present = { ...pkg.dependencies, ...pkg.devDependencies }
  pkg.devDependencies = { ...pkg.devDependencies }
  // @nuxt/eslint-config only for the eslint.config.mjs init writes; a repo's own config brings what it imports
  const ownEslintConfig = ESLINT_CONFIGS.some((f) => existsSync(join(dir, f)))
  for (const [name, version] of Object.entries(DEV_DEPENDENCIES))
    if (present[name] === undefined && !(ownEslintConfig && name === '@nuxt/eslint-config')) (pkg.devDependencies[name] = version), added.push(name)
  if (pkg.packageManager === undefined) (pkg.packageManager = PACKAGE_MANAGER), added.push(`packageManager ${PACKAGE_MANAGER}`)
  if (pkg.engines?.node === undefined) (pkg.engines = { ...pkg.engines, node: NODE_ENGINE }), added.push(`engines.node ${NODE_ENGINE}`)
  const json = JSON.stringify(pkg, null, indent) + (/\n$/.test(pkgText) ? '\n' : '')
  writeFileSync(join(dir, 'package.json'), crlf ? json.replace(/\n/g, '\r\n') : json)
  lines.push(`updated package.json (${added.length ? 'added ' + added.join(', ') : 'nothing to add'})`)

  // a lint config, if the repo has none
  if (ownEslintConfig) lines.push('kept its own eslint.config.*')
  else write('eslint.config.mjs', template('eslint.config.mjs'))

  // pnpm 11 stops `pnpm install` on a dependency build script nobody decided on; a kept file was checked above
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) lines.push('kept its own pnpm-workspace.yaml')
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
    if (hasTestsSection(text)) lines.push('kept the Tests section of README.md')
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
  // its own check, on what it just wrote. The lockfile is the entry step's, next (D-500): init does not install, so a
  // missing or stale lockfile is the one miss its own run expects; --check stays red on it until the entry step made it.
  const misses = check(dir)
  const lockfile = (miss) => miss === NO_LOCKFILE || miss.startsWith('pnpm-lock.yaml')
  for (const miss of misses) if (!lockfile(miss)) console.error(`init: check: ${miss}`)
  if (misses.some((m) => !lockfile(m))) return 1
  if (misses.length > 0) console.log('next: pnpm-lock.yaml, made by the entry step (pnpm install --lockfile-only in Current\'s package container, D-500); then --check')
  return 0
}

if (process.argv[1] && import.meta.filename === process.argv[1]) process.exitCode = main(process.argv.slice(2))
