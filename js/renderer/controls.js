// renderer/controls.js — drag-to-pan, scroll-to-zoom, R-to-rotate.
//
// Operates on a host with the contract:
//   { canvas, camera, cameraTarget, cameraAzimuth, cameraZoom, frustumSize,
//     updateCamera(), _updateFrustum() }

import * as THREE from 'three';

export function installCameraControls(host) {
  const canvas = host.canvas;
  let dragging = false, lastX = 0, lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
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
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'r' || e.key === 'R') {
      host.cameraAzimuth += Math.PI / 8;
      host.updateCamera();
    }
  });
}
