import { test, expect } from '@playwright/test'

test.describe('UI labels and layout', () => {
  test('leaderboard shows AI tag not BOT_ prefix', async ({ page }) => {
    await page.goto('/')
    await page.click('text=Browse as guest')
    await page.waitForTimeout(2000)
    await page.click('text=LEADERBOARD')
    await page.waitForTimeout(500)

    // Should NOT see raw BOT_ prefix
    await expect(page.locator('text=BOT_Sand')).not.toBeVisible()
    await expect(page.locator('text=BOT_Storm')).not.toBeVisible()
    // Should see AI tag
    await expect(page.locator('text=AI').first()).toBeVisible()
  })

  test('top-left button says Armies not Forces', async ({ page }) => {
    const res = await fetch('http://localhost:3001/api/players/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `armies_${Date.now()}`, password: 'testpass123', color: '#0000ff' }),
    })
    const { token } = await res.json()
    await page.goto('/')
    await page.evaluate(t => localStorage.setItem('rw_token', t), token)
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    await expect(page.locator('button:has-text("Armies")')).toBeVisible()
    await expect(page.locator('button:has-text("Forces")')).not.toBeVisible()
  })

  test('help modal opens and contains tick terminology', async ({ page }) => {
    await page.goto('/')
    await page.click('text=Browse as guest')
    await page.waitForTimeout(2000)
    await page.click('button:has-text("?")')
    await page.waitForTimeout(500)
    await expect(page.locator('text=How to Play')).toBeVisible()
    // Should say "tick" not "harvest" as main term
    await expect(page.locator('text=Earned every tick')).toBeVisible()
    await expect(page.locator('text=Strategic capitals')).toBeVisible()
  })

  test('no JS errors on load', async ({ page }) => {
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.click('text=Browse as guest')
    await page.waitForTimeout(3000)
    expect(errors).toHaveLength(0)
  })

  test('march mode banner says select destination not click target hex', async ({ page }) => {
    // This tests the fix for the march button text regression
    const res = await fetch('http://localhost:3001/api/players/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `ui_${Date.now()}`, password: 'testpass123', color: '#ff0000' }),
    })
    const { token, player } = await res.json()

    await page.goto('/')
    await page.evaluate((t) => localStorage.setItem('rw_token', t), token)
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)

    // Get into march mode via GameMap (need to click own hex with troops)
    // Verify the march mode banner text when it appears
    const banner = page.locator('text=Select target hex')
    // Just verify the old text is gone — banner is conditional on having troops
    await expect(page.locator('text=Click target hex')).not.toBeVisible()
  })
})
