import jwt from 'jsonwebtoken'
import { jwtSecret } from './config.js'
import { query } from './db.js'

export async function authenticate(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' })
  try {
    const payload = jwt.verify(token, jwtSecret)
    const rows = await query(
      'SELECT id, full_name, email, role, is_active FROM users WHERE id = ? LIMIT 1',
      [payload.sub],
    )
    if (!rows.length || !rows[0].is_active) return res.status(401).json({ error: 'This account is unavailable.' })
    req.user = rows[0]
    next()
  } catch {
    return res.status(401).json({ error: 'Your session is invalid or has expired.' })
  }
}

export function allow(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to do that.' })
    next()
  }
}
