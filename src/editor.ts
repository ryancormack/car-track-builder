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
  /** Called whenever the selected slot changes (null when nothing is selected). */
  onSelectionChange?: (sel: { index: number; name: string; isGap: boolean } | null) => void;
}

export class Editor {
  track: Track;
  renderer: Renderer;
  paletteEl: HTMLElement;
  statusEl: HTMLElement | null;
  onChange: () => void;
  onSelectionChange: (sel: { index: number; name: string; isGap: boolean } | null) => void;
  enabled = true;
  buttons: HTMLButtonElement[] = [];
  selectedIndex: number | null = null;
  /**
   * When building out a new section in the middle of the track, this tracks
   * the index of the last piece we inserted/replaced so the next palette click
   * inserts *after* it (chaining). Reset on deselect or mode change.
   */
  insertCursor: number | null = null;
  private _statusTimer?: ReturnType<typeof setTimeout>;

  constructor({ track, renderer, paletteEl, statusEl, onChange, onSelectionChange }: EditorOptions) {
    this.track = track;
    this.renderer = renderer;
    this.paletteEl = paletteEl;
    this.statusEl = statusEl;
    this.onChange = onChange ?? (() => {});
    this.onSelectionChange = onSelectionChange ?? (() => {});
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
    if (this.selectedIndex !== null) return; // in replace mode the ghost (append preview) is misleading
    if (!this.track.canAdd(id)) return;
    this.renderer.rebuildGhost(this.track, id);
  }

  private _unhover(): void {
    this.renderer.clearGhost();
  }

  private _add(id: PieceId): void {
    if (!this.enabled) return;
    if (this.selectedIndex !== null) {
      // Replace mode: swap (or fill) the selected slot.
      const wasGap = this.track.isEmptyAt(this.selectedIndex);
      const ok = this.track.replacePieceAt(this.selectedIndex, id);
      if (!ok) {
        this._setStatus('Cannot replace that piece.', 'err');
        return;
      }
      this.renderer.rebuildTrack(this.track);
      this.renderer.clearGhost();
      if (wasGap) {
        this._setStatus(`Placed ${PIECES[id].name} — keep clicking to build, or Rejoin when done.`, 'ok');
      } else {
        this._setStatus(`Replaced with ${PIECES[id].name}.`, 'ok');
      }
      // Set the insert cursor so the next palette click inserts AFTER this slot.
      // We clear selectedIndex manually (not via deselectPiece which would also
      // kill insertCursor) to transition into insert mode.
      const cursorPos = this.selectedIndex;
      this.selectedIndex = null;
      this.renderer.highlightPiece(null);
      this.insertCursor = cursorPos;
      this._refreshButtons();
      this.onChange();
      return;
    }
    if (this.insertCursor !== null) {
      // Insert mode: user is building out a new section from the insert cursor.
      const ok = this.track.insertPieceAfter(this.insertCursor, id);
      if (!ok) {
        this._setStatus('Cannot insert here.', 'err');
        return;
      }
      // Advance the cursor to the newly inserted piece.
      this.insertCursor = this.insertCursor + 1;
      this.renderer.rebuildTrack(this.track);
      this.renderer.clearGhost();
      this._setStatus(`Inserted ${PIECES[id].name} — keep clicking to extend, or Rejoin.`, 'ok');
      this._refreshButtons();
      this.onChange();
      return;
    }
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

  selectPiece(index: number | null): void {
    if (index === null || index < 0 || index >= this.track.pieces.length) {
      this.deselectPiece();
      return;
    }
    this.selectedIndex = index;
    this.insertCursor = null; // selecting a new piece exits insert mode
    this.renderer.highlightPiece(index);
    this._refreshButtons();
    const isGap = this.track.isEmptyAt(index);
    const name = isGap
      ? (this.track.isFilledGap(index) ? PIECES[this.track.pieces[index]].name + ' (unjoined)' : 'Gap')
      : PIECES[this.track.pieces[index]].name;
    this.onSelectionChange({ index, name, isGap });
  }

  deselectPiece(): void {
    this.selectedIndex = null;
    this.insertCursor = null;
    this.renderer.highlightPiece(null);
    this._refreshButtons();
    this.onSelectionChange(null);
  }

  /**
   * Delete the selected slot. By default this leaves a gap in place (the rest of
   * the track stays put) so the player can build something new there. With
   * closeGap=true it splices the slot out and the track compresses back.
   *
   * Note: emptyPieceAt() compresses anyway for a trailing or already-empty slot
   * (there's nothing to hold open), so we report the *actual* outcome rather
   * than assuming a gap was left.
   */
  deleteSelected(closeGap = false): void {
    if (this.selectedIndex === null) return;
    const index = this.selectedIndex;
    let removed: PieceId | undefined;
    let leftGap = false;
    if (closeGap) {
      removed = this.track.removePieceAt(index);
    } else {
      const wasEmpty = this.track.isEmptyAt(index);
      const trailing = index === this.track.pieces.length - 1;
      removed = this.track.emptyPieceAt(index);
      leftGap = !wasEmpty && !trailing;
    }
    this.renderer.rebuildTrack(this.track);
    this.renderer.clearGhost();
    if (removed) {
      const name = PIECES[removed].name;
      this._setStatus(leftGap ? `Cleared ${name} — fill the gap or play needs it complete.` : `Removed ${name}.`, 'ok');
    }
    this.deselectPiece();
    this._refreshButtons();
    this.onChange();
  }

  undo(): void {
    this.deselectPiece();
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
    this.deselectPiece();
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
    // Once a Finish line is placed, no more pieces can be appended, so the
    // palette is locked — UNLESS a slot is selected (replace mode) or the insert
    // cursor is active (building out a section), in which case palette is enabled.
    const lockAppend = this.track.hasFinish();
    const editing = this.selectedIndex !== null || this.insertCursor !== null;
    for (const b of this.buttons) {
      b.disabled = !this.enabled || (lockAppend && !editing);
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
