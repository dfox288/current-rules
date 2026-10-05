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
    /** A `git diff --name-status -M` style list (`R<score>\told\tnew`, `D\tpath`, `M\tpath`): the gate then needs no git history. */
    changes?: string;
}
/** The gate could not measure: reported red, never green and never another rule. */
export declare class NotMeasured extends Error {
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
export declare function scanText(file: string, text: string, removed: Removed[], ignore?: string[], self?: string): DocHit[];
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
/**
 * Removed and renamed paths from a name-status list, no history needed. A directory is gone when nothing of it is left
 * in the work tree. Scripts cannot be told from a name list (the old package.json is not in it): only paths here.
 */
export declare function removedByChanges(root: string, file: string): Removed[];
export interface DocsResult {
    ok: boolean;
    mode: 'diff' | 'all';
    hits: DocHit[];
    detail: string;
}
export declare function runDocsGate(root: string, config?: DocsConfig, options?: DocsOptions): DocsResult;
