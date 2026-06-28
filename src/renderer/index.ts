// renderer/index.ts — Three.js Renderer that owns the scene, camera, lights,
// and the runtime track/car/ghost groups. Mesh construction is delegated to
// the meshes/car/controls submodules.

import * as THREE from 'three';
import { PIECES, isPieceId, resolvePathLocal } from '../pieces/index.js';
import { COLORS } from './colors.js';
import { buildPieceMesh, buildGhostPiece, buildStartTower } from './meshes.js';
import { buildCar, placeCar } from './car.js';
import { buildLivingRoom, type RoomExtent } from './environment.js';
import { computeRoomLayout, type RoomLayout } from './roomLayout.js';
import { installCameraControls } from './controls.js';
import type { CameraControlHost } from './controls.js';
import type { Track } from '../track.js';
import type { PieceId } from '../types.js';
import type { TrackFrame } from '../pieces/frames.js';
import type { FailType } from '../physics.js';

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

  // Optional living-room backdrop. Hidden by default; toggled via
  // setEnvironmentVisible(). Repositioned to the track centroid on each rebuild.
  environment: THREE.Group;
  private _environmentVisible = false;
  private _ground!: THREE.Mesh;
  private _grid!: THREE.GridHelper;
  private _hemiLight!: THREE.HemisphereLight;
  private _outdoorFog!: THREE.Fog;
  private _indoorFog!: THREE.Fog;

  private _highlightedIndex: number | null = null;
  private _savedEmissives: Map<THREE.Mesh, { intensity: number; color: THREE.Color }> = new Map();
  private _currentRoomHalf: number = 16;
  private _sun!: THREE.DirectionalLight;

  private _launchAnim: {
    startTime: number;
    duration: number;
  } | null = null;

  private _wipeout: {
    type: FailType;
    elapsed: number;
    duration: number;
    startPos: THREE.Vector3;
    velocity: THREE.Vector3;
    particles: THREE.Mesh[];
  } | null = null;

  private _particleGeom: THREE.SphereGeometry;
  private _particleMat: THREE.MeshStandardMaterial;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    // No opaque background: the canvas is transparent so the CSS stage gradient
    // shows through behind the scene. Fog fades distant geometry into it.
    this._outdoorFog = new THREE.Fog(COLORS.bg, 20, 54);
    // Warm fog used while the living-room backdrop is shown, so the far walls
    // fade naturally rather than snapping to the cool stage gradient.
    this._indoorFog = new THREE.Fog(COLORS.roomFog, 26, 70);
    this.scene.fog = this._outdoorFog;

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

    // Optional living-room backdrop, hidden until toggled on.
    this.environment = buildLivingRoom();
    this.environment.visible = false;
    this.scene.add(this.environment);

    this.trackGroup = new THREE.Group(); this.scene.add(this.trackGroup);
    this.ghostGroup = new THREE.Group(); this.scene.add(this.ghostGroup);
    this.startGroup = new THREE.Group(); this.scene.add(this.startGroup);

    this.car = buildCar();
    this.car.visible = false;
    this.scene.add(this.car);

    this._particleGeom = new THREE.SphereGeometry(0.05, 6, 6);
    this._particleMat = new THREE.MeshStandardMaterial({
      color: 0xff8800,
      emissive: 0xff6600,
      emissiveIntensity: 0.8,
    });

    installCameraControls(this);
    this._installResize();
  }

  // -------- public API --------

  setCar(visible: boolean, sample: TrackFrame | null = null): void {
    this.car.visible = !!visible;
    if (visible && sample) placeCar(this.car, sample);
  }

  /**
   * Show or hide the living-room backdrop. When shown, the scene swaps to an
   * indoor palette (warm fog + warm hemisphere bounce) and the outdoor ground
   * plane and build grid are hidden (the room supplies its own floor). When
   * hidden, the original outdoor stage is restored — including the build grid,
   * which remains the snapping aid for Build mode.
   */
  setEnvironmentVisible(visible: boolean): void {
    this._environmentVisible = visible;
    this.environment.visible = visible;
    this.scene.fog = visible ? this._indoorFog : this._outdoorFog;
    if (visible) {
      this._hemiLight.color.set(COLORS.roomHemiSky);
      this._hemiLight.groundColor.set(COLORS.roomHemiGround);
    } else {
      this._hemiLight.color.set(COLORS.hemiSky);
      this._hemiLight.groundColor.set(COLORS.hemiGround);
    }
    this._ground.visible = !visible;
    this._grid.visible = !visible;
  }

  /** Whether the living-room backdrop is currently shown. */
  isEnvironmentVisible(): boolean {
    return this._environmentVisible;
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

  /**
   * Preview a ghost at an explicit INSERT index (gap-fill / insert mode). Unlike
   * `rebuildGhost` (which previews the append point), this anchors the ghost at
   * `track.computeEntryAt(insertIndex)` and resolves the path against a
   * hypothetical piece list with the piece spliced in at that index (so ramp
   * neighbour context is correct). It deliberately does NOT apply the `canAdd`
   * guard, because in insert mode the frozen suffix may still end in FINISH.
   */
  rebuildGhostAt(track: Track, pieceId: string | null, insertIndex: number): void {
    this._clearGroup(this.ghostGroup);
    if (!pieceId || !isPieceId(pieceId)) return;
    const hyp = [...track.pieces];
    hyp.splice(insertIndex, 0, pieceId as PieceId);
    const resolvedPath = resolvePathLocal(hyp, insertIndex);
    this.ghostGroup.add(buildGhostPiece(resolvedPath, track.computeEntryAt(insertIndex)));
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

  startWipeoutAnimation(failType: FailType, frame: TrackFrame | null): void {
    this.cleanupWipeout();
    const startPos = this.car.position.clone();
    let duration: number;
    let velocity: THREE.Vector3;

    switch (failType) {
      case 'rollback':
        duration = 2.0;
        if (frame) {
          velocity = new THREE.Vector3(frame.tangent.x, frame.tangent.y, frame.tangent.z).multiplyScalar(-1.5);
        } else {
          velocity = new THREE.Vector3(0, 0, -1.5);
        }
        break;
      case 'overspeed_corner':
        duration = 1.5;
        if (frame) {
          velocity = new THREE.Vector3(frame.side.x, frame.side.y, frame.side.z).multiplyScalar(3);
          velocity.y += 1.5;
        } else {
          velocity = new THREE.Vector3(3, 1.5, 0);
        }
        break;
      case 'fly_off':
        duration = 2.0;
        if (frame) {
          velocity = new THREE.Vector3(frame.tangent.x, frame.tangent.y, frame.tangent.z).multiplyScalar(2);
          velocity.y += 4;
        } else {
          velocity = new THREE.Vector3(0, 4, 2);
        }
        break;
      default: // stall, speed_gate
        duration = 1.0;
        velocity = new THREE.Vector3(0, 0.5, 0);
        break;
    }

    const particles: THREE.Mesh[] = [];
    if (failType === 'overspeed_corner') {
      for (let i = 0; i < 10; i++) {
        const p = new THREE.Mesh(this._particleGeom, this._particleMat.clone());
        p.position.copy(startPos);
        this.scene.add(p);
        particles.push(p);
      }
    }

    this._wipeout = {
      type: failType,
      elapsed: 0,
      duration,
      startPos,
      velocity,
      particles,
    };
  }

  updateWipeoutAnimation(dt: number): boolean {
    if (!this._wipeout) return false;
    const w = this._wipeout;
    w.elapsed += dt;

    if (w.elapsed >= w.duration) {
      this._removeParticles(w.particles);
      this._wipeout = null;
      return false;
    }

    const progress = w.elapsed / w.duration;

    switch (w.type) {
      case 'rollback': {
        // Slide backward and slow down, no gravity
        const slowdown = 1 - progress;
        const offset = w.velocity.clone().multiplyScalar(w.elapsed * slowdown);
        this.car.position.copy(w.startPos).add(offset);
        break;
      }
      case 'overspeed_corner': {
        // Apply gravity to velocity
        w.velocity.y -= 9.8 * dt;
        this.car.position.add(w.velocity.clone().multiplyScalar(dt));
        // Spin car
        this.car.rotateY(dt * 8);
        // Move particles outward and fade them
        for (let i = 0; i < w.particles.length; i++) {
          const p = w.particles[i];
          const angle = (i / w.particles.length) * Math.PI * 2;
          const spread = progress * 2;
          p.position.set(
            w.startPos.x + Math.cos(angle) * spread,
            w.startPos.y + (1 - progress) * 0.5,
            w.startPos.z + Math.sin(angle) * spread,
          );
          const scale = 1 - progress;
          p.scale.setScalar(Math.max(scale, 0.01));
        }
        break;
      }
      case 'fly_off': {
        // Ballistic arc with gravity
        w.velocity.y -= 9.8 * dt;
        this.car.position.add(w.velocity.clone().multiplyScalar(dt));
        // Slight spin
        this.car.rotateZ(dt * 2);
        break;
      }
      default: {
        // stall / speed_gate: small bounce up then settle
        const bounceHeight = Math.sin(progress * Math.PI) * 0.3;
        this.car.position.copy(w.startPos);
        this.car.position.y += bounceHeight;
        break;
      }
    }

    return true;
  }

  cleanupWipeout(): void {
    if (this._wipeout) {
      this._removeParticles(this._wipeout.particles);
      this._wipeout = null;
    }
  }

  private _removeParticles(particles: THREE.Mesh[]): void {
    for (const p of particles) {
      this.scene.remove(p);
      (p.material as THREE.Material).dispose();
    }
    particles.length = 0;
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

  /**
   * Smoothly lerp the camera target toward the car's current world position.
   * Call each frame during play mode to track the car.
   *
   * carPos is in grid space (x = forward, y = lateral, z = up), matching
   * `placeCar`. We apply the same axis swap onto Three.js space: grid z -> Y
   * (height), grid y -> Z (depth), grid x -> X.
   *
   * Horizontal tracking (X/Z) is responsive so the car stays framed as it drives
   * around the floor. The vertical component (Y) is damped much more gently so
   * the view holds a steadier height: on a loop or jump the car shoots up and
   * back down within a fraction of a second, and a slow vertical lerp barely
   * reacts to that transient instead of bobbing up and down with it, while still
   * easing toward sustained elevation changes (e.g. climbing a helix).
   */
  followCar(carPos: { x: number; y: number; z: number }, dt: number): void {
    const horizFactor = 1 - Math.exp(-4 * dt);   // responsive horizontal follow
    const vertFactor = 1 - Math.exp(-1.2 * dt);  // gentle, damped vertical follow
    this.cameraTarget.x += (carPos.x - this.cameraTarget.x) * horizFactor;
    this.cameraTarget.z += (carPos.y - this.cameraTarget.z) * horizFactor;
    this.cameraTarget.y += (carPos.z - this.cameraTarget.y) * vertFactor;
    this.updateCamera();
  }

  /**
   * Reset the camera target to the track centroid. Used when switching back to
   * build mode after play mode ends.
   */
  resetCameraToTrack(track: Track): void {
    this._recenterCamera(track);
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
    // One computed layout drives all three centres: the camera target, the room
    // anchor, and the wall-sizing centre are the SAME bounding-box midpoint, so
    // the track is always enclosed by the full padding (no dependence on a
    // drifting joint-mean). See roomLayout.ts.
    const layout = computeRoomLayout(track);
    this.cameraTarget.set(layout.centerX, layout.centerY, layout.centerZ);

    // Rebuild (if needed) the living-room environment sized to this layout.
    this._rebuildEnvironmentForTrack(layout);

    // Anchor the backdrop and the sun on the same horizontal centre so the room
    // frames the track and its shadows stay aligned regardless of track size or
    // position.
    if (this.environment) {
      this.environment.position.set(layout.centerX, 0, layout.centerZ);
    }
    this._recenterSun(layout.centerX, layout.centerZ);

    this.updateCamera();
  }

  /**
   * Recentre the sun (and its shadow target) on the track's horizontal centre.
   * The shadow frustum is sized in `_rebuildEnvironmentForTrack`; this keeps it
   * pointed at the track so off-origin tracks stay inside the shadow volume.
   * The light keeps its original relative offset so the lighting direction is
   * unchanged.
   */
  private _recenterSun(centerX: number, centerZ: number): void {
    this._sun.position.set(centerX + 10, 18, centerZ + 8);
    this._sun.target.position.set(centerX, 0, centerZ);
    this._sun.target.updateMatrixWorld();
  }

  /**
   * Rebuild the living-room environment to the supplied layout. Skips the
   * expensive dispose/rebuild when the computed roomHalf is unchanged since the
   * last call (the common case of recentering on an unchanged track).
   */
  private _rebuildEnvironmentForTrack(layout: RoomLayout): void {
    const { roomHalf, wallHeight } = layout;

    // Skip the expensive dispose/rebuild if the room size hasn't changed.
    if (roomHalf === this._currentRoomHalf) return;
    this._currentRoomHalf = roomHalf;

    const extent: RoomExtent = { roomHalf, wallHeight };

    // Update the indoor fog range to match the room size.
    this._indoorFog = new THREE.Fog(
      this._indoorFog.color,
      roomHalf * 1.5,
      roomHalf * 4.2,
    );
    if (this._environmentVisible) {
      this.scene.fog = this._indoorFog;
    }

    // Scale the directional light's shadow frustum to cover the room.
    const shadowExtent = Math.max(18, roomHalf * 1.2);
    this._sun.shadow.camera.left = -shadowExtent;
    this._sun.shadow.camera.right = shadowExtent;
    this._sun.shadow.camera.top = shadowExtent;
    this._sun.shadow.camera.bottom = -shadowExtent;
    this._sun.shadow.camera.far = Math.max(70, shadowExtent * 3);
    this._sun.shadow.camera.updateProjectionMatrix();

    // Remove the old environment and build a new one.
    const wasVisible = this.environment.visible;
    this.scene.remove(this.environment);
    this._disposeObject(this.environment);
    this.environment = buildLivingRoom(extent);
    this.environment.visible = wasVisible;
    this.scene.add(this.environment);
  }

  /** Dispose all geometry and materials reachable from an object. */
  private _disposeObject(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material;
      if (material) {
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else (material as THREE.Material).dispose?.();
      }
    });
  }

  // -------- internals --------

  private _addLights(): void {
    // Hemisphere gives a soft sky/ground gradient; a low ambient lifts shadows.
    this._hemiLight = new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 0.9);
    this.scene.add(this._hemiLight);
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
    // Add the light's target to the scene so it can be repositioned (and have
    // its world matrix tracked) when the track is recentred — see _recenterSun.
    this.scene.add(sun.target);
    this._sun = sun;

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
    this._ground = ground;

    const grid = new THREE.GridHelper(120, 120, COLORS.gridCenter, COLORS.grid);
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.5;
    grid.position.y = 0;
    this.scene.add(grid);
    this._grid = grid;
  }

  private _clearGroup(group: THREE.Group): void {
    while (group.children.length) {
      const c = group.children.pop();
      if (!c) break;
      group.remove(c);
      this._disposeObject(c);
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
