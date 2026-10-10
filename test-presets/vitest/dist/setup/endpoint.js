// Which fetch @nuxt/test-utils answers in-process. In its `nuxt` environment `registerEndpoint(url, handler)` adds `url` to
// `window.__registry`, and the environment's `fetch` serves a *relative* URL that is in that set from an h3 app, with no
// socket. Anything else it hands to the real fetch, which opens a connection: an absolute URL (the page's own origin
// included), a protocol-relative one, an unregistered path.
export function answeredInProcess(raw, registry) {
    if (!registry || registry.size === 0)
        return false;
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\'))
        return false;
    return registry.has(raw.split('?')[0]) || registry.has(raw);
}
