import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import dotenv from 'dotenv';

import { getDb } from './db.js';
import { hashPassword } from './auth.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import projectRoutes from './routes/projects.js';
import fileRoutes from './routes/files.js';

// In production (Render), env vars come from the dashboard — no .env file needed
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
}

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:5173',
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api', fileRoutes);

// In production, serve the Vite build
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(process.cwd(), 'client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Seed admin user if not exists
async function seedAdmin() {
  const db = await getDb();
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'scop2026';

  const existing = await db.execute({
    sql: 'SELECT id FROM Users WHERE username = ?',
    args: [username],
  });

  if (existing.rows.length === 0) {
    const hash = await hashPassword(password);
    await db.execute({
      sql: 'INSERT INTO Users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
      args: [username, hash, 'Administrator', 'admin'],
    });
    console.log(`✅ Admin kullanıcı oluşturuldu: ${username}`);
  }
}

// Start server
async function start() {
  try {
    await getDb();
    console.log('✅ Veritabanı bağlantısı başarılı');

    await seedAdmin();

    app.listen(PORT, () => {
      console.log(`🚀 SCOP Viewer API çalışıyor: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Sunucu başlatılamadı:', err);
    process.exit(1);
  }
}

start();
