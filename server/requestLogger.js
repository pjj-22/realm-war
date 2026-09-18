// One debug-level log line per request: method, path, status, duration,
// client IP. Off by default in prod (LOG_LEVEL=info doesn't print debug -
// see logger.js) since every socket.io/REST poll would otherwise scroll
// the access log constantly; set LOG_LEVEL=debug on the droplet when
// actually chasing something ("what did that IP just hit").
//
// /api/health is excluded outright, debug or not - Docker's HEALTHCHECK
// polls it every 30s forever and it carries no signal either way.
import { createLogger } from './logger.js'
import { clientIp } from './ratelimit.js'

const log = createLogger('http')

export function requestLogger() {
  return (req, res, next) => {
    if (req.path === '/api/health') return next()
    const start = process.hrtime.bigint()
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6
      log.debug(`${req.method} ${req.originalUrl}`, {
        status: res.statusCode,
        ms: ms.toFixed(1),
        ip: clientIp(req),
      })
    })
    next()
  }
}
