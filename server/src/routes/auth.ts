import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { createToken, comparePassword, hashPassword } from '../auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
      return;
    }

    const db = await getDb();
    const result = await db.execute({
      sql: 'SELECT id, username, password_hash, display_name, role, is_active FROM Users WHERE username = ?',
      args: [username],
    });

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
      return;
    }

    const user = result.rows[0];

    if (!user.is_active) {
      res.status(403).json({ error: 'Hesabınız devre dışı' });
      return;
    }

    const valid = await comparePassword(password, user.password_hash as string);
    if (!valid) {
      res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
      return;
    }

    const token = createToken({
      id: user.id as number,
      username: user.username as string,
      role: user.role as string,
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/auth/register — Halka açık kayıt
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password, confirmPassword } = req.body;

    if (!username || !password || !confirmPassword) {
      res.status(400).json({ error: 'Tüm alanlar gerekli' });
      return;
    }

    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Şifreler eşleşmiyor' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
      return;
    }

    if (username.length < 3) {
      res.status(400).json({ error: 'Kullanıcı adı en az 3 karakter olmalı' });
      return;
    }

    const db = await getDb();

    // Check if username exists
    const existing = await db.execute({
      sql: 'SELECT id FROM Users WHERE username = ?',
      args: [username],
    });

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Bu kullanıcı adı zaten mevcut' });
      return;
    }

    const hash = await hashPassword(password);
    const result = await db.execute({
      sql: 'INSERT INTO Users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
      args: [username, hash, username, 'user'],
    });

    const userId = Number(result.lastInsertRowid);

    // Auto-login: create token and set cookie
    const token = createToken({
      id: userId,
      username,
      role: 'user',
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      user: {
        id: userId,
        username,
        displayName: username,
        role: 'user',
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/auth/logout
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const result = await db.execute({
      sql: 'SELECT id, username, display_name, role FROM Users WHERE id = ? AND is_active = 1',
      args: [req.user!.id],
    });

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Kullanıcı bulunamadı' });
      return;
    }

    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Auth me error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PUT /api/auth/password — Şifre değiştirme
router.put('/password', requireAuth, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Mevcut ve yeni şifre gerekli' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalı' });
      return;
    }

    const db = await getDb();
    const result = await db.execute({
      sql: 'SELECT password_hash FROM Users WHERE id = ?',
      args: [req.user!.id],
    });

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Kullanıcı bulunamadı' });
      return;
    }

    const valid = await comparePassword(currentPassword, result.rows[0].password_hash as string);
    if (!valid) {
      res.status(401).json({ error: 'Mevcut şifre hatalı' });
      return;
    }

    const hash = await hashPassword(newPassword);
    await db.execute({
      sql: 'UPDATE Users SET password_hash = ? WHERE id = ?',
      args: [hash, req.user!.id],
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
