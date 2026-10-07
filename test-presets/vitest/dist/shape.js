// The shape-compare helper (`testing.md`, outside-service fakes): a fake's answer is compared with a recorded real
// answer by shape, never by value. Shape means: the kind of each value (null, boolean, number, string, array,
// object), the keys of each object, and the shape of an array's elements. Strings and numbers may differ, keys
// and kinds may not. A recording is a JSON file holding one real answer; `recordAnswer` writes it and is the only
// thing here that writes, so a re-record is an explicit command a repo wires to its own script.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
function kindOf(value, path) {
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return 'array';
    switch (typeof value) {
        case 'boolean':
            return 'boolean';
        case 'number':
            return 'number';
        case 'string':
            return 'string';
        case 'object':
            return 'object';
        default:
            throw new TypeError(`${path}: a ${typeof value} is not JSON data`);
    }
}
function shapeOf(value, path) {
    const kind = kindOf(value, path);
    const shape = { kinds: new Set([kind]) };
    if (kind === 'object') {
        shape.keys = new Map();
        for (const [key, child] of Object.entries(value)) {
            if (child === undefined)
                continue;
            shape.keys.set(key, { shape: shapeOf(child, `${path}.${key}`), optional: false });
        }
    }
    if (kind === 'array') {
        ;
        value.forEach((child, i) => {
            const next = shapeOf(child, `${path}[${i}]`);
            shape.items = shape.items ? merge(shape.items, next) : next;
        });
    }
    return shape;
}
function merge(a, b) {
    const merged = { kinds: new Set([...a.kinds, ...b.kinds]) };
    if (a.keys || b.keys) {
        merged.keys = new Map();
        for (const key of new Set([...(a.keys?.keys() ?? []), ...(b.keys?.keys() ?? [])])) {
            const left = a.keys?.get(key);
            const right = b.keys?.get(key);
            merged.keys.set(key, {
                shape: left && right ? merge(left.shape, right.shape) : (left ?? right).shape,
                // A key missing from one side, or optional on either, is optional.
                optional: !left || !right || left.optional || right.optional,
            });
        }
    }
    if (a.items || b.items)
        merged.items = a.items && b.items ? merge(a.items, b.items) : (a.items ?? b.items);
    return merged;
}
function check(actual, shape, path, out) {
    let kind;
    try {
        kind = kindOf(actual, path);
    }
    catch {
        out.push(`${path}: got a ${typeof actual}, which is not JSON data`);
        return;
    }
    if (!shape.kinds.has(kind)) {
        out.push(`${path}: expected ${[...shape.kinds].join(' | ')}, got ${kind}`);
        return;
    }
    if (kind === 'object' && shape.keys) {
        const object = actual;
        for (const key of Object.keys(object)) {
            if (object[key] !== undefined && !shape.keys.has(key))
                out.push(`${path}.${key}: key is not in the recorded answer`);
        }
        for (const [key, entry] of shape.keys) {
            if (object[key] === undefined) {
                if (!entry.optional)
                    out.push(`${path}.${key}: key is missing`);
                continue;
            }
            check(object[key], entry.shape, `${path}.${key}`, out);
        }
    }
    if (kind === 'array' && shape.items) {
        ;
        actual.forEach((child, i) => check(child, shape.items, `${path}[${i}]`, out));
    }
}
/**
 * The differences between a fake's answer and a recorded real answer, one line each, as `path: what`. The
 * root path is `$`. An empty list means the shapes match. A recorded array stands for any number of elements
 * of the shape all its elements share (an empty recorded array accepts any element); a key some recorded
 * elements lack is optional.
 */
export function shapeDiff(actual, recorded) {
    const out = [];
    check(actual, shapeOf(recorded, '$'), '$', out);
    return out;
}
/** Reads a recorded answer written by `recordAnswer`. Throws, naming the file, when it does not exist. */
export function loadAnswer(file) {
    let text;
    try {
        text = readFileSync(file, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            throw new Error(`no recorded answer at ${file}: record it on purpose with recordAnswer (your repo's record command)`);
        throw error;
    }
    return JSON.parse(text);
}
/** Throws, listing every difference, unless `actual` has the shape of the answer recorded in `file`. */
export function expectShape(actual, file) {
    const diffs = shapeDiff(actual, loadAnswer(file));
    if (diffs.length)
        throw new Error(`the answer differs in shape from the recording ${file}:\n${diffs.map((d) => `  ${d}`).join('\n')}\n` +
            `If the real service changed, re-record on purpose (your repo's record command) and update the fake.`);
}
/**
 * Writes a real answer as the recording. Call it only from a command that talks to the real service and is run on
 * purpose; a test run never calls it. Rejects what JSON cannot hold.
 */
export function recordAnswer(file, answer) {
    shapeOf(answer, '$');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(answer, null, 2)}\n`);
}
