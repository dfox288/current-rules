# Trait: `landfall-ui`

Your repo uses the `@landfall/ui` layer. The layer's own contract (its parts, their props, its naming rules) is its
README at the version your repo pins: read `node_modules/@landfall/ui/README.md` before building UI. This trait
only says how your repo uses the layer.

## Rules

- **[contract item]** Markup goes through a layer part wherever one exists for what you're building. Raw
  components or hand-built markup where a part covers the case is a bypass. *Check: the reviewer reads new markup
  against the parts the README lists.*
- **[contract item]** Never restyle a part from outside it (no overriding its internal classes, no wrapping CSS
  that changes its look). The layer owns how parts look; your repo owns data, layout and behaviour. *Check: the
  reviewer reads CSS and class changes that touch a part.*
- **[rule]** A part that doesn't fit is a layer gap, not a licence to bypass silently: say so in the PR under
  `## Layer gap` (what you needed, what the part does, what you did). *Check: the reviewer requires the heading
  when the diff has a bypass.*

## Using and adopting a part

- **[contract item]** Before you use or swap in a part, read its source
  (`node_modules/@dfox288/landfall-ui/app/components/l/<Name>.vue`), not just its props, and write down what it
  renders: the root element and role (a tile that was a `div` may now be a `button` or `a`), the fixed structure
  (slot layout, slot fallbacks, a fragment root), the icon name space, who owns the safe-area insets (a layout that
  also pads them doubles them), what falls through to the root (`class`, `style`, `data-*`, `aria-*`, test IDs; a part
  with `inheritAttrs: false` forwards them to one inner element), and any guard your old component had that the part
  lacks (for example ignoring Enter while an IME composes). A slot can replace a prop rather than add to it: a
  section with a prop note and a hand-built one needs both in the slot. *Check: the reviewer reads the report for what
  the part renders, and the diff for a part used against its rendered root.*
- **[contract item]** No hand-built contract markup where a part exists: a `.b-*` class written into your own template
  is a bypass, and adoption debt where a part covers it. It is allowed only where no part exists. Never restyle a
  `.b-*` class or override a `--b-*` token in your CSS, and never edit the installed layer. An app-specific variant
  is a thin wrapper component that renders the part, not a copy of it. *Check: the reviewer greps the diff for `.b-*`
  in templates and CSS.*
- **[rule]** Outside utility classes, colours and sizes come from `var(--b-*)` tokens: `@theme inline` emits no
  `--color-*` custom properties, so `var(--color-realm-…)` in a style resolves to nothing. Size an icon in px on the
  icon itself (the icon is a `span`; `rem` shrinks under the apps' small root size). A utility class on a part's root
  outranks the contract's `@layer components`, so don't put one there that sets what the contract owns (padding,
  background, radius, font size, height, border). A scoped style doesn't reach a NuxtUI root a part wraps (the
  parent's `data-v` attribute isn't on it); use an unscoped class or an inline style. *Check: the reviewer reads new
  styles that touch a part against this list.*
- **[rule]** Where the repo's Vitest doesn't resolve Nuxt components, `L*` parts don't render: stub each per test, and
  import the app's own wrappers explicitly (an auto-imported wrapper renders nothing). Assert what the user gets (role,
  accessible name, text, the attribute the contract paints such as `data-selected`, `aria-current`, `data-tone`),
  not the class list. You have no browser: say in the PR which screens render differently, so the review can check
  them. *Check: the reviewer reads the new tests for assertions on role, name and state.*
- **[rule]** A gap report under `## Layer gap` gives: the part and its version; what you needed, with a `file:line`;
  what you measured; and whether you think the fix is layer-side (a prop, a slot, rendering) or needs the design
  source (a new state, class or geometry in the contract). Keep the case on your own markup with a comment naming the
  gap as its removal condition. *Check: the reviewer requires each of the four in the heading.*
- **[rule]** Before you call a part missing a feature, check it against the installed version: read the part's source
  and the changelog, since the feature may already have shipped. *Check: the reviewer compares a claimed gap with the
  installed part.*

## A layer repin job

A job whose spec names a layer version (`package: @dfox288/landfall-ui@X.Y.Z`, or `@dfox288/landfall-server`) is a
repin. Current's packages step has already moved the dependency line in `package.json` and the lockfile to that exact
version, in its own commit, before you start, and you have no network. The package was `@landfall/ui` (a git tag)
until 0.32.0; `@dfox288/landfall-ui` is the same layer on the private registry. Your job is what the release changed
in the app.

- **[contract item]** Don't touch the dependency line, the lockfile or the registry settings, and don't run
  `pnpm add`, `install` or `update`. Confirm the install instead: the installed version
  (`node -e "console.log(require('@dfox288/landfall-ui/package.json').version)"`) equals the spec's version and
  `package.json` holds it exactly, no range. If they differ, stop and report. *Check: the reviewer reads the diff
  for a touched dependency line or lockfile, and the report for the confirmed version.*
- **[rule]** Read the layer's changelog for every version you cross, not only the newest:
  `node_modules/@dfox288/landfall-ui/CHANGELOG.md`, every `## X.Y.Z` section above the version the repo pinned before
  (the packages commit's diff of `package.json` shows it). Note each **Breaking** entry and each **Apps:** and
  **Browser:** line, and copy the **Browser:** lines into the PR description for the review. *Check: the reviewer
  compares the PR's list of versions with the changelog's sections.*
- **[contract item]** Before you change anything, scan the app for every name the changelog renamed or removed
  (components, props, attributes, CSS classes, storage keys). Cover templates, scripts, `querySelector` and attribute
  strings, CSS, tests and test stubs, and any tooling config; leave out `node_modules`, `.nuxt`, `.output` and `.git`.
  Each scan has a control that fires through the same command: the name in the layer's own source under
  `node_modules`, or in the repo's base commit. Report each count with its control. *Check: the reviewer requires a
  count and a fired control per renamed or removed name.*
- **[rule]** Migrate only what the release renamed or removed, and migrate all of it, including the readers a first
  scan misses (a renamed attribute still read in a selector string). When a part is involved, follow the part rules
  above. A gap is a `## Layer gap`, not a workaround. *Check: the reviewer compares the diff with the scan list for
  unrelated changes and for leftovers.*
- **[rule]** A repin that changes what the app shows or does (a **Browser:** line other than `none`, a migrated name,
  a fixed behaviour) gets an entry under `## Unreleased`; one with no visible effect carries
  `Changelog: none (<why>)` in its commit message. `README.md` and `docs/features.md` change only where they name the
  old version or behaviour. *Check: the reviewer reads the commit range.*
