// server/logger.js: level filtering, LOG_LEVEL/MODE resolution, and the
// line format the rest of the codebase now relies on (routes/players.js's
// login/registration events, ratelimit.js's trip warnings, etc.).
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// logger.js reads LOG_LEVEL/MODE once at import time, so each test that
// needs a specific level imports it fresh with a cache-busting query param -
// the standard ESM trick for re-running module-level init under node:test.
async function freshLogger() {
  return import(`../logger.js?t=${Date.now()}-${Math.random()}`)
}

function captureConsole() {
  const calls = { log: [], error: [] }
  const origLog = console.log
  const origError = console.error
  console.log = (...args) => calls.log.push(args.join(' '))
  console.error = (...args) => calls.error.push(args.join(' '))
  return { calls, restore: () => { console.log = origLog; console.error = origError } }
}

afterEach(() => {
  delete process.env.LOG_LEVEL
  delete process.env.MODE
})

test('LOG_LEVEL unset follows MODE - info in prod, debug otherwise', async () => {
  process.env.MODE = 'prod'
  assert.equal((await freshLogger()).currentLogLevel(), 'info')
  process.env.MODE = 'dev'
  assert.equal((await freshLogger()).currentLogLevel(), 'debug')
  delete process.env.MODE
  assert.equal((await freshLogger()).currentLogLevel(), 'debug')
})

test('LOG_LEVEL overrides MODE when set to a valid level, case-insensitively', async () => {
  process.env.MODE = 'prod'
  process.env.LOG_LEVEL = 'DEBUG'
  assert.equal((await freshLogger()).currentLogLevel(), 'debug')
})

test('an invalid LOG_LEVEL falls back to the MODE default', async () => {
  process.env.MODE = 'prod'
  process.env.LOG_LEVEL = 'verbose'
  assert.equal((await freshLogger()).currentLogLevel(), 'info')
})

test('debug is filtered out at the info threshold; info/warn/error pass', async () => {
  process.env.LOG_LEVEL = 'info'
  const { createLogger } = await freshLogger()
  const log = createLogger('test')
  const { calls, restore } = captureConsole()
  try {
    log.debug('should not appear')
    log.info('info line')
    log.warn('warn line')
    log.error('error line')
  } finally { restore() }
  assert.equal(calls.log.length, 1) // info only (debug filtered)
  assert.match(calls.log[0], /INFO {2}\[test\] info line/)
  assert.equal(calls.error.length, 2) // warn + error both go to stderr
  assert.match(calls.error[0], /WARN {2}\[test\] warn line/)
  assert.match(calls.error[1], /ERROR \[test\] error line/)
})

test('fields render as key=value, quoted when they contain whitespace', async () => {
  process.env.LOG_LEVEL = 'debug'
  const { createLogger } = await freshLogger()
  const log = createLogger('players')
  const { calls, restore } = captureConsole()
  try {
    log.info('Registered', { id: 42, username: 'sam', ip: '203.0.113.9' })
    log.warn('Login failed - unknown user', { username: 'two words', ip: '203.0.113.9' })
  } finally { restore() }
  assert.match(calls.log[0], /\[players\] Registered id=42 username=sam ip=203\.0\.113\.9/)
  assert.match(calls.error[0], /username="two words"/)
})

test('an Error field logs its message, not [object Error]', async () => {
  process.env.LOG_LEVEL = 'debug'
  const { createLogger } = await freshLogger()
  const log = createLogger('db')
  const { calls, restore } = captureConsole()
  try {
    log.error('Query failed', { err: new Error('connection refused') })
  } finally { restore() }
  // The message has a space, so formatFields quotes it like any other
  // whitespace-containing value - same rule as the "two words" case above.
  assert.match(calls.error[0], /err="connection refused"/)
})

test('every line starts with an ISO timestamp', async () => {
  process.env.LOG_LEVEL = 'debug'
  const { createLogger } = await freshLogger()
  const log = createLogger('x')
  const { calls, restore } = captureConsole()
  try { log.info('hi') } finally { restore() }
  assert.match(calls.log[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /)
})

test('undefined field values are omitted entirely', async () => {
  process.env.LOG_LEVEL = 'debug'
  const { createLogger } = await freshLogger()
  const log = createLogger('x')
  const { calls, restore } = captureConsole()
  try { log.info('hi', { a: 1, b: undefined }) } finally { restore() }
  assert.match(calls.log[0], /hi a=1$/)
})
