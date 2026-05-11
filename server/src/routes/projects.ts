import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import fs from 'fs';
import path from 'path';

const router = Router();
router.use(requireAuth);

const UPLOAD_DIR = process.env.UPLOAD_DIR || '../uploads';

// GET /api/projects — Kullanıcının projeleri
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const result = await db.execute({
      sql: `SELECT p.*, 
            (SELECT COUNT(*) FROM Files f WHERE f.project_id = p.id) as file_count,
            (SELECT COALESCE(SUM(f.file_size), 0) FROM Files f WHERE f.project_id = p.id) as total_size
            FROM Projects p 
            WHERE p.user_id = ? 
            ORDER BY p.updated_at DESC`,
      args: [req.user!.id],
    });
    res.json({ projects: result.rows });
  } catch (err) {
    console.error('Get projects error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/projects — Yeni proje
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Proje adı gerekli' });
      return;
    }

    const db = await getDb();
    const result = await db.execute({
      sql: 'INSERT INTO Projects (user_id, name, description) VALUES (?, ?, ?)',
      args: [req.user!.id, name.trim(), description || ''],
    });

    res.status(201).json({
      project: {
        id: Number(result.lastInsertRowid),
        name: name.trim(),
        description: description || '',
        file_count: 0,
        total_size: 0,
      },
    });
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// DELETE /api/projects/:id — Proje + dosyalarını sil
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.id as string);
    const db = await getDb();

    // Verify ownership
    const project = await db.execute({
      sql: 'SELECT id FROM Projects WHERE id = ? AND user_id = ?',
      args: [projectId, req.user!.id],
    });

    if (project.rows.length === 0) {
      res.status(404).json({ error: 'Proje bulunamadı' });
      return;
    }

    // Get file list to delete from disk
    const files = await db.execute({
      sql: 'SELECT stored_name FROM Files WHERE project_id = ?',
      args: [projectId],
    });

    // Delete files from disk
    for (const file of files.rows) {
      const filePath = path.resolve(UPLOAD_DIR, file.stored_name as string);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Delete from DB (cascading will handle Files)
    await db.execute({ sql: 'DELETE FROM Files WHERE project_id = ?', args: [projectId] });
    await db.execute({ sql: 'DELETE FROM Projects WHERE id = ?', args: [projectId] });

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
