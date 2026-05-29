// editor.ts — Build-mode UI: palette buttons, hover ghost preview, undo/clear.

import { PIECES, PALETTE_ORDER } from './pieces/index.js';
import type { Track } from './track.js';
import type { Renderer } from './renderer/index.js';
import type { PieceId } from './types.js';
import type { StatusKind } from './app/hud.js';

export interface EditorOptions {
  track: Track;
  renderer: Renderer;
  paletteEl: HTMLElement;
  statusEl: HTMLElement | null;
  onChange?: () => void;
}

export class Editor {
  track: Track;
  renderer: Renderer;
  paletteEl: HTMLElement;
  statusEl: HTMLElement | null;
  onChange: () => void;
  enabled = true;
  buttons: HTMLButtonElement[] = [];
  private _statusTimer?: ReturnType<typeof setTimeout>;

  constructor({ track, renderer, paletteEl, statusEl, onChange }: EditorOptions) {
    this.track = track;
    this.renderer = renderer;
    this.paletteEl = paletteEl;
    this.statusEl = statusEl;
    this.onChange = onChange ?? (() => {});
    this._build();
  }

  private _build(): void {
    this.paletteEl.innerHTML = '';
    this.buttons = [];
    for (const id of PALETTE_ORDER) {
      const piece = PIECES[id];
      if (!piece || piece.hidden) continue;

      const btn = document.createElement('button');
      btn.className = 'piece-btn';
      if (piece.featured) btn.classList.add('featured');
      if (piece.boost) btn.classList.add('boost');
      btn.dataset.pieceId = id;
      btn.innerHTML = `
        <span class="icon">${piece.icon}</span>
        <span class="label">${piece.name}</span>
      `;

      btn.addEventListener('mouseenter', () => this._hover(id));
      btn.addEventListener('mouseleave', () => this._unhover());
      btn.addEventListener('click', () => this._add(id));
      this.paletteEl.appendChild(btn);
      this.buttons.push(btn);
    }
    this._refreshButtons();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    for (const b of this.buttons) b.disabled = !on;
    if (!on) this.renderer.clearGhost();
    this._refreshButtons();
  }

  private _hover(id: PieceId): void {
    if (!this.enabled) return;
    if (!this.track.canAdd(id)) return;
    this.renderer.rebuildGhost(this.track, id);
  }

  private _unhover(): void {
    this.renderer.clearGhost();
  }

  private _add(id: PieceId): void {
    if (!this.enabled) return;
    if (!this.track.canAdd(id)) {
      this._setStatus('Track ends at the Finish line — undo to extend.', 'err');
      return;
    }
    this.track.addPiece(id);
    this.renderer.rebuildTrack(this.track);
    this.renderer.clearGhost();
    this._setStatus(`Added ${PIECES[id].name}.`, 'ok');
    this._refreshButtons();
    this.onChange();
  }

  undo(): void {
    const removed = this.track.undo();
    this.renderer.rebuildTrack(this.track);
    this.renderer.clearGhost();
    if (removed) {
      this._setStatus(`Removed ${PIECES[removed].name}.`, 'ok');
    } else {
      this._setStatus('Nothing to undo.', 'err');
    }
    this._refreshButtons();
    this.onChange();
  }

  clear(): void {
    this.track.clear();
    this.renderer.rebuildTrack(this.track);
    this.renderer.clearGhost();
    this._setStatus('Track cleared.', 'ok');
    this._refreshButtons();
    this.onChange();
  }

  refresh(): void {
    this.renderer.rebuildTrack(this.track);
    this._refreshButtons();
  }

  private _refreshButtons(): void {
    // Once a Finish line is placed, no more pieces can be added, so disable
    // the whole palette. (Undo/Clear are separate controls, not in this list.)
    const finished = this.track.hasFinish();
    for (const b of this.buttons) {
      b.disabled = !this.enabled || finished;
    }
  }

  private _setStatus(msg: string, kind: StatusKind = ''): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg;
    this.statusEl.className = 'status ' + kind;
    if (this._statusTimer) clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => {
      if (!this.statusEl) return;
      this.statusEl.textContent = '';
      this.statusEl.className = 'status';
    }, 2200);
  }
}
