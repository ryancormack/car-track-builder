// renderer/index.ts — Three.js Renderer that owns the scene, camera, lights,
// and the runtime track/car/ghost groups. Mesh construction is delegated to
// the meshes/car/controls submodules.

import * as THREE from 'three';
import { PIECES, isPieceId } from '../pieces/index.js';
import { COLORS } from './colors.js';
import { buildPieceMesh, buildGhostPiece, buildStartTower } from './meshes.js';
import { buildCar, placeCar } from './car.js';
import { installCameraControls } from './controls.js';
import type { CameraControlHost } from './controls.js';
import type { Track } from '../track.js';
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
      this.trackGroup.add(buildPieceMesh(p, entry));
    }
    this._recenterCamera(track);
  }

  rebuildGhost(track: Track, pieceId: string | null): void {
    this._clearGroup(this.ghostGroup);
    if (!pieceId || !isPieceId(pieceId)) return;
    if (!track.canAdd(pieceId)) return;
    this.ghostGroup.add(buildGhostPiece(PIECES[pieceId], track.cursorState()));
  }

  clearGhost(): void { this._clearGroup(this.ghostGroup); }

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
