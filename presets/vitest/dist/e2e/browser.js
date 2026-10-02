// The shared Playwright helper of the `e2e` project, one for every repo (it replaces the five
// `browser.ts` copies). It follows `bindings/nuxt-ts.md`, tool traps:
// - a phone is `hasTouch` without `isMobile` (`isMobile: true` reports innerWidth 449 for 402), and every
//   page asserts the innerWidth it got;
// - `waitUntil: 'networkidle'` never completes on a page with an open stream, so it waits for `load`;
// - `hitsInside` asks the browser what paints at a point, not whether the element exists;
// - `settle` waits for finite animations to end instead of a fixed timeout.
import { chromium } from 'playwright';
export const PHONE = 402;
export const DESKTOP = 1440;
/** `hostMap` maps names to loopback (`{ 'cove.localhost': '127.0.0.1' }`), so each app gets its own cookie jar. */
export function launch(options = {}) {
    const rules = Object.entries(options.hostMap ?? {}).map(([host, ip]) => `MAP ${host} ${ip}`);
    return chromium.launch({
        args: rules.length ? [`--host-resolver-rules=${rules.join(',')}`] : [],
    });
}
export async function openPage(browser, origin, path, { width = DESKTOP, theme = 'dark', cookies = [], initScript, hydration = false } = {}) {
    const phone = width <= 640;
    const ctx = await browser.newContext({
        viewport: { width, height: phone ? 874 : 900 },
        hasTouch: phone,
        deviceScaleFactor: phone ? 3 : 1,
        colorScheme: theme,
    });
    if (initScript)
        await ctx.addInitScript(initScript);
    if (cookies.length)
        await ctx.addCookies(cookies.map((c) => ({
            ...c,
            // CDP refuses a `secure` cookie for an `http:` URL; the https URL still sends it on http://*.localhost.
            url: c.secure ? origin.replace(/^http:/, 'https:') : origin,
            sameSite: 'Lax',
        })));
    const page = (await ctx.newPage());
    page.consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error')
            page.consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => page.consoleErrors.push(String(err)));
    await page.goto(origin + path, { waitUntil: 'load' });
    if (hydration === 'nuxt')
        await page.waitForFunction(() => window.useNuxtApp?.().isHydrating ===
            false);
    const got = await page.evaluate(() => window.innerWidth);
    if (got !== width)
        throw new Error(`asked for a ${width}px viewport, innerWidth is ${got}`);
    return page;
}
/** The element at the centre of the LAST match of `selector` belongs to it: nothing paints over it. */
export function hitsInside(page, selector) {
    return page.evaluate((sel) => {
        const all = document.querySelectorAll(sel);
        const el = all[all.length - 1];
        if (!el)
            return false;
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!at && el.contains(at);
    }, selector);
}
export function box(page, selector) {
    return page.evaluate((sel) => {
        const all = document.querySelectorAll(sel);
        const el = all[all.length - 1];
        if (!el)
            return null;
        const r = el.getBoundingClientRect();
        return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            bottom: r.bottom,
            vw: window.innerWidth,
            vh: window.innerHeight,
        };
    }, selector);
}
/** Waits until every FINITE animation on the page has ended. */
export async function settle(page) {
    await page.evaluate(() => Promise.all(document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished.catch(() => { }))));
}
