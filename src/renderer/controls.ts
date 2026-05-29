// renderer/controls.ts — drag-to-pan, scroll-to-zoom, R-to-rotate.

import * as THREE from 'three';

/** The slice of the Renderer that the camera controls read and mutate. */
export interface CameraControlHost {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  cameraTarget: THREE.Vector3;
  cameraAzimuth: number;
  cameraZoom: number;
  frustumSize: number;
  updateCamera(): void;
  _updateFrustum(): void;
}

export function installCameraControls(host: CameraControlHost): void {
  const canvas = host.canvas;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    const panSpeed = (host.frustumSize / host.cameraZoom) /
                     Math.max(canvas.clientHeight, 1) * 2;
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    host.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    host.cameraTarget.addScaledVector(right, -dx * panSpeed);
    host.cameraTarget.addScaledVector(up, dy * panSpeed);
    host.updateCamera();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    host.cameraZoom = Math.max(0.3, Math.min(3.5, host.cameraZoom * factor));
    host._updateFrustum();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'r' || e.key === 'R') {
      host.cameraAzimuth += Math.PI / 8;
      host.updateCamera();
    }
  });
}
