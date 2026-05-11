import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { hashPassword } from '../auth.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// All routes require admin
router.use(requireAuth, requireAdmin);

// GET /api/users — Tüm kullanıcılar
router.get('/', async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    const result = await db.execute(
      'SELECT id, username, display_name, role, is_active, created_at FROM Users ORDER BY created_at DESC'
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/users — Yeni kullanıcı oluştur
router.post('/', async (req: Request, res: Response) => {
  try {
    const { username, password, displayName, role } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
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
      args: [username, hash, displayName || username, role || 'user'],
    });

    res.status(201).json({
      user: {
        id: Number(result.lastInsertRowid),
        username,
        displayName: displayName || username,
        role: role || 'user',
      },
    });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// DELETE /api/users/:id — Kullanıcı sil
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string);
    
    if (userId === req.user!.id) {
      res.status(400).json({ error: 'Kendinizi silemezsiniz' });
      return;
    }

    const db = await getDb();
    await db.execute({
      sql: 'UPDATE Users SET is_active = 0 WHERE id = ?',
      args: [userId],
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
