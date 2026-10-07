/**
 * The differences between a fake's answer and a recorded real answer, one line each, as `path: what`. The
 * root path is `$`. An empty list means the shapes match. A recorded array stands for any number of elements
 * of the shape all its elements share (an empty recorded array accepts any element); a key some recorded
 * elements lack is optional.
 */
export declare function shapeDiff(actual: unknown, recorded: unknown): string[];
/** Reads a recorded answer written by `recordAnswer`. Throws, naming the file, when it does not exist. */
export declare function loadAnswer(file: string): unknown;
/** Throws, listing every difference, unless `actual` has the shape of the answer recorded in `file`. */
export declare function expectShape(actual: unknown, file: string): void;
/**
 * Writes a real answer as the recording. Call it only from a command that talks to the real service and is run on
 * purpose; a test run never calls it. Rejects what JSON cannot hold.
 */
export declare function recordAnswer(file: string, answer: unknown): void;
