// editor.ts -- Build-mode UI: palette buttons, hover ghost preview, undo/clear.

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
  onSelectionChange?: (sel: { index: number; name: string } | null) => void;
}

export class Editor {
  track: Track;
  renderer: Renderer;
  paletteEl: HTMLElement;
  statusEl: HTMLElement | null;
  onChange: () => void;
  onSelectionChange: (sel: { index: number; name: string } | null) => void;
  enabled = true;
  buttons: HTMLButtonElement[] = [];
  selectedIndex: number | null = null;
  /**
   * When building out a new section in the middle of the track, this tracks
   * the index of the last piece we inserted/replaced so the next palette click
   * inserts *after* it (chaining). Reset on deselect or mode change.
   */
  insertCursor: number | null = null;
  /**
   * The highest index that is NOT part of the current insert session — the
   * floor below which insert-mode undo must not delete. Set when entering
   * insert mode (delete or replace), cleared on (de)select.
   */
  insertAnchor: number | null = null;
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
    if (this.insertCursor !== null) {
      // Insert (gap-fill) mode: preview the piece at the insert location. Do NOT
      // gate on canAdd — the frozen suffix may still end in FINISH (canAdd would
      // be false) yet we must still show a ghost at the gap.
      this.renderer.rebuildGhostAt(this.track, id, this.insertCursor + 1);
      return;
    }
    if (!this.track.canAdd(id)) return;
    this.renderer.rebuildGhost(this.track, id);
  }

  private _unhover(): void {
    this.renderer.clearGhost();
  }

  private _add(id: PieceId): void {
    if (!this.enabled) return;
    if (this.selectedIndex !== null) {
      // Replace mode: swap the selected piece.
      const ok = this.track.replaceAt(this.selectedIndex, id);
      if (!ok) {
        this._setStatus(this._collisionMessage('Cannot replace that piece.'), 'err');
        return;
      }
      this.renderer.rebuildTrack(this.track);
      this.renderer.clearGhost();
      this._setStatus(`Replaced with ${PIECES[id].name}.`, 'ok');
      // Set the insert cursor so the next palette click inserts AFTER this slot.
      const cursorPos = this.selectedIndex;
      this.selectedIndex = null;
      this.renderer.highlightPiece(null);
      this.insertCursor = cursorPos;
      this.insertAnchor = cursorPos;
      this._refreshButtons();
      this.onChange();
      return;
    }
    if (this.insertCursor !== null) {
      // Insert mode: user is building out a new section from the insert cursor.
      const insertIdx = this.insertCursor + 1;
      const ok = this.track.insertAt(insertIdx, id);
      if (!ok) {
        this._setStatus(this._collisionMessage('Cannot insert here.'), 'err');
        return;
      }
      // Advance the cursor to the newly inserted piece.
      this.insertCursor = insertIdx;
      this.renderer.rebuildTrack(this.track);
      this.renderer.clearGhost();
      this._setStatus(`Inserted ${PIECES[id].name} - keep clicking to extend, or Rejoin.`, 'ok');
      this._refreshButtons();
      this.onChange();
      return;
    }
    if (!this.track.canAdd(id)) {
      this._setStatus('Track ends at the Finish line - undo to extend.', 'err');
      return;
    }
    const ok = this.track.addPiece(id);
    if (!ok) {
      this._setStatus(this._collisionMessage('Cannot add that piece.'), 'err');
      return;
    }
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
    this.insertAnchor = null;
    this.renderer.highlightPiece(index);
    this._refreshButtons();
    const name = PIECES[this.track.pieces[index]].name;
    this.onSelectionChange({ index, name });
  }

  deselectPiece(): void {
    this.selectedIndex = null;
    this.insertCursor = null;
    this.insertAnchor = null;
    this.renderer.highlightPiece(null);
    this._refreshButtons();
    this.onSelectionChange(null);
  }

  /**
   * Delete the selected piece. The piece is removed from the track entirely.
   * We then drop into insert mode at the gap so the user can build new track in
   * its place; the downstream stays frozen until Rejoin.
   */
  deleteSelected(): void {
    if (this.selectedIndex === null) return;
    const index = this.selectedIndex;
    const removed = this.track.deleteAt(index);
    if (!removed) { this.deselectPiece(); return; }
    // Enter insert mode positioned at the gap (next palette click inserts here).
    this.selectedIndex = null;
    this.renderer.highlightPiece(null);
    this.insertCursor = index - 1;
    this.insertAnchor = index - 1;
    this.renderer.rebuildTrack(this.track);
    this.renderer.clearGhost();
    this._setStatus(`Removed ${PIECES[removed].name} — build into the gap or Rejoin.`, 'ok');
    this._refreshButtons();
    this.onChange();
  }

  undo(): void {
    // Insert (gap-fill) mode: undo must affect the piece the user just laid into
    // the gap, NOT the frozen end of the track (e.g. FINISH). Branch BEFORE
    // deselectPiece() so the insert context (insertCursor / insertAnchor) is
    // still available.
    if (this.insertCursor !== null && this.track.isEditing()) {
      if (this.insertAnchor !== null && this.insertCursor > this.insertAnchor) {
        // Remove the most-recently-laid live piece at the insert cursor and step
        // the cursor back; the frozen downstream suffix stays intact and we
        // remain in editing mode.
        const removed = this.track.deleteAt(this.insertCursor);
        this.insertCursor -= 1;
        this.renderer.rebuildTrack(this.track);
        this.renderer.clearGhost();
        if (removed) {
          this._setStatus(`Removed ${PIECES[removed].name}.`, 'ok');
        } else {
          this._setStatus('Nothing to undo.', 'err');
        }
        this._refreshButtons();
        this.onChange();
        return;
      }
      // No piece laid in this session yet — nothing to undo without disturbing
      // the frozen downstream. Leave the track untouched.
      this._setStatus('Nothing to undo in this section — Rejoin or keep building.', 'err');
      return;
    }
    // Normal append mode: remove the last appended piece.
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
    // palette is locked -- UNLESS a slot is selected (replace mode) or the insert
    // cursor is active (building out a section), in which case palette is enabled.
    const lockAppend = this.track.hasFinish();
    const editing = this.selectedIndex !== null || this.insertCursor !== null;
    for (const b of this.buttons) {
      b.disabled = !this.enabled || (lockAppend && !editing);
    }
  }

  /**
   * Translate the Track's last collision result into a user-facing message.
   * Read after a mutation method (addPiece/insertAt/replaceAt) returns false.
   * Floor and overlap rejections get collision-specific copy; an overlap while
   * editing distinguishes the frozen/downstream region (Requirement 7.3). For
   * any non-collision rejection (invalid id, out-of-bounds, no collision result)
   * the caller's generic `fallback` message is used.
   */
  private _collisionMessage(fallback: string): string {
    const r = this.track.lastCollisionResult;
    if (r && !r.ok) {
      if (r.reason === 'floor') return 'Cannot place: piece would go below floor level.';
      if (r.reason === 'overlap') {
        return this.track.isEditing()
          ? 'Cannot place: collides with downstream track.'
          : 'Cannot place: collides with existing track.';
      }
    }
    return fallback;
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
