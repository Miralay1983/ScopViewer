import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { User, Project, IFCFile } from '../api';
import './DashboardPage.css';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<IFCFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auth check
  useEffect(() => {
    api.me()
      .then((data) => { setUser(data.user); })
      .catch(() => navigate('/login'));
  }, [navigate]);

  // Load projects
  const loadProjects = useCallback(async () => {
    try {
      const data = await api.getProjects();
      setProjects(data.projects);
      setLoading(false);
    } catch { setLoading(false); }
  }, []);

  useEffect(() => { if (user) loadProjects(); }, [user, loadProjects]);

  // Load files for selected project
  const loadFiles = useCallback(async (project: Project) => {
    try {
      const data = await api.getFiles(project.id);
      setFiles(data.files);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (selectedProject) loadFiles(selectedProject);
    else setFiles([]);
  }, [selectedProject, loadFiles]);

  // Create project
  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      const data = await api.createProject(newProjectName.trim());
      setProjects([data.project, ...projects]);
      setNewProjectName('');
      setShowNewProject(false);
      setSelectedProject(data.project);
    } catch { /* ignore */ }
  };

  // Delete project
  const handleDeleteProject = async (id: number) => {
    if (!confirm('Bu proje ve tüm dosyaları silinecek. Emin misiniz?')) return;
    try {
      await api.deleteProject(id);
      setProjects(projects.filter(p => p.id !== id));
      if (selectedProject?.id === id) {
        setSelectedProject(null);
        setFiles([]);
      }
    } catch { /* ignore */ }
  };

  // Upload file
  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || !selectedProject) return;
    const file = fileList[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.ifc')) {
      alert('Sadece .ifc dosyaları yüklenebilir');
      return;
    }

    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_FILE_SIZE) {
      alert(`Dosya boyutu çok büyük (${formatSize(file.size)}). Maksimum 50 MB yüklenebilir.`);
      return;
    }

    setUploading(true);
    setUploadProgress(`Yükleniyor: ${file.name} (${formatSize(file.size)})`);
    try {
      const data = await api.uploadFile(selectedProject.id, file);
      setFiles([data.file, ...files]);
      setUploadProgress('');
      await loadProjects(); // refresh counts
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Yükleme başarısız');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  // Delete file
  const handleDeleteFile = async (id: number) => {
    if (!confirm('Bu dosya silinecek. Emin misiniz?')) return;
    try {
      await api.deleteFile(id);
      setFiles(files.filter(f => f.id !== id));
      await loadProjects();
    } catch { /* ignore */ }
  };

  // Drag and drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  // Logout
  const handleLogout = async () => {
    await api.logout();
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Yükleniyor...</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="dash-header">
        <div className="dash-header-left">
          <div className="dash-logo-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
          </div>
          <span className="dash-logo-text">SCOP Viewer</span>
        </div>
        <div className="dash-header-right">
          <span className="dash-user">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            {user?.display_name || user?.displayName || user?.username}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Çıkış
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="dash-content">
        {/* Left sidebar - Projects */}
        <aside className="dash-sidebar glass-panel">
          <div className="sidebar-header">
            <h2>Projeler</h2>
            <button className="btn btn-primary btn-sm" onClick={() => setShowNewProject(!showNewProject)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Yeni
            </button>
          </div>

          {showNewProject && (
            <div className="new-project-form">
              <input
                type="text"
                className="input"
                placeholder="Proje adı..."
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                autoFocus
              />
              <div className="new-project-actions">
                <button className="btn btn-primary btn-sm" onClick={handleCreateProject}>Oluştur</button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setShowNewProject(false); setNewProjectName(''); }}>İptal</button>
              </div>
            </div>
          )}

          <div className="project-list">
            {projects.length === 0 ? (
              <div className="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <p>Henüz proje yok</p>
                <p className="hint">Yeni proje oluşturun</p>
              </div>
            ) : (
              projects.map((project) => (
                <div
                  key={project.id}
                  className={`project-item ${selectedProject?.id === project.id ? 'active' : ''}`}
                  onClick={() => setSelectedProject(project)}
                >
                  <div className="project-info">
                    <span className="project-name">{project.name}</span>
                    <span className="project-meta">
                      {project.file_count} dosya · {formatSize(Number(project.total_size))}
                    </span>
                  </div>
                  <button
                    className="project-delete"
                    onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.id); }}
                    title="Projeyi sil"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Right - Files */}
        <main className="dash-main">
          {selectedProject ? (
            <>
              <div className="files-header">
                <div>
                  <h2>{selectedProject.name}</h2>
                  <p className="files-subtitle">{files.length} IFC dosyası</p>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  IFC Yükle
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ifc"
                  style={{ display: 'none' }}
                  onChange={(e) => handleUpload(e.target.files)}
                />
              </div>

              {uploadProgress && (
                <div className="upload-progress">
                  <div className="spinner spinner-sm"></div>
                  {uploadProgress}
                </div>
              )}

              {/* Drop zone */}
              <div
                className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                {files.length === 0 && !uploading ? (
                  <div className="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <p>IFC dosyalarını sürükleyip bırakın</p>
                    <p className="hint">veya "IFC Yükle" butonunu kullanın</p>
                  </div>
                ) : (
                  <div className="file-grid">
                    {files.map((file) => (
                      <div key={file.id} className="file-card glass-panel">
                        <div className="file-icon">
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent-indigo-light)" strokeWidth="1.5">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                            <line x1="12" y1="22.08" x2="12" y2="12"/>
                          </svg>
                        </div>
                        <div className="file-info">
                          <span className="file-name" title={file.original_name}>{file.original_name}</span>
                          <span className="file-meta">{formatSize(file.file_size)} · {formatDate(file.uploaded_at)}</span>
                        </div>
                        <div className="file-actions">
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => navigate(`/viewer/${file.id}`)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                            </svg>
                            Görüntüle
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteFile(file.id)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
              <p style={{ fontSize: '1.1rem', marginTop: '1rem' }}>Bir proje seçin</p>
              <p className="hint">veya sol panelden yeni proje oluşturun</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
