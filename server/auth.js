import jwt from 'jsonwebtoken'

export function signToken(player) {
  return jwt.sign(
    { id: player.id, username: player.username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try {
    req.player = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    next()
  } catch (err) {
    console.error('[auth] token verification failed:', err.message)
    res.status(401).json({ error: 'Invalid token' })
  }
}

// Like requireAuth, but never rejects - "browse as guest" (AuthModal.jsx) can
// hit these routes with no token at all. req.player is set when a valid
// token is present, left undefined otherwise; route handlers that need
// visibility.js's redaction treat a missing req.player as "sees only what
// anyone would" (an empty visibleSet), not as a reason to 401.
export function optionalAuth(req, res, next) {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    try {
      req.player = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    } catch {
      // Invalid/expired token on an optional route - proceed as a guest
      // rather than failing the request.
    }
  }
  next()
}
