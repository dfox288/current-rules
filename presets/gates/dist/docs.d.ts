export interface DocsConfig {
    /** The base ref of the diff (default `origin/main`; `--base` wins). */
    base?: string;
    /** Doc globs besides the defaults (`README.md`, `docs/**\/*.md`, `CLAUDE.md`). */
    globs?: string[];
    /** Names that may stay in the docs: a path or name, exact, or a prefix when it ends in `*`. */
    ignore?: string[];
}
export declare const DEFAULT_DOC_GLOBS: string[];
export interface DocsOptions {
    base?: string;
    all?: boolean;
}
/** One name the diff took away: a path (file or directory) or a script, with where it went if known. */
export interface Removed {
    kind: 'path' | 'script';
    name: string;
    /** For a script: the runner the docs would name it with. */
    runners?: string[];
    renamedTo?: string;
}
export interface DocHit {
    file: string;
    line: number;
    text: string;
}
export declare function globToRegExp(glob: string): RegExp;
/** Backtick spans and link targets of one doc line. */
export declare function spansOf(line: string): {
    text: string;
    link: boolean;
}[];
/** Does one doc span name something removed? Returns the removed entry it names. */
export declare function spanHits(span: string, docFile: string, removed: Removed[]): Removed | undefined;
/** Scans doc text for spans that name a removed thing. Fences count: a command in a code block is named too. */
export declare function scanText(file: string, text: string, removed: Removed[], ignore?: string[]): DocHit[];
/** Every backticked or linked path that is in no place of the tree. */
export declare function scanMissing(file: string, text: string, exists: (path: string) => boolean, ignore?: string[]): DocHit[];
/** Scripts of a package.json text (`{}` when it does not parse). */
export declare function packageScripts(text: string | undefined): Record<string, string>;
/** `[project.scripts]` of a pyproject.toml text: name -> target. */
export declare function pyprojectScripts(text: string | undefined): Record<string, string>;
/** Names present in `before` and not in `after`; one that kept its value under another name is a rename. */
export declare function removedScripts(before: Record<string, string>, after: Record<string, string>, py: boolean): Removed[];
/** Everything removed or renamed between `base` (merge base with HEAD) and HEAD. */
export declare function removedByDiff(root: string, base: string): Removed[];
export interface DocsResult {
    ok: boolean;
    mode: 'diff' | 'all';
    hits: DocHit[];
    detail: string;
}
export declare function runDocsGate(root: string, config?: DocsConfig, options?: DocsOptions): DocsResult;
