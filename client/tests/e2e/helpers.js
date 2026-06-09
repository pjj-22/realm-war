import { expect } from '@playwright/test'

const API = 'http://localhost:3001/api'

// Create a fresh test account and return credentials
export async function createTestAccount() {
  const username = `test_${Date.now()}`
  const res = await fetch(`${API}/players/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'testpass123', color: '#ff6600' }),
  })
  if (!res.ok) throw new Error(`Register failed: ${await res.text()}`)
  const data = await res.json()
  return { username, password: 'testpass123', token: data.token, player: data.player }
}

// Delete a test account by username (cleanup)
export async function deleteTestAccount(token) {
  // No delete endpoint - just leave orphaned test accounts, they don't affect gameplay
}

// Login via UI and wait for map to be ready
export async function loginViaUI(page, username, password) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.fill('input[placeholder="Username"]', username)
  await page.fill('input[placeholder="Password"]', password)
  await page.click('button:has-text("Enter the War")')
  await page.waitForTimeout(2500)
}

// Zoom in to the hex grid
export async function zoomToHexGrid(page, steps = 12) {
  await page.mouse.move(720, 450)
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, -300)
    await page.waitForTimeout(100)
  }
  await page.waitForTimeout(2000)
}

// Click a hex on the canvas at a given position
export async function clickHex(page, x = 720, y = 450) {
  await page.click('canvas', { position: { x, y } })
  await page.waitForTimeout(800)
}

// Wait for a toast message
export async function expectToast(page, text) {
  await expect(page.locator(`text=${text}`)).toBeVisible({ timeout: 5000 })
}
