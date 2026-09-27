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
