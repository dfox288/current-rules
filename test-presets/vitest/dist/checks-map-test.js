// The shape test of `checks.map.yml` version 2, the same in every repo. A repo's whole test file is one line:
//
//   import '@dfox288/test-preset-vitest/checks-map-test'
//
// It registers its tests when imported. Small: it reads the checked-in files and asks git which are tracked.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { checksMapProblems, readRepoFiles } from './checks-map.js';
// the map sits in the repo's root; a Vitest project may run from a folder below it (lookout's `web/`)
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const files = readRepoFiles(root);
describe('checks.map.yml (selection.md, version 2)', () => {
    it('lists tracked files and finds both files (control: an empty list would fail every glob for the wrong reason)', () => {
        expect(files.tracked).toContain('checks.map.yml');
        expect(files.tracked).toContain('checks.kinds.yml');
    });
    it('has the shape of version 2', () => {
        expect(checksMapProblems(files)).toEqual([]);
    });
});
