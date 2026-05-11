import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || '../uploads');

// Multer config
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const storedName = `${uuidv4()}${ext}`;
    cb(null, storedName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.ifc') {
      cb(null, true);
    } else {
      cb(new Error('Sadece .ifc dosyaları yüklenebilir'));
    }
  },
});

const router = Router();
router.use(requireAuth);

// GET /api/projects/:projectId/files — Projedeki dosyalar
router.get('/projects/:projectId/files', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const db = await getDb();

    // Verify project ownership
    const project = await db.execute({
      sql: 'SELECT id FROM Projects WHERE id = ? AND user_id = ?',
      args: [projectId, req.user!.id],
    });

    if (project.rows.length === 0) {
      res.status(404).json({ error: 'Proje bulunamadı' });
      return;
    }

    const result = await db.execute({
      sql: 'SELECT id, original_name, file_size, uploaded_at FROM Files WHERE project_id = ? ORDER BY uploaded_at DESC',
      args: [projectId],
    });

    res.json({ files: result.rows });
  } catch (err) {
    console.error('Get files error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/projects/:projectId/files — IFC dosyası yükle
router.post('/projects/:projectId/files', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const db = await getDb();

    // Verify project ownership
    const project = await db.execute({
      sql: 'SELECT id FROM Projects WHERE id = ? AND user_id = ?',
      args: [projectId, req.user!.id],
    });

    if (project.rows.length === 0) {
      // Clean up uploaded file
      if (req.file) fs.unlinkSync(req.file.path);
      res.status(404).json({ error: 'Proje bulunamadı' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Dosya seçilmedi' });
      return;
    }

    const result = await db.execute({
      sql: 'INSERT INTO Files (project_id, user_id, original_name, stored_name, file_size) VALUES (?, ?, ?, ?, ?)',
      args: [projectId, req.user!.id, req.file.originalname, req.file.filename, req.file.size],
    });

    // Update project timestamp
    await db.execute({
      sql: 'UPDATE Projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [projectId],
    });

    res.status(201).json({
      file: {
        id: Number(result.lastInsertRowid),
        original_name: req.file.originalname,
        file_size: req.file.size,
        uploaded_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Upload file error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/files/:id/download — IFC dosyası indir (stream)
router.get('/files/:id/download', async (req: Request, res: Response) => {
  try {
    const fileId = parseInt(req.params.id);
    const db = await getDb();

    const result = await db.execute({
      sql: 'SELECT f.*, p.user_id as project_owner FROM Files f JOIN Projects p ON f.project_id = p.id WHERE f.id = ?',
      args: [fileId],
    });

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Dosya bulunamadı' });
      return;
    }

    const file = result.rows[0];

    if (file.project_owner !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Yetkiniz yok' });
      return;
    }

    const filePath = path.resolve(UPLOAD_DIR, file.stored_name as string);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Dosya diskte bulunamadı' });
      return;
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name as string)}"`);
    
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.error('Download file error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// DELETE /api/files/:id — Dosya sil
router.delete('/files/:id', async (req: Request, res: Response) => {
  try {
    const fileId = parseInt(req.params.id);
    const db = await getDb();

    const result = await db.execute({
      sql: 'SELECT f.*, p.user_id as project_owner FROM Files f JOIN Projects p ON f.project_id = p.id WHERE f.id = ?',
      args: [fileId],
    });

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Dosya bulunamadı' });
      return;
    }

    const file = result.rows[0];

    if (file.project_owner !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Yetkiniz yok' });
      return;
    }

    // Delete from disk
    const filePath = path.resolve(UPLOAD_DIR, file.stored_name as string);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete from DB
    await db.execute({ sql: 'DELETE FROM Files WHERE id = ?', args: [fileId] });

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
