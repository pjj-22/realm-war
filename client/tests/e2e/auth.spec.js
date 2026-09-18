import { test, expect } from '@playwright/test'
import { createTestAccount } from './helpers.js'

test.describe('Auth', () => {
  test('login screen renders', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=HexNation').first()).toBeVisible()
    await expect(page.locator('input[placeholder="Username"]')).toBeVisible()
    await expect(page.locator('input[placeholder="Password"]')).toBeVisible()
    await expect(page.locator('text=Browse as guest')).toBeVisible()
  })

  test('register creates account and shows FTUE', async ({ page }) => {
    const username = `reg_${Date.now()}`
    await page.goto('/')
    await page.click('text=No account? Register')
    await page.fill('input[placeholder="Username"]', username)
    await page.fill('input[placeholder="Password"]', 'testpass123')
    await page.locator('input[type="checkbox"]').check()
    await page.click('button:has-text("Join the War")')
    await page.waitForTimeout(2500)

    // Should be on the map now
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
    // FTUE guide should appear for new player
    await expect(page.locator('text=Found your capital')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('button:has-text("Find me a good spot")')).toBeVisible()
  })

  test('login shows daily bonus toast', async ({ page }) => {
    const { username, password } = await createTestAccount()
    await page.goto('/')
    await page.fill('input[placeholder="Username"]', username)
    await page.fill('input[placeholder="Password"]', password)
    await page.click('button:has-text("Enter the War")')
    await page.waitForTimeout(2500)

    // Daily bonus should fire on first login
    await expect(page.locator('text=Daily bonus')).toBeVisible({ timeout: 5000 })
  })

  test('browse as guest skips login and shows map', async ({ page }) => {
    await page.goto('/')
    await page.click('text=Browse as guest')
    await page.waitForTimeout(2000)
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
    await expect(page.locator('text=LOGIN / REGISTER')).toBeVisible()
  })

  test('invalid login shows error', async ({ page }) => {
    await page.goto('/')
    await page.fill('input[placeholder="Username"]', 'doesnotexist')
    await page.fill('input[placeholder="Password"]', 'wrongpass')
    await page.click('button:has-text("Enter the War")')
    // Toasts auto-dismiss after ~4s, so wait generously but start waiting
    // immediately - a fixed sleep before the assert is what made this flaky
    // under CI load (see git history).
    await expect(page.locator('text=Invalid credentials')).toBeVisible({ timeout: 10000 })
  })

  test('log out clears the session and returns to login, without deleting the account', async ({ page }) => {
    const { username, password } = await createTestAccount()
    await page.goto('/')
    await page.fill('input[placeholder="Username"]', username)
    await page.fill('input[placeholder="Password"]', password)
    await page.click('button:has-text("Enter the War")')
    await page.waitForTimeout(2500)

    await page.click('button[title="Account & privacy"]')
    await page.click('button:has-text("Log out")')
    await page.waitForTimeout(800)

    await expect(page.locator('text=Browse as guest')).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('rw_token'))).toBeNull()

    // The account itself must still exist - logout is not delete.
    const res = await fetch('http://localhost:3001/api/players/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    expect(res.status).toBe(200)
  })
})
