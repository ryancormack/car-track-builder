// renderer/index.ts — Three.js Renderer that owns the scene, camera, lights,
// and the runtime track/car/ghost groups. Mesh construction is delegated to
// the meshes/car/controls submodules.

import * as THREE from 'three';
import { PIECES, isPieceId, resolvePathLocal } from '../pieces/index.js';
import { COLORS } from './colors.js';
import { buildPieceMesh, buildGhostPiece, buildStartTower } from './meshes.js';
import { buildCar, placeCar } from './car.js';
import { installCameraControls } from './controls.js';
import type { CameraControlHost } from './controls.js';
import type { Track } from '../track.js';
import type { PieceId } from '../types.js';
import type { TrackFrame } from '../pieces/frames.js';

export class Renderer implements CameraControlHost {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.OrthographicCamera;

  cameraTarget: THREE.Vector3;
  cameraDistance: number;
  cameraAzimuth: number;
  cameraPolar: number;
  cameraZoom: number;
  frustumSize: number;

  trackGroup: THREE.Group;
  ghostGroup: THREE.Group;
  startGroup: THREE.Group;
  car: THREE.Group;

  private _highlightedIndex: number | null = null;
  private _savedEmissives: Map<THREE.Mesh, { intensity: number; color: THREE.Color }> = new Map();

  private _launchAnim: {
    startTime: number;
    duration: number;
  } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    // No opaque background: the canvas is transparent so the CSS stage gradient
    // shows through behind the scene. Fog fades distant geometry into it.
    this.scene.fog = new THREE.Fog(COLORS.bg, 20, 54);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    // True isometric: 45° azimuth, atan(1/√2) ≈ 35.26° polar elevation.
    this.cameraTarget = new THREE.Vector3(0, 0, 0);
    this.cameraDistance = 14;
    this.cameraAzimuth = Math.PI / 4;
    this.cameraPolar = Math.atan(1 / Math.SQRT2);
    this.cameraZoom = 1.0;
    this.frustumSize = 8;

    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    this.camera = new THREE.OrthographicCamera(
      -this.frustumSize * aspect, this.frustumSize * aspect,
      this.frustumSize, -this.frustumSize, 0.1, 200,
    );
    this.updateCamera();

    this._addLights();
    this._addGround();

    this.trackGroup = new THREE.Group(); this.scene.add(this.trackGroup);
    this.ghostGroup = new THREE.Group(); this.scene.add(this.ghostGroup);
    this.startGroup = new THREE.Group(); this.scene.add(this.startGroup);

    this.car = buildCar();
    this.car.visible = false;
    this.scene.add(this.car);

    installCameraControls(this);
    this._installResize();
  }

  // -------- public API --------

  setCar(visible: boolean, sample: TrackFrame | null = null): void {
    this.car.visible = !!visible;
    if (visible && sample) placeCar(this.car, sample);
  }

  rebuildTrack(track: Track): void {
    this._clearGroup(this.trackGroup);
    this._clearGroup(this.startGroup);
    this.startGroup.add(buildStartTower(track.startState, track.dropHeight));
    for (let i = 0; i < track.pieces.length; i++) {
      const id = track.pieces[i];
      const p = PIECES[id];
      const entry = track.entryStateAt(i);
      const resolvedPath = resolvePathLocal(track.pieces, i);
      const mesh = buildPieceMesh(p, entry, resolvedPath);
      this.trackGroup.add(mesh);
    }
    this._recenterCamera(track);
  }

  rebuildGhost(track: Track, pieceId: string | null): void {
    this._clearGroup(this.ghostGroup);
    if (!pieceId || !isPieceId(pieceId)) return;
    if (!track.canAdd(pieceId)) return;
    // Build a hypothetical piece list to resolve the ghost's path with neighbor context.
    const hypotheticalPieces = [...track.pieces, pieceId as PieceId];
    const ghostIndex = hypotheticalPieces.length - 1;
    const resolvedPath = resolvePathLocal(hypotheticalPieces, ghostIndex);
    this.ghostGroup.add(buildGhostPiece(resolvedPath, track.cursorState()));
  }

  clearGhost(): void { this._clearGroup(this.ghostGroup); }

  pickPiece(event: MouseEvent): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    const intersects = raycaster.intersectObjects(this.trackGroup.children, true);
    if (intersects.length === 0) return null;
    // Walk up the parent chain from the hit object to find the direct child of trackGroup.
    // This is O(depth) instead of O(n*m) traversal.
    let obj: THREE.Object3D | null = intersects[0].object;
    while (obj && obj.parent !== this.trackGroup) {
      obj = obj.parent;
    }
    if (!obj) return null;
    const index = this.trackGroup.children.indexOf(obj);
    return index >= 0 ? index : null;
  }

  highlightPiece(index: number | null): void {
    // Restore previously highlighted piece
    if (this._highlightedIndex !== null) {
      for (const [mesh, saved] of this._savedEmissives) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = saved.intensity;
        mat.emissive.copy(saved.color);
      }
      this._savedEmissives.clear();
      this._highlightedIndex = null;
    }
    if (index === null || index < 0 || index >= this.trackGroup.children.length) return;
    this._highlightedIndex = index;
    const group = this.trackGroup.children[index];
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material;
        if (mat && !Array.isArray(mat) && (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          const stdMat = mat as THREE.MeshStandardMaterial;
          this._savedEmissives.set(mesh, {
            intensity: stdMat.emissiveIntensity,
            color: stdMat.emissive.clone(),
          });
          stdMat.emissiveIntensity = stdMat.emissiveIntensity + 0.6;
          stdMat.emissive.set(0x44aaff);
        }
      }
    });
  }

  animateLauncher(): void {
    const plunger = this.startGroup.getObjectByName('plunger');
    if (!plunger) return;
    plunger.scale.y = 1;
    this._launchAnim = {
      startTime: performance.now() / 1000,
      duration: 0.5,
    };
  }

  /** Cancel any in-progress launch animation and reset the plunger to rest. */
  stopLauncher(): void {
    this._launchAnim = null;
    const plunger = this.startGroup.getObjectByName('plunger');
    if (plunger) plunger.scale.y = 1;
  }

  updateAnimations(_dt: number): void {
    if (!this._launchAnim) return;
    const plunger = this.startGroup.getObjectByName('plunger');
    if (!plunger) { this._launchAnim = null; return; }

    const now = performance.now() / 1000;
    const elapsed = now - this._launchAnim.startTime;
    const { duration } = this._launchAnim;

    if (elapsed >= duration) {
      plunger.scale.y = 1; // settle fully extended
      this._launchAnim = null;
      return;
    }

    // The green tower is a spring-loaded plunger: it presses straight down
    // (compress) then springs back up with a slight overshoot (the launch).
    const t = elapsed / duration;
    const pressFrac = 0.34;     // portion of the timeline spent pressing down
    const minScale = 0.4;       // how far it compresses
    let scaleY: number;
    if (t < pressFrac) {
      // Fast ease-in press downward.
      const p = t / pressFrac;
      const eased = p * p; // ease-in
      scaleY = 1 - (1 - minScale) * eased;
    } else {
      // Spring back up past 1 (overshoot), then settle to 1.
      const p = (t - pressFrac) / (1 - pressFrac); // 0..1
      // Damped sine overshoot: 0 at p=0, decays to 0 at p=1.
      const overshoot = Math.sin(p * Math.PI) * (1 - p) * 0.18;
      scaleY = minScale + (1 - minScale) * p + overshoot;
    }
    plunger.scale.y = scaleY;
  }

  render(): void { this.renderer.render(this.scene, this.camera); }

  // -------- camera helpers --------

  updateCamera(): void {
    const r = this.cameraDistance;
    const az = this.cameraAzimuth, po = this.cameraPolar;
    const x = r * Math.cos(po) * Math.cos(az);
    const z = r * Math.cos(po) * Math.sin(az);
    const y = r * Math.sin(po);
    this.camera.position.set(
      this.cameraTarget.x + x,
      this.cameraTarget.y + y,
      this.cameraTarget.z + z,
    );
    this.camera.lookAt(this.cameraTarget);
    this._updateFrustum();
  }

  _updateFrustum(): void {
    const aspect = this.canvas.clientWidth / Math.max(this.canvas.clientHeight, 1);
    const f = this.frustumSize / this.cameraZoom;
    this.camera.left = -f * aspect;
    this.camera.right = f * aspect;
    this.camera.top = f;
    this.camera.bottom = -f;
    this.camera.updateProjectionMatrix();
  }

  private _recenterCamera(track: Track): void {
    if (track.pieces.length === 0) {
      this.cameraTarget.set(0, 0, 0);
    } else {
      let cx = 0, cy = 0, cz = 0, n = 0;
      for (let i = 0; i <= track.pieces.length; i++) {
        const s = track.entryStateAt(i);
        cx += s.gx; cy += s.gy; cz += s.gz; n++;
      }
      this.cameraTarget.set(cx / n, cz / n, cy / n);
    }
    this.updateCamera();
  }

  // -------- internals --------

  private _addLights(): void {
    // Hemisphere gives a soft sky/ground gradient; a low ambient lifts shadows.
    this.scene.add(new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 0.9));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    const sun = new THREE.DirectionalLight(COLORS.sun, 1.6);
    sun.position.set(10, 18, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 3;
    sun.shadow.bias = -0.0004;
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(COLORS.rim, 0.5);
    rim.position.set(-8, 5, -10);
    this.scene.add(rim);
  }

  private _addGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1.0, metalness: 0.0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(120, 120, COLORS.gridCenter, COLORS.grid);
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.5;
    grid.position.y = 0;
    this.scene.add(grid);
  }

  private _clearGroup(group: THREE.Group): void {
    while (group.children.length) {
      const c = group.children.pop();
      if (!c) break;
      group.remove(c);
      c.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material;
        if (material) {
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
    }
  }

  private _installResize(): void {
    const parent = this.canvas.parentElement;
    const fit = () => {
      const w = this.canvas.clientWidth || parent?.clientWidth || 0;
      const h = this.canvas.clientHeight || parent?.clientHeight || 0;
      this.renderer.setSize(w, h, false);
      this._updateFrustum();
    };
    fit();
    window.addEventListener('resize', fit);
    if (parent) new ResizeObserver(fit).observe(parent);
  }
}
