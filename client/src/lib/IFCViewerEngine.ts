import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import * as WebIFC from 'web-ifc';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Extend THREE with BVH — enables fast raycasting on all meshes globally
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;

export type LabelType = 'partMark' | 'assemblyMark' | 'boltDimensions';

export interface PropertySet {
  name: string;
  properties: { key: string; value: string }[];
}

export interface ElementInfo {
  expressId: number;
  propertySets: PropertySet[];
  partMark?: string;
  assemblyMark?: string;
  boltDimensions?: string;
}

export interface GridAxisInfo {
  name: string;
  direction: 'vertical' | 'horizontal'; // vertical = sabit X (kesit), horizontal = sabit Y (kesit)
  position: number; // sabit koordinat değeri (mm)
  start: THREE.Vector2; // başlangıç noktası
  end: THREE.Vector2; // bitiş noktası
  gridName: string; // parent grid adı (kat)
  gridElevation: number; // grid Z kotu (mm)
}

export interface GridInfo {
  name: string;
  elevation: number;
  uAxes: GridAxisInfo[]; // dikey akslar (1,2,3...)
  vAxes: GridAxisInfo[]; // yatay akslar (A,B,C...)
}

interface LoadedMesh {
  mesh: THREE.Mesh;
  expressIds: Float32Array | Uint32Array;
}

export class IFCViewerEngine {
  private container: HTMLDivElement;
  private scene: THREE.Scene;
  private perspCamera: THREE.PerspectiveCamera;
  private orthoCamera: THREE.OrthographicCamera;
  private activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private isOrtho = false;
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private controls: OrbitControls;
  private ifcApi: WebIFC.IfcAPI;
  private modelID = 0;
  private meshes: LoadedMesh[] = [];
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private labels = new Map<number, CSS2DObject>();
  private highlightMesh?: THREE.Mesh;
  private highlightMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.4,
    color: 0x635bff,
    depthTest: false,
  });
  private onClickCallback?: (info: ElementInfo) => void;
  private animationId?: number;
  private currentLabelType: LabelType = 'partMark';
  private grids: GridInfo[] = [];
  private gridScaleFactor: number | null = null;
  private clipPlanes: THREE.Plane[] = [];
  private clipDepthMm = 500;
  private sectionGridObjects: THREE.Object3D[] = [];
  // Hide/show element state
  private hiddenExpressIds = new Set<number>();
  private savedVertexData = new Map<number, Array<{ geo: THREE.BufferGeometry; vi: number; x: number; y: number; z: number }>>();
  private lastSelectedExpressId?: number;
  private ctxMenu?: HTMLDivElement;
  // Search index
  private allExpressIds = new Set<number>();
  private partMarkIndex = new Map<string, number[]>();
  private assemblyMarkIndex = new Map<string, number[]>();
  private searchHighlightObjects: THREE.Object3D[] = [];
  // Long press (mobile context menu)
  private longPressTimer?: ReturnType<typeof setTimeout>;
  private longPressX = 0;
  private longPressY = 0;
  private longPressMoved = false;

  constructor(container: HTMLDivElement) {
    this.container = container;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0d14);

    // Camera — Perspective (default)
    const w = container.clientWidth;
    const h = container.clientHeight;
    const aspect = w / h;
    this.perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10000);
    this.perspCamera.position.set(30, 30, 30);

    // Camera — Orthographic (for section / plan views)
    const frustumSize = 50;
    this.orthoCamera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2, frustumSize * aspect / 2,
      frustumSize / 2, -frustumSize / 2,
      0.01, 20000
    );
    this.orthoCamera.position.set(30, 30, 30);

    // Active camera starts as perspective
    this.activeCamera = this.perspCamera;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.localClippingEnabled = true; // Enable clipping planes
    container.appendChild(this.renderer.domElement);

    // CSS2D Renderer (for labels)
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.labelRenderer.domElement);

    // Controls
    this.controls = new OrbitControls(this.perspCamera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = true;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(50, 100, 50);
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-50, 50, -50);
    this.scene.add(fillLight);

    // (AxesHelper kaldırıldı — akslar sadece section modda çiziliyor)

    // IFC API
    this.ifcApi = new WebIFC.IfcAPI();

    // Events
    container.addEventListener('click', this.handleClick);
    container.addEventListener('contextmenu', this.handleContextMenu);
    // Long press for mobile (iOS doesn't fire contextmenu on canvas reliably)
    container.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    container.addEventListener('touchmove', this.handleTouchMove, { passive: true });
    container.addEventListener('touchend', this.handleTouchEnd, { passive: true });
    window.addEventListener('resize', this.handleResize);

    // Render loop
    this.animate();
  }

  async loadIFC(url: string): Promise<void> {
    // Initialize WASM
    this.ifcApi.SetWasmPath('/wasm/');
    await this.ifcApi.Init();

    // Fetch IFC file
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error('Dosya indirilemedi');
    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);

    // Open the model
    this.modelID = this.ifcApi.OpenModel(data);

    // Load all meshes
    this.loadAllMeshes();

    // Parse grids
    this.parseGrids();
  }

  private loadAllMeshes(): void {
    // Group geometries by color to minimize draw calls
    interface GeoGroup {
      geos: THREE.BufferGeometry[];
      color: THREE.Color;
      opacity: number;
    }
    const groups = new Map<string, GeoGroup>();

    const flatMeshes = this.ifcApi.LoadAllGeometry(this.modelID);

    for (let i = 0; i < flatMeshes.size(); i++) {
      const flatMesh = flatMeshes.get(i);
      const expressId = flatMesh.expressID;
      const placedGeometries = flatMesh.geometries;
      this.allExpressIds.add(expressId); // for search index

      for (let j = 0; j < placedGeometries.size(); j++) {
        const pg = placedGeometries.get(j);
        const geometry = this.ifcApi.GetGeometry(this.modelID, pg.geometryExpressID);
        const verts = this.ifcApi.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const indices = this.ifcApi.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        const geo = this.createBufferGeometry(verts, indices);

        // Bake transform into geometry (needed for merging)
        const matrix = new THREE.Matrix4().fromArray(pg.flatTransformation);
        geo.applyMatrix4(matrix);

        // Tag every vertex with its expressId
        const count = geo.getAttribute('position').count;
        geo.setAttribute('expressId', new THREE.BufferAttribute(
          new Float32Array(count).fill(expressId), 1
        ));

        // Round color for grouping (reduce unique materials)
        const c = pg.color;
        const r = Math.round(c.x * 10) / 10;
        const g = Math.round(c.y * 10) / 10;
        const b = Math.round(c.z * 10) / 10;
        const a = c.w < 0.99 ? 0.4 : 1.0; // only two opacity levels
        const key = `${r},${g},${b},${a}`;

        if (!groups.has(key)) {
          groups.set(key, { geos: [], color: new THREE.Color(r, g, b), opacity: a });
        }
        groups.get(key)!.geos.push(geo);
        geometry.delete();
      }
    }

    // Merge each color group into a single mesh
    for (const [, group] of groups) {
      const merged = mergeGeometries(group.geos, false);
      for (const g of group.geos) g.dispose();
      if (!merged) continue;

      // Build BVH on merged geometry
      (merged as any).computeBoundsTree();

      const material = new THREE.MeshPhongMaterial({
        color: group.color,
        opacity: group.opacity,
        transparent: group.opacity < 1,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(merged, material);
      this.scene.add(mesh);
      this.meshes.push({ mesh, expressIds: new Uint32Array(0) });
    }

    this.fitToScene();
    this.requestRender();
  }

  private createBufferGeometry(verts: Float32Array, indices: Uint32Array): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const posFloats = new Float32Array(verts.length / 2);
    const normFloats = new Float32Array(verts.length / 2);
    for (let i = 0; i < verts.length / 6; i++) {
      posFloats[i * 3]     = verts[i * 6];
      posFloats[i * 3 + 1] = verts[i * 6 + 1];
      posFloats[i * 3 + 2] = verts[i * 6 + 2];
      normFloats[i * 3]     = verts[i * 6 + 3];
      normFloats[i * 3 + 1] = verts[i * 6 + 4];
      normFloats[i * 3 + 2] = verts[i * 6 + 5];
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(posFloats, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normFloats, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    return geometry;
  }

  private fitToScene(): void {
    const box = new THREE.Box3();
    this.meshes.forEach(({ mesh }) => box.expandByObject(mesh));

    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 2;

    this.perspCamera.position.set(
      center.x + distance * 0.5,
      center.y + distance * 0.7,
      center.z + distance * 0.5
    );
    this.perspCamera.up.set(0, 1, 0);
    this.controls.target.copy(center);
    this.controls.update();
  }

  private handleClick = async (event: MouseEvent): Promise<void> => {
    // Sag tus menusunu kapat
    this.closeContextMenu();

    const bounds = this.container.getBoundingClientRect();
    this.mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.activeCamera);
    const allMeshObjects = this.meshes.map(m => m.mesh);
    const rawIntersects = this.raycaster.intersectObjects(allMeshObjects, false);

    // Clip plane filtresi: sadece gorunen kesit icindeki elemanlar
    const intersects = rawIntersects.filter(hit =>
      this.clipPlanes.length === 0 ||
      this.clipPlanes.every(plane => plane.distanceToPoint(hit.point) >= -0.01)
    );

    if (intersects.length > 0) {
      const hit = intersects[0];

      // Read expressId from vertex attribute (merged geometry)
      let expressId: number | undefined;
      if (hit.face !== null && hit.face !== undefined) {
        const attr = (hit.object as THREE.Mesh).geometry.getAttribute('expressId');
        if (attr) expressId = Math.round(attr.getX(hit.face.a));
      }
      if (expressId === undefined) expressId = hit.object.userData.expressId as number;

      if (expressId !== undefined && expressId !== -1) {
        this.lastSelectedExpressId = expressId;
        this.highlightElement(hit.object as THREE.Mesh, expressId);
        const info = await this.getElementInfo(expressId, hit.point);
        if (this.onClickCallback) this.onClickCallback(info);
      }
    } else {
      this.lastSelectedExpressId = undefined;
      this.clearHighlight();
      this.removeAllLabels();
      if (this.onClickCallback) this.onClickCallback({ expressId: -1, propertySets: [] });
    }
  };

  private handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    this.showContextMenu(event.clientX, event.clientY);
  };

  // ── Long press handlers (mobile) ──────────────────────────────────
  private handleTouchStart = (event: TouchEvent): void => {
    if (event.touches.length !== 1) return;
    const t = event.touches[0];
    this.longPressX = t.clientX;
    this.longPressY = t.clientY;
    this.longPressMoved = false;
    this.longPressTimer = setTimeout(() => {
      if (!this.longPressMoved) {
        this.showContextMenu(this.longPressX, this.longPressY);
      }
    }, 600); // 600ms hold
  };

  private handleTouchMove = (): void => {
    // If finger moved, cancel long press
    this.longPressMoved = true;
    if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = undefined; }
  };

  private handleTouchEnd = (): void => {
    if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = undefined; }
  };

  private showContextMenu(x: number, y: number): void {
    this.closeContextMenu();

    const menu = document.createElement('div');
    menu.style.cssText = [
      'position:fixed',
      `left:${x}px`,
      `top:${y}px`,
      'background:rgba(16,18,28,0.97)',
      'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:10px',
      'padding:6px 0',
      'z-index:99999',
      'min-width:180px',
      'box-shadow:0 12px 40px rgba(0,0,0,0.7)',
      'backdrop-filter:blur(12px)',
      'font-family:Inter,sans-serif',
      'font-size:13px',
    ].join(';');

    const mkItem = (icon: string, label: string, disabled: boolean, onClick: () => void) => {
      const item = document.createElement('div');
      item.style.cssText = [
        `padding:9px 16px`,
        `color:${disabled ? '#555' : '#e8e8f0'}`,
        `cursor:${disabled ? 'default' : 'pointer'}`,
        'display:flex',
        'align-items:center',
        'gap:10px',
        'transition:background 0.12s',
      ].join(';');
      item.innerHTML = `<span style="font-size:15px">${icon}</span><span>${label}</span>`;
      if (!disabled) {
        item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,0.08)'; };
        item.onmouseleave = () => { item.style.background = 'transparent'; };
        item.onclick = () => { onClick(); this.closeContextMenu(); };
      }
      menu.appendChild(item);
    };

    const addSep = () => {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin:4px 0';
      menu.appendChild(sep);
    };

    const hasSelected = this.lastSelectedExpressId !== undefined;
    const hasHidden = this.hiddenExpressIds.size > 0;

    // Secim grubu
    mkItem('\uD83D\uDE48', 'Seçiliyi Gizle', !hasSelected, () => {
      if (this.lastSelectedExpressId !== undefined) this.hideElement(this.lastSelectedExpressId);
    });
    mkItem('\uD83D\uDC65', 'Seçilmeyenleri Gizle', !hasSelected, () => this.hideUnselected());
    mkItem('\uD83D\uDD2D', 'Seçiliye Odaklan', !hasSelected, () => this.fitToSelected());

    addSep();

    // Gorünurluk grubu
    mkItem('\uD83D\uDC41\uFE0F', `Tümünü Göster (${this.hiddenExpressIds.size})`, !hasHidden, () => this.showAllElements());
    mkItem('\uD83C\uDFE0', 'Görünümü Sıfırla', false, () => this.resetView());

    addSep();

    // Araclar
    mkItem('\uD83C\uDFF7\uFE0F', 'Etiketleri Temizle', false, () => this.removeAllLabels());
    mkItem('\u2728', 'Arama Vurgularını Temizle', this.searchHighlightObjects.length === 0,
      () => this.clearSearchHighlights());

    document.body.appendChild(menu);
    this.ctxMenu = menu;

    // Disari tiklaninca kapat
    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        this.closeContextMenu();
        document.removeEventListener('mousedown', close);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  private closeContextMenu(): void {
    if (this.ctxMenu) { this.ctxMenu.remove(); this.ctxMenu = undefined; }
  }

  /** Secili elemani gizle (pozisyonlari saklar, geri yukleme icin) */
  hideElement(expressId: number): void {
    if (this.hiddenExpressIds.has(expressId)) return;
    this.hiddenExpressIds.add(expressId);
    const saved: Array<{ geo: THREE.BufferGeometry; vi: number; x: number; y: number; z: number }> = [];

    for (const { mesh } of this.meshes) {
      const geo = mesh.geometry;
      const eidAttr = geo.getAttribute('expressId');
      const posAttr = geo.getAttribute('position');
      if (!eidAttr || !posAttr) continue;

      const eids = eidAttr.array as Float32Array;
      const pos = posAttr.array as Float32Array;
      let changed = false;

      for (let vi = 0; vi < eids.length; vi++) {
        if (Math.round(eids[vi]) === expressId) {
          saved.push({ geo, vi, x: pos[vi*3], y: pos[vi*3+1], z: pos[vi*3+2] });
          pos[vi*3] = 0; pos[vi*3+1] = 0; pos[vi*3+2] = 0;
          changed = true;
        }
      }
      if (changed) posAttr.needsUpdate = true;
    }

    this.savedVertexData.set(expressId, saved);
    this.clearHighlight();
    this.lastSelectedExpressId = undefined;
  }

  /** Belirli bir elemani tekrar goster */
  showElement(expressId: number): void {
    const saved = this.savedVertexData.get(expressId);
    if (!saved) return;
    for (const { geo, vi, x, y, z } of saved) {
      const pos = geo.getAttribute('position').array as Float32Array;
      pos[vi*3] = x; pos[vi*3+1] = y; pos[vi*3+2] = z;
      geo.getAttribute('position').needsUpdate = true;
    }
    this.hiddenExpressIds.delete(expressId);
    this.savedVertexData.delete(expressId);
  }

  /** Gizlenen tum elemanlari geri goster */
  showAllElements(): void {
    for (const expressId of [...this.hiddenExpressIds]) {
      this.showElement(expressId);
    }
  }

  /** Secilenlerin disindaki tum elemanlari gizle */
  hideUnselected(): void {
    if (this.lastSelectedExpressId === undefined) return;
    const keep = this.lastSelectedExpressId;
    for (const eid of [...this.allExpressIds]) {
      if (eid !== keep && !this.hiddenExpressIds.has(eid)) {
        this.hideElement(eid);
      }
    }
  }

  /** Model sinirlarini hesaplayip kameraya sigidir */
  fitToElements(expressIds: number[]): void {
    const eidSet = new Set(expressIds);
    const box = new THREE.Box3();
    for (const { mesh } of this.meshes) {
      const geo = mesh.geometry;
      const eidAttr = geo.getAttribute('expressId');
      const posAttr = geo.getAttribute('position');
      if (!eidAttr || !posAttr) continue;
      const eids = eidAttr.array as Float32Array;
      const pos = posAttr.array as Float32Array;
      for (let vi = 0; vi < eids.length; vi++) {
        if (eidSet.has(Math.round(eids[vi]))) {
          box.expandByPoint(new THREE.Vector3(pos[vi*3], pos[vi*3+1], pos[vi*3+2]));
        }
      }
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 2.5;
    this.perspCamera.position.set(center.x + dist * 0.5, center.y + dist * 0.7, center.z + dist * 0.5);
    this.controls.target.copy(center);
    this.controls.update();
  }

  /** Secili elemana odaklan */
  fitToSelected(): void {
    if (this.lastSelectedExpressId !== undefined) {
      this.fitToElements([this.lastSelectedExpressId]);
    }
  }

  /** Search index olustur (async, model yuklendikten sonra cagrilir) */
  async buildSearchIndex(onProgress?: (pct: number, done: boolean) => void): Promise<void> {
    this.partMarkIndex.clear();
    this.assemblyMarkIndex.clear();
    const ids = [...this.allExpressIds];
    const batchSize = 40;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      for (const eid of batch) {
        try {
          const info = await this.getElementInfo(eid);
          if (info.partMark) {
            const k = info.partMark.toLowerCase();
            if (!this.partMarkIndex.has(k)) this.partMarkIndex.set(k, []);
            this.partMarkIndex.get(k)!.push(eid);
          }
          if (info.assemblyMark) {
            const k = info.assemblyMark.toLowerCase();
            if (!this.assemblyMarkIndex.has(k)) this.assemblyMarkIndex.set(k, []);
            this.assemblyMarkIndex.get(k)!.push(eid);
          }
        } catch { /* skip */ }
      }
      if (onProgress) onProgress(Math.min(99, Math.round((i + batchSize) / ids.length * 100)), false);
      await new Promise(r => setTimeout(r, 0)); // yield to UI
    }
    if (onProgress) onProgress(100, true);
  }

  /** Mark ile arama — icinden gec */
  searchByMark(query: string, type: 'partMark' | 'assemblyMark'): number[] {
    if (!query.trim()) return [];
    const index = type === 'partMark' ? this.partMarkIndex : this.assemblyMarkIndex;
    const q = query.toLowerCase().trim();
    const results: number[] = [];
    for (const [key, ids] of index) {
      if (key.includes(q)) results.push(...ids);
    }
    return [...new Set(results)];
  }

  /** Arama sonuclarini altin rengi wireframe box ile vurgula */
  highlightSearchResults(expressIds: number[]): void {
    this.clearSearchHighlights();
    const gold = new THREE.Color(0xffd700);
    for (const eid of expressIds.slice(0, 300)) {
      const box = new THREE.Box3();
      for (const { mesh } of this.meshes) {
        const geo = mesh.geometry;
        const eidAttr = geo.getAttribute('expressId');
        const posAttr = geo.getAttribute('position');
        if (!eidAttr || !posAttr) continue;
        const eids = eidAttr.array as Float32Array;
        const pos = posAttr.array as Float32Array;
        for (let vi = 0; vi < eids.length; vi++) {
          if (Math.round(eids[vi]) === eid) {
            box.expandByPoint(new THREE.Vector3(pos[vi*3], pos[vi*3+1], pos[vi*3+2]));
          }
        }
      }
      if (!box.isEmpty()) {
        const helper = new THREE.Box3Helper(box, gold);
        this.scene.add(helper);
        this.searchHighlightObjects.push(helper);
      }
    }
  }

  clearSearchHighlights(): void {
    for (const obj of this.searchHighlightObjects) {
      this.scene.remove(obj);
      if ((obj as any).geometry) (obj as any).geometry.dispose();
    }
    this.searchHighlightObjects = [];
  }

  get hiddenCount(): number { return this.hiddenExpressIds.size; }
  get isSearchIndexReady(): boolean { return this.partMarkIndex.size > 0 || this.assemblyMarkIndex.size > 0; }

  private highlightElement(mesh: THREE.Mesh, clickedId: number): void {
    this.clearHighlight();
    const geom = mesh.geometry;
    const eidAttr = geom.getAttribute('expressId');

    if (!eidAttr || !geom.getIndex()) {
      // Legacy single mesh
      this.highlightMesh = new THREE.Mesh(geom.clone(), this.highlightMaterial);
      this.highlightMesh.applyMatrix4(mesh.matrixWorld);
    } else {
      // Extract only the faces belonging to clickedId
      const indexArr = geom.getIndex()!.array as Uint32Array;
      const posArr = geom.getAttribute('position').array as Float32Array;
      const eids = eidAttr.array as Float32Array;
      const newPos: number[] = [];
      const newIdx: number[] = [];
      const remap = new Map<number, number>();
      for (let i = 0; i < indexArr.length; i += 3) {
        const a = indexArr[i], b = indexArr[i+1], c = indexArr[i+2];
        if (Math.round(eids[a]) !== clickedId) continue;
        for (const v of [a, b, c]) {
          if (!remap.has(v)) {
            remap.set(v, newPos.length / 3);
            newPos.push(posArr[v*3], posArr[v*3+1], posArr[v*3+2]);
          }
          newIdx.push(remap.get(v)!);
        }
      }
      if (newPos.length > 0) {
        const hg = new THREE.BufferGeometry();
        hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPos), 3));
        hg.setIndex(newIdx);
        this.highlightMesh = new THREE.Mesh(hg, this.highlightMaterial);
      }
    }

    if (this.highlightMesh) {
      this.scene.add(this.highlightMesh);
      this.requestRender();
    }
  }

  private clearHighlight(): void {
    if (this.highlightMesh) {
      this.scene.remove(this.highlightMesh);
      this.highlightMesh.geometry.dispose();
      this.highlightMesh = undefined;
      this.requestRender();
    }
  }

  async getElementInfo(expressId: number, point?: THREE.Vector3): Promise<ElementInfo> {
    const propertySets: PropertySet[] = [];
    let partMark: string | undefined;
    let assemblyMark: string | undefined;
    let boltDimensions: string | undefined;

    try {
      // Get element properties with flatten=true to resolve references
      const props = this.ifcApi.GetLine(this.modelID, expressId, false);
      
      const basicProps: PropertySet = {
        name: 'Temel Bilgiler',
        properties: [],
      };

      if (props) {
        if (props.Name?.value) basicProps.properties.push({ key: 'Ad', value: String(props.Name.value) });
        if (props.Description?.value) basicProps.properties.push({ key: 'Açıklama', value: String(props.Description.value) });
        if (props.ObjectType?.value) basicProps.properties.push({ key: 'Tip', value: String(props.ObjectType.value) });
        if (props.Tag?.value) basicProps.properties.push({ key: 'Etiket', value: String(props.Tag.value) });
        if (props.GlobalId?.value) basicProps.properties.push({ key: 'GlobalId', value: String(props.GlobalId.value) });
        basicProps.properties.push({ key: 'ExpressID', value: String(expressId) });
        
        try {
          const typeName = this.ifcApi.GetLineType(this.modelID, expressId);
          if (typeName) basicProps.properties.push({ key: 'IFC Tipi', value: String(typeName) });
        } catch { /* ignore */ }
      }

      if (basicProps.properties.length > 0) {
        propertySets.push(basicProps);
      }

      // Build property index if not already built
      if (!this.propertyIndex) {
        this.buildPropertyIndex();
      }

      // Get property sets from index
      const psetIds = this.propertyIndex?.get(expressId) || [];
      
      for (const psetId of psetIds) {
        try {
          const pset = this.ifcApi.GetLine(this.modelID, psetId, false);
          if (!pset) continue;

          const psetName = pset.Name?.value || 'Properties';
          const properties: PropertySet['properties'] = [];

          // Handle HasProperties (for IFCPROPERTYSET)
          const hasProps = pset.HasProperties;
          if (hasProps) {
            const propsArray = Array.isArray(hasProps) ? hasProps : [hasProps];
            for (const propRef of propsArray) {
              try {
                const propId = typeof propRef === 'object' ? propRef.value : propRef;
                if (!propId || typeof propId !== 'number') continue;

                const prop = this.ifcApi.GetLine(this.modelID, propId, false);
                if (prop && prop.Name?.value) {
                  let value = '';
                  if (prop.NominalValue !== undefined && prop.NominalValue !== null) {
                    if (typeof prop.NominalValue === 'object' && prop.NominalValue.value !== undefined) {
                      value = String(prop.NominalValue.value);
                    } else {
                      value = String(prop.NominalValue);
                    }
                  }
                  properties.push({ key: String(prop.Name.value), value });
                }
              } catch { /* skip property */ }
            }
          }

          // Handle Quantities (for IFCELEMENTQUANTITY)
          const quantities = pset.Quantities;
          if (quantities) {
            const qArray = Array.isArray(quantities) ? quantities : [quantities];
            for (const qRef of qArray) {
              try {
                const qId = typeof qRef === 'object' ? qRef.value : qRef;
                if (!qId || typeof qId !== 'number') continue;

                const q = this.ifcApi.GetLine(this.modelID, qId, false);
                if (q && q.Name?.value) {
                  let value = '';
                  // Quantities can have LengthValue, AreaValue, VolumeValue, WeightValue, CountValue
                  for (const vKey of ['LengthValue', 'AreaValue', 'VolumeValue', 'WeightValue', 'CountValue']) {
                    if (q[vKey] !== undefined && q[vKey] !== null) {
                      value = String(typeof q[vKey] === 'object' ? q[vKey].value : q[vKey]);
                      break;
                    }
                  }
                  properties.push({ key: String(q.Name.value), value });
                }
              } catch { /* skip quantity */ }
            }
          }

          if (properties.length > 0) {
            propertySets.push({ name: psetName, properties });
          }
        } catch { /* skip pset */ }
      }

      // Search ALL property sets for Tekla marks
      for (const pset of propertySets) {
        for (const prop of pset.properties) {
          if (!prop.value || prop.value === 'undefined' || prop.value === '') continue;
          
          const keyLower = prop.key.toLowerCase().replace(/[\s_-]/g, '');
          
          // Part mark patterns
          if (!partMark && (
            keyLower === 'partpos' || 
            keyLower === 'partmark' || 
            keyLower === 'partposition' ||
            keyLower === 'teklacommonpartmark' ||
            keyLower === 'teklacommonpartpos'
          )) {
            partMark = prop.value;
          }
          
          // Assembly mark patterns
          if (!assemblyMark && (
            keyLower === 'assemblypos' || 
            keyLower === 'assemblymark' || 
            keyLower === 'assemblyposition' ||
            keyLower === 'teklacommonassemblymark' ||
            keyLower === 'teklacommonassemblypos' ||
            keyLower === 'teklaassemblymark' ||
            keyLower === 'teklaassemblypos'
          )) {
            assemblyMark = prop.value;
          }
          
          // Bolt dimensions
          if (keyLower.includes('nominaldiameter') || keyLower.includes('boltdiameter') || keyLower === 'diameter') {
            const diameter = prop.value;
            if (boltDimensions && boltDimensions.includes('×')) {
              boltDimensions = `Ø${diameter}${boltDimensions.substring(boltDimensions.indexOf('×'))}`;
            } else {
              boltDimensions = `Ø${diameter}`;
            }
          }
          if (keyLower.includes('nominallength') || keyLower.includes('boltlength') || keyLower === 'length') {
            const length = prop.value;
            if (boltDimensions) {
              boltDimensions = `${boltDimensions}×${length}`;
            } else {
              boltDimensions = `Ø?×${length}`;
            }
          }
        }
      }

      // Debug: log found marks to console
      console.log(`[IFC Element #${expressId}] Part: ${partMark || '-'} | Assembly: ${assemblyMark || '-'} | Bolt: ${boltDimensions || '-'} | PSet count: ${propertySets.length}`);

      // Etiket gösterimi: aktif label type'a gore goster
      // Eger bolt secildiyse ve aktif type part/assembly ise, bolt bilgisini de ek olarak goster
      if (point) {
        this.removeAllLabels();

        if (boltDimensions) {
          // Bu eleman bir bolt — bolt bilgisini her zaman goster (aktif type'tan bagimsiz)
          this.showLabelAtPoint(expressId, boltDimensions, point, 'boltDimensions');
        } else {
          // Normal eleman — aktif label type'a gore goster
          const labelText = this.currentLabelType === 'partMark' ? partMark
            : this.currentLabelType === 'assemblyMark' ? assemblyMark
            : boltDimensions;

          if (labelText) {
            this.showLabelAtPoint(expressId, labelText, point, this.currentLabelType);
          } else {
            // Fallback: mevcut olan ilk bilgiyi goster
            if (assemblyMark) {
              this.showLabelAtPoint(expressId, assemblyMark, point, 'assemblyMark');
            } else if (partMark) {
              this.showLabelAtPoint(expressId, partMark, point, 'partMark');
            }
          }
        }
      }
    } catch (err) {
      console.error('Property extraction error:', err);
    }

    return { expressId, propertySets, partMark, assemblyMark, boltDimensions };
  }

  // Property index: expressId -> psetIds[]
  private propertyIndex: Map<number, number[]> | null = null;
  // Assembly index: childId -> parentAssemblyId
  private assemblyParentIndex: Map<number, number> | null = null;
  // Assembly children index: parentId -> childIds[]
  private assemblyChildrenIndex: Map<number, number[]> | null = null;

  private buildPropertyIndex(): void {
    console.log('[IFC] Building property index...');
    this.propertyIndex = new Map();
    this.assemblyParentIndex = new Map();
    this.assemblyChildrenIndex = new Map();
    
    try {
      // 1. Build assembly parent/children index from IFCRELAGGREGATES
      const aggLines = this.ifcApi.GetLineIDsWithType(this.modelID, WebIFC.IFCRELAGGREGATES);
      console.log(`[IFC] Found ${aggLines.size()} IFCRELAGGREGATES`);

      for (let i = 0; i < aggLines.size(); i++) {
        try {
          const aggId = aggLines.get(i);
          const agg = this.ifcApi.GetLine(this.modelID, aggId, false);
          if (!agg) continue;

          const parentRef = agg.RelatingObject;
          if (!parentRef) continue;
          const parentId = typeof parentRef === 'object' ? parentRef.value : parentRef;
          if (!parentId || typeof parentId !== 'number') continue;

          const relatedObjects = agg.RelatedObjects;
          if (!relatedObjects) continue;
          const childArray = Array.isArray(relatedObjects) ? relatedObjects : [relatedObjects];

          const children: number[] = [];
          for (const child of childArray) {
            const childId = typeof child === 'object' ? child.value : child;
            if (!childId || typeof childId !== 'number') continue;
            this.assemblyParentIndex!.set(childId, parentId);
            children.push(childId);
          }
          this.assemblyChildrenIndex!.set(parentId, children);
        } catch { /* skip */ }
      }
      console.log(`[IFC] Assembly index: ${this.assemblyParentIndex.size} children → ${this.assemblyChildrenIndex.size} parents`);

      // 2. Build property index from IFCRELDEFINESBYPROPERTIES
      const relLines = this.ifcApi.GetLineIDsWithType(this.modelID, WebIFC.IFCRELDEFINESBYPROPERTIES);
      console.log(`[IFC] Found ${relLines.size()} IFCRELDEFINESBYPROPERTIES`);
      
      for (let i = 0; i < relLines.size(); i++) {
        try {
          const relId = relLines.get(i);
          const rel = this.ifcApi.GetLine(this.modelID, relId, false);
          if (!rel) continue;

          // Get the property set ID
          const psetRef = rel.RelatingPropertyDefinition;
          if (!psetRef) continue;
          const psetId = typeof psetRef === 'object' ? psetRef.value : psetRef;
          if (!psetId || typeof psetId !== 'number') continue;

          // Get all related objects
          const relatedObjects = rel.RelatedObjects;
          if (!relatedObjects) continue;
          
          const objArray = Array.isArray(relatedObjects) ? relatedObjects : [relatedObjects];
          
          for (const obj of objArray) {
            const objId = typeof obj === 'object' ? obj.value : obj;
            if (!objId || typeof objId !== 'number') continue;
            
            if (!this.propertyIndex!.has(objId)) {
              this.propertyIndex!.set(objId, []);
            }
            this.propertyIndex!.get(objId)!.push(psetId);
          }
        } catch { /* skip this relation */ }
      }

      // 3. Propagate: For each assembly parent, share its property sets with ALL children
      //    AND share children's property sets with siblings (for ASSEMBLY_POS pattern)
      for (const [parentId, children] of this.assemblyChildrenIndex!.entries()) {
        // Collect all pset IDs from parent AND all children
        const allPsetIds = new Set<number>();
        
        // Parent's own psets
        const parentPsets = this.propertyIndex!.get(parentId) || [];
        for (const pid of parentPsets) allPsetIds.add(pid);
        
        // All children's psets
        for (const childId of children) {
          const childPsets = this.propertyIndex!.get(childId) || [];
          for (const pid of childPsets) allPsetIds.add(pid);
        }
        
        // Now check which psets contain ASSEMBLY_POS and share them
        for (const psetId of allPsetIds) {
          try {
            const pset = this.ifcApi.GetLine(this.modelID, psetId, false);
            if (!pset || !pset.HasProperties) continue;
            
            const props = Array.isArray(pset.HasProperties) ? pset.HasProperties : [pset.HasProperties];
            let hasAssemblyProp = false;
            
            for (const propRef of props) {
              try {
                const propId = typeof propRef === 'object' ? propRef.value : propRef;
                if (!propId || typeof propId !== 'number') continue;
                const prop = this.ifcApi.GetLine(this.modelID, propId, false);
                if (prop && prop.Name?.value) {
                  const name = String(prop.Name.value).toLowerCase().replace(/[\s_-]/g, '');
                  if (name === 'assemblypos' || name === 'assemblymark') {
                    hasAssemblyProp = true;
                    break;
                  }
                }
              } catch { /* skip */ }
            }
            
            if (hasAssemblyProp) {
              // Share this pset with ALL children in the assembly
              for (const childId of children) {
                if (!this.propertyIndex!.has(childId)) {
                  this.propertyIndex!.set(childId, []);
                }
                const existing = this.propertyIndex!.get(childId)!;
                if (!existing.includes(psetId)) {
                  existing.push(psetId);
                }
              }
              // Also share with parent
              if (!this.propertyIndex!.has(parentId)) {
                this.propertyIndex!.set(parentId, []);
              }
              const parentExisting = this.propertyIndex!.get(parentId)!;
              if (!parentExisting.includes(psetId)) {
                parentExisting.push(psetId);
              }
            }
          } catch { /* skip */ }
        }
      }
      
      console.log(`[IFC] Property index built: ${this.propertyIndex.size} elements indexed`);
    } catch (err) {
      console.error('[IFC] Property index build error:', err);
    }
  }

  showLabelAtPoint(expressId: number, text: string, point: THREE.Vector3, type: LabelType): void {
    this.removeLabelForElement(expressId);

    const div = document.createElement('div');
    div.className = `ifc-label ifc-label-${type}`;
    
    const typeLabel = type === 'partMark' ? 'Part' : type === 'assemblyMark' ? 'Assy' : 'Bolt';
    div.innerHTML = `<span class="ifc-label-type">${typeLabel}</span><span class="ifc-label-value">${text}</span>`;

    const label = new CSS2DObject(div);
    label.position.copy(point);
    this.scene.add(label);
    this.labels.set(expressId, label);
    this.requestRender();
  }

  removeLabelForElement(expressId: number): void {
    const label = this.labels.get(expressId);
    if (label) {
      this.scene.remove(label);
      this.labels.delete(expressId);
      this.requestRender();
    }
  }

  removeAllLabels(): void {
    this.labels.forEach((label) => this.scene.remove(label));
    this.labels.clear();
    this.requestRender();
  }

  setLabelType(type: LabelType): void {
    this.currentLabelType = type;
  }

  onElementClick(callback: (info: ElementInfo) => void): void {
    this.onClickCallback = callback;
  }

  resetView(): void {
    this.switchToPersp();
    this.clearClipPlanes();
    this.fitToScene();
  }

  getGrids(): GridInfo[] {
    return this.grids;
  }

  getAllGridAxes(): GridAxisInfo[] {
    // Deduplicate axes by name (same axis appears in multiple grids)
    const seen = new Map<string, GridAxisInfo>();
    for (const grid of this.grids) {
      for (const axis of [...grid.uAxes, ...grid.vAxes]) {
        if (!seen.has(axis.name)) {
          seen.set(axis.name, axis);
        }
      }
    }
    // Sort: numbers first (sorted numerically), then letters
    const axes = Array.from(seen.values());
    axes.sort((a, b) => {
      const aNum = parseFloat(a.name);
      const bNum = parseFloat(b.name);
      const aIsNum = !isNaN(aNum);
      const bIsNum = !isNaN(bNum);
      if (aIsNum && bIsNum) return aNum - bNum;
      if (aIsNum && !bIsNum) return -1;
      if (!aIsNum && bIsNum) return 1;
      return a.name.localeCompare(b.name);
    });
    return axes;
  }

  private parseGrids(): void {
    try {
      const gridLines = this.ifcApi.GetLineIDsWithType(this.modelID, WebIFC.IFCGRID);
      console.log(`[IFC] Found ${gridLines.size()} IFCGRID entities`);

      for (let i = 0; i < gridLines.size(); i++) {
        try {
          const gridId = gridLines.get(i);
          const grid = this.ifcApi.GetLine(this.modelID, gridId, false);
          if (!grid) continue;

          const gridName = grid.Name?.value || `Grid ${i + 1}`;
          
          // Get grid placement for elevation
          let elevation = 0;
          try {
            const placementRef = grid.ObjectPlacement;
            if (placementRef) {
              const placementId = typeof placementRef === 'object' ? placementRef.value : placementRef;
              if (placementId) {
                const placement = this.ifcApi.GetLine(this.modelID, placementId, false);
                if (placement?.RelativePlacement) {
                  const rpId = typeof placement.RelativePlacement === 'object' ? placement.RelativePlacement.value : placement.RelativePlacement;
                  if (rpId) {
                    const rp = this.ifcApi.GetLine(this.modelID, rpId, false);
                    if (rp?.Location) {
                      const locId = typeof rp.Location === 'object' ? rp.Location.value : rp.Location;
                      if (locId) {
                        const loc = this.ifcApi.GetLine(this.modelID, locId, false);
                        if (loc?.Coordinates) {
                          const coords = loc.Coordinates;
                          if (Array.isArray(coords) && coords.length >= 3) {
                            elevation = typeof coords[2] === 'object' ? coords[2].value : coords[2];
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch { /* ignore placement errors */ }

          // Parse U axes (typically numbered: 1, 2, 3...)
          const uAxes: GridAxisInfo[] = [];
          const uAxisRefs = grid.UAxes;
          if (uAxisRefs) {
            const uArray = Array.isArray(uAxisRefs) ? uAxisRefs : [uAxisRefs];
            for (const ref of uArray) {
              const axisInfo = this.parseGridAxis(ref, gridName, elevation);
              if (axisInfo) uAxes.push(axisInfo);
            }
          }

          // Parse V axes (typically lettered: A, B, C...)
          const vAxes: GridAxisInfo[] = [];
          const vAxisRefs = grid.VAxes;
          if (vAxisRefs) {
            const vArray = Array.isArray(vAxisRefs) ? vAxisRefs : [vAxisRefs];
            for (const ref of vArray) {
              const axisInfo = this.parseGridAxis(ref, gridName, elevation);
              if (axisInfo) vAxes.push(axisInfo);
            }
          }

          this.grids.push({ name: gridName, elevation, uAxes, vAxes });
          console.log(`[IFC] Grid "${gridName}" elevation=${elevation}: ${uAxes.length} U-axes, ${vAxes.length} V-axes`);
        } catch (err) {
          console.error('[IFC] Grid parse error:', err);
        }
      }
    } catch (err) {
      console.error('[IFC] Grid system parse error:', err);
    }
  }

  private parseGridAxis(ref: any, gridName: string, elevation: number): GridAxisInfo | null {
    try {
      const axisId = typeof ref === 'object' ? ref.value : ref;
      if (!axisId) return null;

      const axis = this.ifcApi.GetLine(this.modelID, axisId, false);
      if (!axis) return null;

      const name = axis.AxisTag?.value || axis.AxisTag || '';

      // Get the curve (AxisCurve)
      const curveRef = axis.AxisCurve;
      if (!curveRef) return null;
      const curveId = typeof curveRef === 'object' ? curveRef.value : curveRef;
      if (!curveId) return null;

      const curve = this.ifcApi.GetLine(this.modelID, curveId, false);
      if (!curve) return null;

      // Get points from IFCINDEXEDPOLYCURVE -> IFCCARTESIANPOINTLIST2D
      let points: number[][] = [];
      const pointsRef = curve.Points;
      if (pointsRef) {
        const pointsId = typeof pointsRef === 'object' ? pointsRef.value : pointsRef;
        if (pointsId) {
          const pointList = this.ifcApi.GetLine(this.modelID, pointsId, false);
          if (pointList?.CoordList) {
            const coordList = pointList.CoordList;
            if (Array.isArray(coordList)) {
              for (const pt of coordList) {
                if (Array.isArray(pt) && pt.length >= 2) {
                  const x = typeof pt[0] === 'object' ? pt[0].value : pt[0];
                  const y = typeof pt[1] === 'object' ? pt[1].value : pt[1];
                  points.push([x, y]);
                }
              }
            }
          }
        }
      }

      if (points.length < 2) return null;

      const p1 = points[0];
      const p2 = points[points.length - 1];

      // Determine direction: if X is nearly constant -> vertical (section along X)
      // if Y is nearly constant -> horizontal (section along Y)
      const dx = Math.abs(p2[0] - p1[0]);
      const dy = Math.abs(p2[1] - p1[1]);
      const direction: 'vertical' | 'horizontal' = dy > dx ? 'vertical' : 'horizontal';
      const position = direction === 'vertical' ? p1[0] : p1[1];

      return {
        name,
        direction,
        position,
        start: new THREE.Vector2(p1[0], p1[1]),
        end: new THREE.Vector2(p2[0], p2[1]),
        gridName,
        gridElevation: elevation,
      };
    } catch {
      return null;
    }
  }

  private switchToOrtho(): void {
    if (this.isOrtho) return;
    this.isOrtho = true;
    this.activeCamera = this.orthoCamera;
    this.controls.dispose();
    this.controls = new OrbitControls(this.orthoCamera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = true;
    this.controls.enableRotate = false; // Lock rotation in ortho view
  }

  private switchToPersp(): void {
    if (!this.isOrtho) return;
    this.isOrtho = false;
    this.activeCamera = this.perspCamera;
    this.controls.dispose();
    this.controls = new OrbitControls(this.perspCamera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = true;
    // Section'dan çıkınca dashed çizgileri kaldır
    this.hideGridLines();
  }

  private autoDetectGridScale(size: THREE.Vector3): number {
    if (this.gridScaleFactor !== null) return this.gridScaleFactor;
    
    const allAxes = this.getAllGridAxes();
    const vertAxes = allAxes.filter(a => a.direction === 'vertical');
    const horzAxes = allAxes.filter(a => a.direction === 'horizontal');
    
    let gridRange = 0;
    let modelRange = 0;
    
    if (vertAxes.length >= 2) {
      const positions = vertAxes.map(a => a.position);
      gridRange = Math.max(...positions) - Math.min(...positions);
      modelRange = size.x;
    } else if (horzAxes.length >= 2) {
      const positions = horzAxes.map(a => a.position);
      gridRange = Math.max(...positions) - Math.min(...positions);
      modelRange = size.z;
    }
    
    if (gridRange > 0 && modelRange > 0) {
      const rawRatio = gridRange / modelRange;
      if (rawRatio > 500) this.gridScaleFactor = 1000;
      else if (rawRatio > 50) this.gridScaleFactor = 100;
      else if (rawRatio > 5) this.gridScaleFactor = 10;
      else this.gridScaleFactor = 1;
    } else {
      this.gridScaleFactor = 1;
    }
    console.log(`[Grid] Auto-detected scale factor: ${this.gridScaleFactor}`);
    return this.gridScaleFactor;
  }

  private setupOrthoFrustum(viewWidth: number, viewHeight: number): void {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    // Add padding
    const padded = Math.max(viewWidth, viewHeight) * 1.3;
    const halfW = (padded * aspect) / 2;
    const halfH = padded / 2;
    this.orthoCamera.left = -halfW;
    this.orthoCamera.right = halfW;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.updateProjectionMatrix();
  }

  fitToGridAxis(axis: GridAxisInfo): void {
    const box = new THREE.Box3();
    this.meshes.forEach(({ mesh }) => box.expandByObject(mesh));
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const scale = this.autoDetectGridScale(size);
    const viewDistance = Math.max(size.x, size.y, size.z) * 2;

    // Switch to orthographic for section views
    this.switchToOrtho();

    // Clip depth in model units
    const clipD = this.clipDepthMm / scale;

    if (axis.direction === 'vertical') {
      // Vertical axis (1,2,3...) = constant X in IFC
      // Section view: look along X axis (perpendicular to the grid line)
      const axisX = axis.position / scale;
      this.setupOrthoFrustum(size.z, size.y);
      this.orthoCamera.position.set(axisX + viewDistance, center.y, center.z);
      this.controls.target.set(axisX, center.y, center.z);
      this.orthoCamera.up.set(0, 1, 0);

      // Clip planes: two planes facing each other at ±clipD from axisX
      this.clipPlanes = [
        new THREE.Plane(new THREE.Vector3(-1, 0, 0), axisX + clipD),  // +X side
        new THREE.Plane(new THREE.Vector3(1, 0, 0), -(axisX - clipD)), // -X side
      ];
    } else {
      // Horizontal axis (B, C...) = constant Y in IFC
      // In Three.js, IFC Y maps to Z  
      // Section view: look along Z axis (perpendicular to the grid line)
      const axisZ = axis.position / scale;
      this.setupOrthoFrustum(size.x, size.y);
      this.orthoCamera.position.set(center.x, center.y, axisZ + viewDistance);
      this.controls.target.set(center.x, center.y, axisZ);
      this.orthoCamera.up.set(0, 1, 0);

      // Clip planes along Z
      this.clipPlanes = [
        new THREE.Plane(new THREE.Vector3(0, 0, -1), axisZ + clipD),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -(axisZ - clipD)),
      ];
    }

    this.applyClipPlanes();
    this.controls.update();

    // Elevation grid lines for this vertical section
    this.showSectionGridLines('vertical', axis.direction, size, scale);
    console.log(`[Grid] Ortho section: axis "${axis.name}" pos=${(axis.position/scale).toFixed(2)} clipD=${clipD.toFixed(2)}`);
  }

  fitToElevation(elevation: number): void {
    const box = new THREE.Box3();
    this.meshes.forEach(({ mesh }) => box.expandByObject(mesh));
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const scale = this.autoDetectGridScale(size);
    const viewDistance = Math.max(size.x, size.y, size.z) * 2;

    // Switch to orthographic plan view
    this.switchToOrtho();
    this.setupOrthoFrustum(size.x, size.z);

    // IFC Z (elevation) maps to Three.js Y
    const elevY = elevation / scale;
    const clipD = this.clipDepthMm / scale;

    this.orthoCamera.position.set(center.x, elevY + viewDistance, center.z);
    this.controls.target.set(center.x, elevY, center.z);
    this.orthoCamera.up.set(0, 0, -1);

    // Clip planes along Y (height)
    this.clipPlanes = [
      new THREE.Plane(new THREE.Vector3(0, -1, 0), elevY + clipD),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -(elevY - clipD)),
    ];

    this.applyClipPlanes();
    this.controls.update();
    // Plan view — U/V akslarını göster
    this.showSectionGridLines('plan', 'vertical', size, scale);
    console.log(`[Grid] Ortho plan at elevation ${elevation}/${scale}=${elevY.toFixed(2)}`);
  }

  fitToPlanView(): void {
    const box = new THREE.Box3();
    this.meshes.forEach(({ mesh }) => box.expandByObject(mesh));
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const viewDistance = Math.max(size.x, size.y, size.z) * 2;

    this.switchToOrtho();
    this.setupOrthoFrustum(size.x, size.z);

    this.orthoCamera.position.set(center.x, center.y + viewDistance, center.z);
    this.controls.target.set(center.x, center.y, center.z);
    this.orthoCamera.up.set(0, 0, -1);

    this.clearClipPlanes();
    this.controls.update();
    console.log('[Grid] Ortho plan view (no clip)');
  }

  private applyClipPlanes(): void {
    this.meshes.forEach(({ mesh }) => {
      const mat = mesh.material as THREE.Material;
      mat.clippingPlanes = this.clipPlanes;
      mat.clipShadows = true;
      mat.needsUpdate = true;
    });
  }

  private clearClipPlanes(): void {
    this.clipPlanes = [];
    this.meshes.forEach(({ mesh }) => {
      const mat = mesh.material as THREE.Material;
      mat.clippingPlanes = null;
      mat.clipShadows = false;
      mat.needsUpdate = true;
    });
  }

  setClipDepth(depthMm: number): void {
    this.clipDepthMm = depthMm;
  }

  getClipDepth(): number {
    return this.clipDepthMm;
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.activeCamera);
    this.labelRenderer.render(this.scene, this.activeCamera);
  };

  requestRender = (): void => { /* no-op */ };

  /** Grid akslarını kesikli beyaz çizgiler olarak çiz */
  private showSectionGridLines(
    viewType: 'vertical' | 'plan',
    axisDir: 'vertical' | 'horizontal',
    size: THREE.Vector3,
    scale: number
  ): void {
    this.hideGridLines();

    const box = new THREE.Box3();
    this.meshes.forEach(({ mesh }) => box.expandByObject(mesh));
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const bmin = box.min;
    const bmax = box.max;
    const margin = Math.max(size.x, size.y, size.z) * 0.08;

    const makeMat = (color: number) => new THREE.LineDashedMaterial({
      color, dashSize: 0.35, gapSize: 0.18, linewidth: 1,
    });

    const addLine = (p1: THREE.Vector3, p2: THREE.Vector3, color: number) => {
      const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const line = new THREE.Line(geo, makeMat(color));
      line.computeLineDistances();
      this.scene.add(line);
      this.sectionGridObjects.push(line);
    };

    const addLabel = (pos: THREE.Vector3, text: string, color = '#ffffff') => {
      const div = document.createElement('div');
      div.style.cssText = [
        `color:${color}`,
        'font-family:Inter,monospace,sans-serif',
        'font-size:12px',
        'font-weight:600',
        'padding:0 5px',
        'pointer-events:none',
        'white-space:nowrap',
        'text-shadow:0 1px 4px rgba(0,0,0,0.9)',
      ].join(';');
      div.textContent = text;
      const lbl = new CSS2DObject(div);
      lbl.position.copy(pos);
      this.scene.add(lbl);
      this.sectionGridObjects.push(lbl);
    };

    if (viewType === 'vertical') {
      // Yatay elevation cizgileri — gercek BB sinirlari
      let hMin: number, hMax: number;
      if (axisDir === 'vertical') {
        hMin = bmin.z - margin; hMax = bmax.z + margin;
      } else {
        hMin = bmin.x - margin; hMax = bmax.x + margin;
      }

      const seenElev = new Set<string>();
      for (const grid of this.grids) {
        const elevM = grid.elevation / scale;
        const key = elevM.toFixed(2);
        if (seenElev.has(key)) continue;
        seenElev.add(key);

        const elevLabel = grid.elevation / 1000;
        const sign = elevLabel >= 0 ? '+' : '';
        const txt = `${sign}${elevLabel.toFixed(2)}`;

        let p1: THREE.Vector3, p2: THREE.Vector3;
        if (axisDir === 'vertical') {
          p1 = new THREE.Vector3(center.x, elevM, hMin);
          p2 = new THREE.Vector3(center.x, elevM, hMax);
        } else {
          p1 = new THREE.Vector3(hMin, elevM, center.z);
          p2 = new THREE.Vector3(hMax, elevM, center.z);
        }
        addLine(p1, p2, 0xffffff);
        addLabel(p1, txt);
        addLabel(p2, txt);
      }

      // Dikey aks cizgileri — yükseklik = grid elevasyonlarının aralığı
      const elevValues = this.grids.map(g => g.elevation / scale);
      const vBot = (elevValues.length > 0 ? Math.min(...elevValues) : bmin.y) - margin * 0.5;
      const vTop = (elevValues.length > 0 ? Math.max(...elevValues) : bmax.y) + margin * 0.5;
      const allAxes = this.getAllGridAxes();
      const perpAxes = axisDir === 'vertical'
        ? allAxes.filter(a => a.direction === 'horizontal')
        : allAxes.filter(a => a.direction === 'vertical');

      for (const ax of perpAxes) {
        const pos = ax.position / scale;
        let p1: THREE.Vector3, p2: THREE.Vector3;
        if (axisDir === 'vertical') {
          p1 = new THREE.Vector3(center.x, vBot, pos);
          p2 = new THREE.Vector3(center.x, vTop, pos);
        } else {
          p1 = new THREE.Vector3(pos, vBot, center.z);
          p2 = new THREE.Vector3(pos, vTop, center.z);
        }
        addLine(p1, p2, 0x888888);
        addLabel(p2, ax.name, '#aaaaaa');
        addLabel(p1, ax.name, '#aaaaaa');
      }

    } else {
      // Plan gorunum — U ve V akslar
      for (const ax of this.getAllGridAxes()) {
        const pos = ax.position / scale;
        let p1: THREE.Vector3, p2: THREE.Vector3;
        if (ax.direction === 'vertical') {
          p1 = new THREE.Vector3(pos, center.y, bmin.z - margin);
          p2 = new THREE.Vector3(pos, center.y, bmax.z + margin);
        } else {
          p1 = new THREE.Vector3(bmin.x - margin, center.y, pos);
          p2 = new THREE.Vector3(bmax.x + margin, center.y, pos);
        }
        addLine(p1, p2, 0xaaaaaa);
        addLabel(p1, ax.name, '#cccccc');
        addLabel(p2, ax.name, '#cccccc');
      }
    }
  }

  /** Tüm section grid çizgilerini ve etiketlerini kaldır */
  hideGridLines(): void {
    for (const obj of this.sectionGridObjects) {
      this.scene.remove(obj);
      if ((obj as any).geometry) (obj as any).geometry.dispose();
      if ((obj as any).material) (obj as any).material.dispose();
    }
    this.sectionGridObjects = [];
  }

  private handleResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const aspect = width / height;
    
    // Update perspective camera
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();
    
    // Update orthographic camera if active
    if (this.isOrtho) {
      const halfH = (this.orthoCamera.top - this.orthoCamera.bottom) / 2;
      const halfW = halfH * aspect;
      this.orthoCamera.left = -halfW;
      this.orthoCamera.right = halfW;
      this.orthoCamera.updateProjectionMatrix();
    }
    
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  };

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.container.removeEventListener('click', this.handleClick);
    this.container.removeEventListener('contextmenu', this.handleContextMenu);
    this.container.removeEventListener('touchstart', this.handleTouchStart);
    this.container.removeEventListener('touchmove', this.handleTouchMove);
    this.container.removeEventListener('touchend', this.handleTouchEnd);
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.closeContextMenu();
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.removeAllLabels();
    this.clearHighlight();
    this.controls.dispose();
    this.renderer.dispose();
    
    try {
      this.ifcApi.CloseModel(this.modelID);
    } catch { /* ignore */ }

    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    if (this.labelRenderer.domElement.parentNode) {
      this.labelRenderer.domElement.parentNode.removeChild(this.labelRenderer.domElement);
    }
  }
}
