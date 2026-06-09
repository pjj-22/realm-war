// Tiny in-memory rate limiter - per-process, resets on restart.
// Good enough until there's more than one server instance.

const buckets = new Map()

setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) {
    if (now > b.reset) buckets.delete(k)
  }
}, 10 * 60 * 1000).unref()

export function rateLimit({ windowMs, max, key, message = 'Slow down - too many requests' }) {
  return (req, res, next) => {
    const k = key ? key(req) : (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    const now = Date.now()
    let bucket = buckets.get(k)
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + windowMs }
      buckets.set(k, bucket)
    }
    bucket.count++
    if (bucket.count > max) return res.status(429).json({ error: message })
    next()
  }
}
