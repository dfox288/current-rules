// Small's touch rules, enforced for every test of `unit` and `nuxt` (`bindings/nuxt-ts.md`):
// - an outgoing network connection fails the test (a `medium` test may reach loopback and the test
//   database's host);
// - a write outside the OS temp dir fails the test (a `medium` test may write files);
// - `TEST_DATABASE_URL` is empty, so the DB helper throws (a `medium` test gets the real value).
// Sleep and server boot are not guarded: the reviewer checks them.
// A guard is only active inside a test (beforeEach to afterEach), never while modules load.
import dgram from 'node:dgram';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach } from 'vitest';
import { DATABASE_ENV } from '../constants.js';
let mode = 'off';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
function databaseHost() {
    const url = realDatabaseUrl;
    if (!url)
        return undefined;
    try {
        return new URL(url).hostname;
    }
    catch {
        return undefined;
    }
}
function allowedHost(host) {
    if (mode === 'small')
        return false;
    if (!host)
        return false;
    return LOOPBACK.has(host) || host === databaseHost();
}
const refuse = (what) => {
    throw new Error(mode === 'small'
        ? `tests of the small tier never touch the network (${what}); tag the test "medium" if it needs localhost or the test database`
        : `tests of the medium tier reach only localhost and the test database (${what})`);
};
// ---- network ----
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
    if (mode !== 'off') {
        const raw = input instanceof Request ? input.url : String(input);
        let host;
        try {
            const url = new URL(raw);
            if (url.protocol === 'data:' || url.protocol === 'blob:')
                return realFetch(input, init);
            host = url.hostname;
        }
        catch {
            host = undefined;
        }
        if (!allowedHost(host))
            refuse(`fetch ${raw}`);
    }
    return realFetch(input, init);
});
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    if (mode !== 'off') {
        // `net.connect(port, host)` reaches here as `[[options, callback]]` (Node's normalized form).
        const first = Array.isArray(args[0]) ? args[0][0] : args[0];
        let host;
        let target;
        if (first && typeof first === 'object') {
            const o = first;
            host = o.path ? undefined : (o.host ?? 'localhost');
            target = o.path ?? `${host}:${o.port}`;
        }
        else if (typeof first === 'number') {
            host = typeof args[1] === 'string' ? args[1] : 'localhost';
            target = `${host}:${first}`;
        }
        else {
            host = undefined;
            target = String(first);
        }
        if (!allowedHost(host))
            refuse(`connect ${target}`);
    }
    return realConnect.apply(this, args);
};
// UDP: `send` and `connect` of a datagram socket (`bind` and `listen` alike are boot, not reach).
function guardDgram(name) {
    const original = dgram.Socket.prototype[name];
    dgram.Socket.prototype[name] = function (...args) {
        if (mode !== 'off') {
            // send(msg, [offset, length,] port, [address], [cb]) and connect(port, [address], [cb])
            const params = args.filter((a) => typeof a !== 'function').slice(name === 'send' ? 1 : 0);
            const address = params.find((a) => typeof a === 'string');
            const port = [...params].reverse().find((a) => typeof a === 'number');
            if (!allowedHost(address ?? 'localhost'))
                refuse(`udp ${name} ${address ?? 'localhost'}:${port}`);
        }
        return original.apply(this, args);
    };
}
guardDgram('send');
guardDgram('connect');
// ---- files ----
const tmpRoots = (() => {
    const raw = path.resolve(os.tmpdir());
    const roots = new Set([raw, '/dev/null']);
    try {
        roots.add(fs.realpathSync(raw));
    }
    catch {
        /* the temp dir exists on every supported host */
    }
    return [...roots];
})();
const toPath = (p) => {
    if (typeof p === 'string')
        return path.resolve(p);
    if (p instanceof URL)
        return fileURLToPath(p);
    if (Buffer.isBuffer(p))
        return path.resolve(p.toString());
    return undefined; // a file descriptor: opened earlier, already checked then
};
function inside(p) {
    const candidates = [p];
    try {
        candidates.push(path.join(fs.realpathSync(path.dirname(p)), path.basename(p)));
    }
    catch {
        /* the parent does not exist yet: judged by the plain path */
    }
    return candidates.every((c) => tmpRoots.some((r) => c === r || c.startsWith(r + path.sep)));
}
function checkWrite(fn, target) {
    if (mode !== 'small')
        return;
    const p = toPath(target);
    if (p !== undefined && !inside(p))
        throw new Error(`tests of the small tier write only inside the temp dir (${fn} ${p}); use os.tmpdir() or tag the test "medium"`);
}
const WRITES_FIRST_ARG = [
    'writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'unlink', 'truncate', 'utimes', 'chmod',
    'chown', 'mkdtemp', 'createWriteStream', 'rename', 'copyFile', 'cp', 'symlink', 'link',
];
// Operations whose second path is written too (the first is only read for these).
const WRITES_SECOND_ARG = ['rename', 'copyFile', 'cp', 'symlink', 'link'];
const opensForWrite = (flags) => typeof flags === 'string' ? /[wa+]/.test(flags) : typeof flags === 'number' ? (flags & 3) !== 0 : false;
function wrap(target, name, indexes) {
    const original = target[name];
    if (typeof original !== 'function')
        return;
    target[name] = function (...args) {
        for (const i of indexes)
            checkWrite(name, args[i]);
        return original.apply(this, args);
    };
}
for (const holder of [fs, fs.promises]) {
    for (const name of WRITES_FIRST_ARG) {
        const dest = WRITES_SECOND_ARG.includes(name);
        // rename/copy/link move or copy *to* arg 1; rename and unlink also remove arg 0
        const indexes = name === 'rename' ? [0, 1] : dest ? [1] : [0];
        wrap(holder, name, indexes);
        if (holder === fs)
            wrap(holder, `${name}Sync`, indexes);
    }
    for (const name of ['open', ...(holder === fs ? ['openSync'] : [])]) {
        const original = holder[name];
        if (typeof original !== 'function')
            continue;
        holder[name] = function (...args) {
            if (opensForWrite(args[1]))
                checkWrite(name, args[0]);
            return original.apply(this, args);
        };
    }
}
syncBuiltinESMExports();
// ---- database ----
let realDatabaseUrl;
beforeEach(({ task }) => {
    mode = task.tags?.includes('medium') ? 'medium' : 'small';
    realDatabaseUrl = process.env[DATABASE_ENV];
    if (mode === 'small')
        process.env[DATABASE_ENV] = '';
});
// Hooks of `afterEach` run in the order they were registered or reversed, by `sequence.hooks`; the
// guard is lifted in the last of them either way, because a test's own cleanup may write.
afterEach(() => {
    mode = 'off';
    if (realDatabaseUrl === undefined)
        delete process.env[DATABASE_ENV];
    else
        process.env[DATABASE_ENV] = realDatabaseUrl;
});
