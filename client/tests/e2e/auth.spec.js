import { test, expect } from '@playwright/test'
import { createTestAccount } from './helpers.js'

test.describe('Auth', () => {
  test('login screen renders', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=Realm War').first()).toBeVisible()
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
    await page.click('button:has-text("Join the War")')
    await page.waitForTimeout(2500)

    // Should be on the map now
    await expect(page.locator('canvas')).toBeVisible()
    // FTUE guide should appear for new player
    await expect(page.locator('text=Claim your first territory')).toBeVisible({ timeout: 5000 })
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
    await expect(page.locator('canvas')).toBeVisible()
    await expect(page.locator('text=LOGIN / REGISTER')).toBeVisible()
  })

  test('invalid login shows error', async ({ page }) => {
    await page.goto('/')
    await page.fill('input[placeholder="Username"]', 'doesnotexist')
    await page.fill('input[placeholder="Password"]', 'wrongpass')
    await page.click('button:has-text("Enter the War")')
    await expect(page.locator('text=Invalid credentials')).toBeVisible({ timeout: 3000 })
  })
})
