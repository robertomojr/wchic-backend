import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export function signAdminToken(): string {
  return jwt.sign({ role: 'admin' }, config.admin.jwtSecret, { expiresIn: '7d' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    jwt.verify(token, config.admin.jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
