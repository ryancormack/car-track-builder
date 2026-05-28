// renderer/index.js — Three.js Renderer that owns the scene, camera, lights,
// and the runtime track/car/ghost groups. Mesh construction is delegated to
// the meshes/car/controls submodules.

import * as THREE from 'three';
import { PIECES } from '../pieces/index.js';
import { COLORS } from './colors.js';
import { buildPieceMesh, buildGhostPiece, buildStartTower } from './meshes.js';
import { buildCar, placeCar } from './car.js';
import { installCameraControls } from './controls.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.bg);
    this.scene.fog = new THREE.Fog(COLORS.bg, 18, 45);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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

  setCar(visible, sample = null) {
    this.car.visible = !!visible;
    if (visible && sample) placeCar(this.car, sample);
  }

  rebuildTrack(track) {
    this._clearGroup(this.trackGroup);
    this._clearGroup(this.startGroup);
    this.startGroup.add(buildStartTower(track.startState, track.dropHeight));
    for (let i = 0; i < track.pieces.length; i++) {
      const id = track.pieces[i];
      const p = PIECES[id]; if (!p) continue;
      const entry = track.entryStateAt(i);
      this.trackGroup.add(buildPieceMesh(p, entry));
    }
    this._recenterCamera(track);
  }

  rebuildGhost(track, pieceId) {
    this._clearGroup(this.ghostGroup);
    if (!pieceId) return;
    const piece = PIECES[pieceId];
    if (!piece || !track.canAdd(pieceId)) return;
    this.ghostGroup.add(buildGhostPiece(piece, track.cursorState()));
  }

  clearGhost() { this._clearGroup(this.ghostGroup); }

  render() { this.renderer.render(this.scene, this.camera); }

  // -------- camera helpers --------

  updateCamera() {
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

  _updateFrustum() {
    const aspect = this.canvas.clientWidth / Math.max(this.canvas.clientHeight, 1);
    const f = this.frustumSize / this.cameraZoom;
    this.camera.left = -f * aspect;
    this.camera.right = f * aspect;
    this.camera.top = f;
    this.camera.bottom = -f;
    this.camera.updateProjectionMatrix();
  }

  _recenterCamera(track) {
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

  _addLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(COLORS.sun, 1.1);
    sun.position.set(8, 16, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(COLORS.rim, 0.35);
    rim.position.set(-6, 4, -8);
    this.scene.add(rim);
  }

  _addGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(60, 60, COLORS.grid, COLORS.grid);
    grid.position.y = 0;
    this.scene.add(grid);
  }

  _clearGroup(group) {
    while (group.children.length) {
      const c = group.children.pop();
      group.remove(c);
      c.traverse?.((obj) => {
        obj.geometry?.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    }
  }

  _installResize() {
    const fit = () => {
      const w = this.canvas.clientWidth || this.canvas.parentElement.clientWidth;
      const h = this.canvas.clientHeight || this.canvas.parentElement.clientHeight;
      this.renderer.setSize(w, h, false);
      this._updateFrustum();
    };
    fit();
    window.addEventListener('resize', fit);
    new ResizeObserver(fit).observe(this.canvas.parentElement);
  }
}
