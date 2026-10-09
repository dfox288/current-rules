// The shape test of `checks.map.yml` version 2, the same in every repo. A repo's whole test file is one line:
//
//   import '@dfox288/test-preset-vitest/checks-map-test'
//
// Importing it registers the test. Vitest's static scan (`vitest list`, which the gate's medium tier uses) reads a file's
// own source and finds no test behind an import, so the preset's plugin (`defineTestConfig`) expands a test file that is
// only this import into the three lines below before any tool reads it (`plugin.ts`). Small: untagged.
import { it } from 'vitest';
import { checksMapTest } from './checks-map-body.js';
it('checks.map.yml has the shape of version 2 (selection.md)', checksMapTest);
