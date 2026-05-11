import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../auth.js';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.token;

  if (!token) {
    res.status(401).json({ error: 'Oturum açılmamış' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token' });
    return;
  }

  req.user = payload;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Yetkiniz yok' });
    return;
  }
  next();
}
