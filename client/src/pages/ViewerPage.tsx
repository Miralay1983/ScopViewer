import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { IFCViewerEngine } from '../lib/IFCViewerEngine';
import type { ElementInfo, LabelType, GridAxisInfo, GridInfo } from '../lib/IFCViewerEngine';
import './ViewerPage.css';

export default function ViewerPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<IFCViewerEngine | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState('Model yükleniyor...');
  const [error, setError] = useState('');
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
  const [labelType, setLabelType] = useState<LabelType>('partMark');
  const [showPanel, setShowPanel] = useState(true);
  const [fileName, setFileName] = useState('');
  const [gridAxes, setGridAxes] = useState<GridAxisInfo[]>([]);
  const [gridElevations, setGridElevations] = useState<GridInfo[]>([]);
  const [selectedAxis, setSelectedAxis] = useState<string>('');
  const [clipDepth, setClipDepth] = useState<number>(500);

  useEffect(() => {
    // Auth check
    api.me().catch(() => navigate('/login'));
  }, [navigate]);

  useEffect(() => {
    if (!containerRef.current || !fileId) return;

    let engine: IFCViewerEngine | null = null;

    const initViewer = async () => {
      try {
        setLoadProgress('3D sahne hazırlanıyor...');
        engine = new IFCViewerEngine(containerRef.current!);
        engineRef.current = engine;

        // Set up click handler
        engine.onElementClick((info: ElementInfo) => {
          if (info.expressId === -1) {
            setSelectedElement(null);
          } else {
            setSelectedElement(info);
          }
        });

        // Load IFC from server
        setLoadProgress('IFC dosyası indiriliyor...');
        const url = api.getFileDownloadUrl(parseInt(fileId));
        
        setLoadProgress('IFC modeli parse ediliyor...');
        await engine.loadIFC(url);

        // Extract grid axes after model loads
        const axes = engine.getAllGridAxes();
        setGridAxes(axes);
        const grids = engine.getGrids();
        setGridElevations(grids);
        console.log(`[Viewer] Found ${axes.length} grid axes, ${grids.length} elevation grids`);

        setLoading(false);
      } catch (err) {
        console.error('Viewer init error:', err);
        setError('IFC dosyası yüklenirken hata oluştu. Dosya geçerli bir IFC dosyası olmayabilir.');
        setLoading(false);
      }
    };

    initViewer();

    return () => {
      if (engine) {
        engine.dispose();
        engineRef.current = null;
      }
    };
  }, [fileId]);

  // Get file name
  useEffect(() => {
    if (!fileId) return;
    // We don't have a direct endpoint, but we can try the dashboard data
    setFileName(`IFC Model #${fileId}`);
  }, [fileId]);

  const handleResetView = () => {
    engineRef.current?.resetView();
  };

  const handleClearLabels = () => {
    engineRef.current?.removeAllLabels();
  };

  const handleLabelTypeChange = (type: LabelType) => {
    setLabelType(type);
    engineRef.current?.setLabelType(type);
  };

  const handleGridAxisChange = (value: string) => {
    setSelectedAxis(value);
    if (!engineRef.current) return;

    if (value === '') {
      engineRef.current.resetView();
      return;
    }
    if (value === '__plan__') {
      engineRef.current.fitToPlanView();
      return;
    }
    if (value.startsWith('__elev__')) {
      const elev = parseFloat(value.replace('__elev__', ''));
      engineRef.current.fitToElevation(elev);
      return;
    }

    const axis = gridAxes.find(a => a.name === value);
    if (axis) {
      engineRef.current.fitToGridAxis(axis);
    }
  };

  const handleClipDepthChange = (value: number) => {
    setClipDepth(value);
    if (engineRef.current) {
      engineRef.current.setClipDepth(value);
      // Re-apply current axis view with new depth
      if (selectedAxis && selectedAxis !== '' && selectedAxis !== '__plan__') {
        handleGridAxisChange(selectedAxis);
      }
    }
  };

  return (
    <div className="viewer-page">
      {/* Toolbar */}
      <div className="viewer-toolbar">
        <div className="toolbar-left">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/dashboard')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
            Geri
          </button>
          <span className="toolbar-divider"></span>
          <span className="toolbar-filename">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-indigo-light)" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
            {fileName}
          </span>
        </div>

        <div className="toolbar-center">
          <div className="label-selector">
            <span className="label-selector-title">Etiket:</span>
            <button
              className={`label-btn ${labelType === 'partMark' ? 'active part' : ''}`}
              onClick={() => handleLabelTypeChange('partMark')}
            >
              Part Mark
            </button>
            <button
              className={`label-btn ${labelType === 'assemblyMark' ? 'active assembly' : ''}`}
              onClick={() => handleLabelTypeChange('assemblyMark')}
            >
              Assembly Mark
            </button>
            <button
              className={`label-btn ${labelType === 'boltDimensions' ? 'active bolt' : ''}`}
              onClick={() => handleLabelTypeChange('boltDimensions')}
            >
              Bolt Dim.
            </button>
          </div>

          {/* Grid Axis Dropdown */}
          {gridAxes.length > 0 && (
            <>
              <span className="toolbar-divider"></span>
              <div className="grid-selector">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" strokeWidth="2">
                  <line x1="3" y1="3" x2="3" y2="21"/><line x1="9" y1="3" x2="9" y2="21"/>
                  <line x1="15" y1="3" x2="15" y2="21"/><line x1="21" y1="3" x2="21" y2="21"/>
                  <line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
                </svg>
                <select
                  className="grid-dropdown"
                  value={selectedAxis}
                  onChange={e => handleGridAxisChange(e.target.value)}
                >
                  <option value="">Aks Seç...</option>
                  <option value="__plan__">📐 Genel Plan</option>
                  {gridElevations.length > 0 && (
                    <optgroup label="Plan Görünümler (Kot)">
                      {gridElevations.map(g => (
                        <option key={`elev-${g.elevation}`} value={`__elev__${g.elevation}`}>
                          ⬜ {g.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Kesitler (1, 2, 3...)">
                    {gridAxes.filter(a => a.direction === 'vertical').map(a => (
                      <option key={`v-${a.name}`} value={a.name}>
                        Aks {a.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Kesitler (B, C...)">
                    {gridAxes.filter(a => a.direction === 'horizontal').map(a => (
                      <option key={`h-${a.name}`} value={a.name}>
                        Aks {a.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Clip Depth */}
              {selectedAxis && selectedAxis !== '' && selectedAxis !== '__plan__' && (
                <div className="clip-depth-control">
                  <label className="clip-depth-label">Derinlik:</label>
                  <input
                    type="number"
                    className="clip-depth-input"
                    value={clipDepth}
                    onChange={e => handleClipDepthChange(Math.max(50, parseInt(e.target.value) || 500))}
                    min={50}
                    max={10000}
                    step={50}
                  />
                  <span className="clip-depth-unit">mm</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="toolbar-right">
          <button className="btn btn-secondary btn-sm" onClick={handleClearLabels} title="Etiketleri Temizle">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleResetView} title="Görünümü Sıfırla">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            </svg>
          </button>
          <button
            className={`btn btn-sm ${showPanel ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowPanel(!showPanel)}
            title="Özellikler Paneli"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="viewer-body">
        {/* 3D Canvas */}
        <div className="viewer-canvas-wrapper">
          <div ref={containerRef} className="viewer-canvas"></div>

          {/* Loading overlay */}
          {loading && (
            <div className="viewer-loading">
              <div className="viewer-loading-content">
                <div className="spinner"></div>
                <p>{loadProgress}</p>
              </div>
            </div>
          )}

          {/* Error overlay */}
          {error && (
            <div className="viewer-loading">
              <div className="viewer-loading-content">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-rose)" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <p style={{ color: 'var(--accent-rose)' }}>{error}</p>
                <button className="btn btn-secondary" onClick={() => navigate('/dashboard')}>Dashboard'a Dön</button>
              </div>
            </div>
          )}

          {/* Status bar */}
          {!loading && !error && (
            <div className="viewer-statusbar">
              <span className="status-hint status-hint-desktop">🖱️ Sol tık: Eleman seç · Sağ tık + sürükle: Döndür · Scroll: Zoom · Orta tık: Kaydır</span>
              <span className="status-hint status-hint-mobile">👆 Dokun: Seç · 1 parmak: Döndür · 2 parmak: Zoom/Kaydır</span>
              {selectedElement && selectedElement.expressId !== -1 && (
                <span className="status-selected">
                  Seçili: ExpressID #{selectedElement.expressId}
                  {selectedElement.partMark && ` · Part: ${selectedElement.partMark}`}
                  {selectedElement.assemblyMark && ` · Assy: ${selectedElement.assemblyMark}`}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Property Panel */}
        {showPanel && (
          <div className="property-panel glass-panel">
            <div className="panel-header">
              <h3>Özellikler</h3>
            </div>
            <div className="panel-body">
              {selectedElement && selectedElement.expressId !== -1 ? (
                <>
                  {/* Quick marks */}
                  <div className="quick-marks">
                    {selectedElement.partMark && (
                      <div className="quick-mark part">
                        <span className="qm-label">Part Mark</span>
                        <span className="qm-value">{selectedElement.partMark}</span>
                      </div>
                    )}
                    {selectedElement.assemblyMark && (
                      <div className="quick-mark assembly">
                        <span className="qm-label">Assembly Mark</span>
                        <span className="qm-value">{selectedElement.assemblyMark}</span>
                      </div>
                    )}
                    {selectedElement.boltDimensions && (
                      <div className="quick-mark bolt">
                        <span className="qm-label">Bolt Dim.</span>
                        <span className="qm-value">{selectedElement.boltDimensions}</span>
                      </div>
                    )}
                  </div>

                  {/* Property sets */}
                  {selectedElement.propertySets.map((pset, i) => (
                    <div key={i} className="pset-group">
                      <div className="pset-name">{pset.name}</div>
                      <table className="pset-table">
                        <tbody>
                          {pset.properties.map((prop, j) => (
                            <tr key={j}>
                              <td className="prop-key">{prop.key}</td>
                              <td className="prop-value">{prop.value || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </>
              ) : (
                <div className="panel-empty">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <p>Bir elemana tıklayın</p>
                  <p className="hint">Part Mark, Assembly Mark ve diğer özellikler burada gösterilecek</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
