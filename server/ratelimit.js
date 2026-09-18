// Tiny in-memory rate limiter - per-process, resets on restart.
// Good enough until there's more than one server instance.
import { createLogger } from './logger.js'

const log = createLogger('ratelimit')
const buckets = new Map()

setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) {
    if (now > b.reset) buckets.delete(k)
  }
}, 10 * 60 * 1000).unref()

// The client address a bucket is keyed on. CLIENT_IP_HEADER names a header
// the proxy in front of us sets from the true client - behind Cloudflare
// that's cf-connecting-ip, which the edge overwrites on every request, so
// it can't be spoofed from outside. Unset, this is req.ip (which honours
// Express "trust proxy"). Never key on raw x-forwarded-for: clients can
// prepend to it and mint themselves fresh buckets, and with cloudflared +
// nginx both in the chain, hop-counting `trust proxy` is fragile - one hop
// short and every player shares a single bucket.
export function clientIp(req) {
  const header = process.env.CLIENT_IP_HEADER?.toLowerCase()
  const fromHeader = header && req.headers?.[header]
  return fromHeader || req.ip || req.socket?.remoteAddress || 'unknown'
}

export function rateLimit({ windowMs, max, key, message = 'Slow down - too many requests' }) {
  return (req, res, next) => {
    const k = key ? key(req) : clientIp(req)
    const now = Date.now()
    let bucket = buckets.get(k)
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + windowMs }
      buckets.set(k, bucket)
    }
    bucket.count++
    if (bucket.count > max) {
      // Log only the request that first tips a bucket over, not every one
      // rejected while it stays over - a client hammering a 429'd route
      // would otherwise make this the noisiest thing in the log.
      if (bucket.count === max + 1) log.warn('Limit exceeded', { key: k, max, path: req.originalUrl, message })
      return res.status(429).json({ error: message })
    }
    next()
  }
}
