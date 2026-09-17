// In-memory rate limiter (server/ratelimit.js): bucket keying and the
// over-limit response. Keying is the part that has bitten prod - behind
// cloudflared + nginx, req.ip was the tunnel's address for every request,
// so all players shared one bucket until CLIENT_IP_HEADER existed.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { rateLimit, clientIp } from '../ratelimit.js'

function fakeReq(ip, headers = {}) {
  return { ip, headers, socket: { remoteAddress: ip } }
}

function fakeRes() {
  const res = { statusCode: 200, body: null }
  res.status = code => { res.statusCode = code; return res }
  res.json = body => { res.body = body; return res }
  return res
}

// Runs the middleware once and reports whether it called next().
function hit(limiter, req) {
  let passed = false
  const res = fakeRes()
  limiter(req, res, () => { passed = true })
  return { passed, res }
}

afterEach(() => { delete process.env.CLIENT_IP_HEADER })

test('allows max requests in a window, then answers 429 with the message', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 3, message: 'nope' })
  const req = fakeReq('10.0.0.1')
  for (let i = 0; i < 3; i++) assert.equal(hit(limiter, req).passed, true, `request ${i + 1} should pass`)
  const { passed, res } = hit(limiter, req)
  assert.equal(passed, false)
  assert.equal(res.statusCode, 429)
  assert.deepEqual(res.body, { error: 'nope' })
})

test('buckets are per client - one client hitting the limit does not block another', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1 })
  assert.equal(hit(limiter, fakeReq('10.0.0.2')).passed, true)
  assert.equal(hit(limiter, fakeReq('10.0.0.2')).passed, false)
  assert.equal(hit(limiter, fakeReq('10.0.0.3')).passed, true)
})

test('clientIp falls back to req.ip when CLIENT_IP_HEADER is unset', () => {
  assert.equal(clientIp(fakeReq('10.0.0.4', { 'cf-connecting-ip': '203.0.113.9' })), '10.0.0.4')
})

test('clientIp reads CLIENT_IP_HEADER when set, case-insensitively, and ignores x-forwarded-for', () => {
  process.env.CLIENT_IP_HEADER = 'CF-Connecting-IP'
  const req = fakeReq('172.18.0.1', { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1, 172.18.0.1' })
  assert.equal(clientIp(req), '203.0.113.9')
})

test('with CLIENT_IP_HEADER set, two players behind the same proxy address get separate buckets', () => {
  process.env.CLIENT_IP_HEADER = 'cf-connecting-ip'
  const limiter = rateLimit({ windowMs: 60_000, max: 1 })
  const proxyAddr = '172.18.0.1'
  assert.equal(hit(limiter, fakeReq(proxyAddr, { 'cf-connecting-ip': '203.0.113.10' })).passed, true)
  assert.equal(hit(limiter, fakeReq(proxyAddr, { 'cf-connecting-ip': '203.0.113.10' })).passed, false)
  assert.equal(hit(limiter, fakeReq(proxyAddr, { 'cf-connecting-ip': '203.0.113.11' })).passed, true)
})

test('a custom key function overrides client keying', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1, key: req => `user:${req.userId}` })
  assert.equal(hit(limiter, { ...fakeReq('10.0.0.5'), userId: 1 }).passed, true)
  assert.equal(hit(limiter, { ...fakeReq('10.0.0.6'), userId: 1 }).passed, false, 'same user from another address shares the bucket')
})
