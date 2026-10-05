import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Browser } from 'playwright'
import { startBuiltApp, type BuiltApp } from '@dfox288/test-preset-vitest/e2e'
import { launch, openPage, hitsInside, PHONE } from '@dfox288/test-preset-vitest/e2e/browser'

let app: BuiltApp
let browser: Browser

beforeAll(async () => {
  app = await startBuiltApp({ command: 'node', args: ['.output/server/index.mjs'] })
  browser = await launch()
})
afterAll(async () => {
  await browser?.close()
  await app?.stop()
})

it('serves the built api on 127.0.0.1', async () => {
  expect(app.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  const res = await fetch(`${app.origin}/api/ping`)
  expect(await res.json()).toEqual({ ok: true })
})

it('toggles the button on a phone', async () => {
  const page = await openPage(browser, app.origin, '/', { width: PHONE, hydration: 'nuxt' })
  expect(await hitsInside(page, '#toggle')).toBe(true)
  await page.click('#toggle')
  expect(await page.textContent('#toggle')).toBe('on')
  expect(page.consoleErrors).toEqual([])
  await page.context().close()
})
