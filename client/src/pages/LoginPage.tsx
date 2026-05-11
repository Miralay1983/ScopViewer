import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import './LoginPage.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        if (password !== confirmPassword) {
          setError('Şifreler eşleşmiyor');
          setLoading(false);
          return;
        }
        await api.register(username, password, confirmPassword);
      } else {
        await api.login(username, password);
      }
      navigate('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : (isRegister ? 'Kayıt başarısız' : 'Giriş başarısız'));
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsRegister(!isRegister);
    setError('');
    setConfirmPassword('');
  };

  return (
    <div className="login-page">
      <div className="login-container animate-fade-up">
        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
          </div>
          <div>
            <h1 className="login-title">SCOP Viewer</h1>
            <p className="login-subtitle">{isRegister ? 'Yeni Hesap Oluştur' : 'IFC 3D Görüntüleyici'}</p>
          </div>
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="input-group">
            <label htmlFor="username">Kullanıcı Adı</label>
            <input
              id="username"
              type="text"
              className="input"
              placeholder="Kullanıcı adınızı girin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">Şifre</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder={isRegister ? 'En az 6 karakter' : 'Şifrenizi girin'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
            />
          </div>

          {isRegister && (
            <div className="input-group animate-fade-up">
              <label htmlFor="confirmPassword">Şifre Tekrar</label>
              <input
                id="confirmPassword"
                type="password"
                className="input"
                placeholder="Şifrenizi tekrar girin"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          )}

          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner spinner-sm"></span>
                {isRegister ? 'Kayıt yapılıyor...' : 'Giriş yapılıyor...'}
              </>
            ) : isRegister ? (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="8.5" cy="7" r="4"/>
                  <line x1="20" y1="8" x2="20" y2="14"/>
                  <line x1="23" y1="11" x2="17" y2="11"/>
                </svg>
                Kayıt Ol
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                  <polyline points="10 17 15 12 10 7"/>
                  <line x1="15" y1="12" x2="3" y2="12"/>
                </svg>
                Giriş Yap
              </>
            )}
          </button>
        </form>

        {/* Toggle Link */}
        <div className="login-toggle">
          {isRegister ? (
            <p>Zaten hesabınız var mı? <button type="button" className="toggle-link" onClick={toggleMode}>Giriş Yap</button></p>
          ) : (
            <p>Hesabınız yok mu? <button type="button" className="toggle-link" onClick={toggleMode}>Kayıt Ol</button></p>
          )}
        </div>

        <div className="login-footer">
          <p>SCOP IFC Viewer &copy; {new Date().getFullYear()}</p>
        </div>
      </div>
    </div>
  );
}
