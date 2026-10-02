import { type Browser, type Page } from 'playwright';
export declare const PHONE = 402;
export declare const DESKTOP = 1440;
export type ThemedPage = Page & {
    consoleErrors: string[];
};
/** `hostMap` maps names to loopback (`{ 'cove.localhost': '127.0.0.1' }`), so each app gets its own cookie jar. */
export declare function launch(options?: {
    hostMap?: Record<string, string>;
}): Promise<Browser>;
export interface OpenPageOptions {
    width?: number;
    theme?: 'dark' | 'light';
    /** Cookies to put in the jar before the first request (`name=value`, with `secure` for `__Host-`). */
    cookies?: {
        name: string;
        value: string;
        secure?: boolean;
        httpOnly?: boolean;
    }[];
    /** A script run before any page script. */
    initScript?: () => void;
    /** `'nuxt'` waits until Nuxt has finished hydrating (`useNuxtApp().isHydrating === false`). */
    hydration?: 'nuxt' | false;
}
export declare function openPage(browser: Browser, origin: string, path: string, { width, theme, cookies, initScript, hydration }?: OpenPageOptions): Promise<ThemedPage>;
/** The element at the centre of the LAST match of `selector` belongs to it: nothing paints over it. */
export declare function hitsInside(page: Page, selector: string): Promise<boolean>;
export declare function box(page: Page, selector: string): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    bottom: number;
    vw: number;
    vh: number;
} | null>;
/** Waits until every FINITE animation on the page has ended. */
export declare function settle(page: Page): Promise<void>;
