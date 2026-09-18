// Leveled logger: error < warn < info < debug. LOG_LEVEL picks the floor -
// unset, it follows MODE (info in prod, debug in dev/test, same split as
// every other pacing/verbosity knob in config.js). Output is one line per
// call (timestamp, level, [tag], message, then any fields as key=value) to
// stdout/stderr, same as the console.* calls it replaces - `docker compose
// logs backend` or journald still captures it, there's no shipper to feed a
// richer format to.
//
// Hand-rolled rather than a dependency (pino, winston): this is a single
// process writing to its own stdout, which is exactly what ratelimit.js's
// own hand-rolled limiter already decided for a comparably small problem.
//
// Every route/module gets a `logger.js` instance via createLogger('tag') -
// see CLAUDE.md. Fields go in the second argument, not string-interpolated
// into the message, so a line stays greppable by field name regardless of
// what the message text says (e.g. `grep 'ip=1.2.3.4'`).

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 }

function resolveLevel() {
  const requested = (process.env.LOG_LEVEL || '').toLowerCase()
  if (requested in LEVELS) return requested
  return process.env.MODE === 'prod' ? 'info' : 'debug'
}

// Read once at module load (matches config.js's own env-at-boot convention)
// rather than on every call - LOG_LEVEL isn't meant to change without a
// restart, and re-parsing it per log line would be pure overhead.
const threshold = LEVELS[resolveLevel()]

function formatFields(fields) {
  if (!fields) return ''
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return ''
  return ' ' + entries.map(([k, v]) => {
    const s = v instanceof Error ? v.message : String(v)
    return `${k}=${/[\s="]/.test(s) ? JSON.stringify(s) : s}`
  }).join(' ')
}

function write(level, tag, message, fields) {
  if (LEVELS[level] > threshold) return
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${tag}] ${message}${formatFields(fields)}`
  // Only error/warn go to stderr - same split `console.error` vs
  // `console.log` already had, so docker/journald severity filtering by
  // stream still works exactly as before.
  ;(level === 'error' || level === 'warn' ? console.error : console.log)(line)
}

export function createLogger(tag) {
  return {
    error: (message, fields) => write('error', tag, message, fields),
    warn:  (message, fields) => write('warn',  tag, message, fields),
    info:  (message, fields) => write('info',  tag, message, fields),
    debug: (message, fields) => write('debug', tag, message, fields),
  }
}

// Exposed for tests / admin diagnostics (e.g. confirming what a running
// process is actually filtering at) - not meant to be read on a hot path.
export function currentLogLevel() {
  return resolveLevel()
}
