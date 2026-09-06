// editor.ts -- Build-mode UI: palette buttons, hover ghost preview, undo/clear.

import { PIECES, PALETTE_GROUPS, DECORATIONS, DECORATION_ORDER, canDecorate, SURFACES, SURFACE_ORDER, canModify } from './pieces/index.js';
import type { Track } from './track.js';
import type { Renderer } from './renderer/index.js';
import type { DecorationId, Piece, PieceId, SurfaceId } from './types.js';
import type { StatusKind } from './app/hud.js';
import { loadCollapsedGroups, saveCollapsedGroups } from './app/storage.js';

/**
 * Hover text for a palette button, derived from the piece's OWN fields rather
 * than a hand-written blurb per piece. With 40-odd pieces the catalogue is far
 * past the point where a name alone tells a player what a piece does, and a
 * generated description cannot go stale: change `dz` or `minV2` and the tooltip
 * follows. Reads e.g. "Turns 180° · climbs 2 · needs speed 50 · +18 excitement".
 */
export function describePiece(piece: Piece): string {
  const parts: string[] = [];
  const turn = Math.abs(piece.turn);
  if (turn === 2) parts.push('Turns 180°');
  else if (turn === 1) parts.push(`Turns 90° ${piece.turn < 0 ? 'left' : 'right'}`);
  if (piece.sideAdvance) parts.push(`shifts ${Math.abs(piece.sideAdvance)} across`);
  if (piece.dz > 0) parts.push(`climbs ${piece.dz}`);
  else if (piece.dz < 0) parts.push(`drops ${Math.abs(piece.dz)}`);
  if (piece.boostEnergy > 0) parts.push(`boosts speed (+${piece.boostEnergy})`);
  else if (piece.boostEnergy < 0) parts.push('slows the car');
  if (piece.minV2 > 0) parts.push(`needs speed ${Math.round(piece.minV2)}`);
  if (piece.excitement > 0) parts.push(`+${piece.excitement} excitement`);
  if (parts.length === 0) parts.push('Plain track');
  return `${piece.name} — ${parts.join(' · ')}`;
}

export interface EditorOptions {
  track: Track;
  renderer: Renderer;
  paletteEl: HTMLElement;
  statusEl: HTMLElement | null;
  /**
   * Optional palette filter box. Injected like the other elements rather than
   * looked up by id, so the unit tests can simply omit it.
   */
  searchEl?: HTMLInputElement | null;
  /**
   * Optional container for the armed-surface strip (the Plain / Ice / Gravel
   * chips plus the "currently laying" banner). Injected like `searchEl` so the
   * unit tests can omit it and the editor still builds.
   */
  surfaceStripEl?: HTMLElement | null;
  /**
   * Optional container for the surface chips shown in the selection bar, used to
   * change the surface on a piece that is already placed.
   */
  selSurfaceEl?: HTMLElement | null;
  onChange?: () => void;
  /** Called whenever the selected slot changes (null when nothing is selected). */
  onSelectionChange?: (sel: { index: number; name: string } | null) => void;
}

export class Editor {
  track: Track;
  renderer: Renderer;
  paletteEl: HTMLElement;
  statusEl: HTMLElement | null;
  searchEl: HTMLInputElement | null;
  surfaceStripEl: HTMLElement | null;
  selSurfaceEl: HTMLElement | null;
  onChange: () => void;
  onSelectionChange: (sel: { index: number; name: string } | null) => void;
  enabled = true;
  buttons: HTMLButtonElement[] = [];
  decoButtons: HTMLButtonElement[] = [];
  /** Chips in the palette strip that ARM a surface for subsequent placements. */
  surfaceButtons: HTMLButtonElement[] = [];
  /** Chips in the selection bar that apply a surface to the selected piece. */
  selSurfaceButtons: HTMLButtonElement[] = [];
  /**
   * The surface currently being "laid": while set, every piece placed by `_add`
   * gets it automatically, so building an icy stretch costs one click to arm
   * plus the pieces themselves. `null` means plain track.
   */
  activeSurface: SurfaceId | null = null;
  /** The "you are currently laying X" banner, built alongside the strip. */
  private _armedNote: HTMLElement | null = null;
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
  /** Palette groups, so a heading click can hide exactly its own members. */
  private _groups: { label: string; sep: HTMLElement; members: HTMLElement[] }[] = [];
  /** Labels of collapsed groups, restored from the player's last session. */
  private _collapsed: Set<string> = new Set(loadCollapsedGroups() ?? []);
  /** Current lower-cased palette filter; empty means unfiltered. */
  private _query = '';
  private _emptyNote: HTMLElement | null = null;
  private _statusTimer?: ReturnType<typeof setTimeout>;

  constructor({ track, renderer, paletteEl, statusEl, searchEl, surfaceStripEl, selSurfaceEl, onChange, onSelectionChange }: EditorOptions) {
    this.track = track;
    this.renderer = renderer;
    this.paletteEl = paletteEl;
    this.statusEl = statusEl;
    this.searchEl = searchEl ?? null;
    this.surfaceStripEl = surfaceStripEl ?? null;
    this.selSurfaceEl = selSurfaceEl ?? null;
    this.onChange = onChange ?? (() => {});
    this.onSelectionChange = onSelectionChange ?? (() => {});
    this._build();
  }

  private _build(): void {
    this.paletteEl.innerHTML = '';
    this.buttons = [];
    this._groups = [];
    // Render the palette grouped into labelled sections so the catalogue is easy
    // to scan. Each heading is a button that collapses its own group: with 40-odd
    // pieces the full list is several screens tall, so being able to shut the
    // groups you are not using is what makes it navigable.
    for (const group of PALETTE_GROUPS) {
      const visible = group.ids.filter((id) => PIECES[id] && !PIECES[id].hidden);
      if (visible.length === 0) continue;
      const sep = this._makeGroupHeader(group.label, visible.length);
      this.paletteEl.appendChild(sep);
      const members: HTMLElement[] = [];
      for (const id of visible) {
        const piece = PIECES[id];
        const btn = document.createElement('button');
        btn.className = 'piece-btn';
        if (piece.featured) btn.classList.add('featured');
        if (piece.boost) btn.classList.add('boost');
        btn.dataset.pieceId = id;
        btn.title = describePiece(piece);
        // Lower-cased haystack for the search box, built once. Covers the piece
        // name, its id, its group, and the generated description -- so as well as
        // names you can search a group ("stunts"), or anything the description
        // states, e.g. "180" for the reversals or "drops" for the descents. It
        // deliberately holds no hand-written keywords: those would be another
        // per-piece copy to maintain, so the searchable text is exactly the text
        // the piece already shows.
        btn.dataset.search = `${piece.name} ${id} ${group.label} ${describePiece(piece)}`.toLowerCase();
        btn.innerHTML = `
          <span class="icon">${piece.icon}</span>
          <span class="label">${piece.name}</span>
        `;
        btn.addEventListener('mouseenter', () => this._hover(id));
        btn.addEventListener('mouseleave', () => this._unhover());
        btn.addEventListener('click', () => this._add(id));
        this.paletteEl.appendChild(btn);
        this.buttons.push(btn);
        members.push(btn);
      }
      this._groups.push({ label: group.label, sep, members });
    }

    // Decoration buttons (e.g. Ring of Fire). These attach to the SELECTED piece
    // rather than appending a new piece, so they live in their own labelled row.
    this.decoButtons = [];
    if (DECORATION_ORDER.length > 0) {
      const sep = this._makeGroupHeader('Decorations', DECORATION_ORDER.length);
      this.paletteEl.appendChild(sep);
      const members: HTMLElement[] = [];
      for (const decoId of DECORATION_ORDER) {
        const deco = DECORATIONS[decoId];
        const btn = document.createElement('button');
        btn.className = 'piece-btn deco';
        btn.dataset.decoId = decoId;
        btn.dataset.search = `${deco.name} ${decoId} decoration`.toLowerCase();
        btn.title = 'Select a flat piece (straight, ramp, jump, booster…), then click to add/remove';
        btn.innerHTML = `
          <span class="icon">${deco.icon}</span>
          <span class="label">${deco.name}</span>
        `;
        btn.addEventListener('click', () => this._toggleDeco(decoId));
        this.paletteEl.appendChild(btn);
        this.decoButtons.push(btn);
        members.push(btn);
      }
      this._groups.push({ label: 'Decorations', sep, members });
    }
    // A place to say "nothing matched" rather than showing an empty panel.
    this._emptyNote = document.createElement('div');
    this._emptyNote.className = 'palette-empty is-hidden';
    this._emptyNote.textContent = 'No pieces match.';
    this.paletteEl.appendChild(this._emptyNote);

    this._applyCollapsed();
    this._installSearch();
    this._buildSurfaceStrip();
    this._buildSelSurfaceChips();
    this._refreshButtons();
    this._installScrollCue();
  }

  /**
   * The armed-surface strip: pick a surface once and every piece placed
   * afterwards carries it. Lives OUTSIDE the scrolling palette (the host puts it
   * above), because the whole point is that laying an icy stretch must not mean
   * scrolling past eight piece groups for each piece.
   *
   * Built into an injected container rather than looked up by id, and every DOM
   * call the strip needs is one the palette already relies on, so the editor
   * still builds against the tests' minimal element stub.
   */
  private _buildSurfaceStrip(): void {
    this.surfaceButtons = [];
    this._armedNote = null;
    const host = this.surfaceStripEl;
    if (!host) return;
    host.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'surface-row';

    // "Plain" is the disarm chip. It is a real option rather than only an Escape
    // keypress so the mode is escapable with the mouse alone, and so the strip
    // always shows which of the three states you are in.
    const plain = document.createElement('button');
    plain.className = 'surf-btn';
    plain.dataset.surface = '';
    plain.title = 'Lay plain track (no surface) — shortcut 1';
    plain.innerHTML = '<span class="icon">🛣</span><span class="label">Plain</span><span class="key">1</span>';
    plain.addEventListener('click', () => this.armSurface(null));
    row.appendChild(plain);
    this.surfaceButtons.push(plain);

    SURFACE_ORDER.forEach((id, i) => {
      const surface = SURFACES[id];
      const btn = document.createElement('button');
      btn.className = 'surf-btn';
      btn.dataset.surface = id;
      // Shortcut numbering continues from Plain, so Ice is 2 and Gravel is 3.
      btn.title = `${surface.name} — ${surface.blurb} (shortcut ${i + 2})`;
      btn.innerHTML = `<span class="icon">${surface.icon}</span><span class="label">${surface.name}</span><span class="key">${i + 2}</span>`;
      btn.addEventListener('click', () => this.armSurface(id));
      row.appendChild(btn);
      this.surfaceButtons.push(btn);
    });

    host.appendChild(row);

    // The loud indicator. An armed mode that silently changes every piece you
    // place is the main hazard of this interaction, so the banner states the
    // surface by name and how to stop, and is only in the DOM while armed.
    const note = document.createElement('div');
    note.className = 'surface-armed is-hidden';
    host.appendChild(note);
    this._armedNote = note;
  }

  /**
   * Surface chips for the selection bar, so a piece that is ALREADY placed can be
   * changed without arming a mode. This is the retrofit path; the strip above is
   * the bulk-laying path.
   */
  private _buildSelSurfaceChips(): void {
    this.selSurfaceButtons = [];
    const host = this.selSurfaceEl;
    if (!host) return;
    host.innerHTML = '';
    for (const id of SURFACE_ORDER) {
      const surface = SURFACES[id];
      const btn = document.createElement('button');
      btn.className = 'surf-chip';
      btn.dataset.surface = id;
      btn.title = `${surface.name} — ${surface.blurb}`;
      btn.innerHTML = `<span class="icon">${surface.icon}</span>`;
      btn.addEventListener('click', () => this._applySurfaceToSelected(id));
      host.appendChild(btn);
      this.selSurfaceButtons.push(btn);
    }
    // Clear chip: removes whatever surface the selected piece carries.
    const clear = document.createElement('button');
    clear.className = 'surf-chip';
    clear.dataset.surface = '';
    clear.title = 'Back to plain track';
    clear.innerHTML = '<span class="icon">⊘</span>';
    clear.addEventListener('click', () => this._applySurfaceToSelected(null));
    host.appendChild(clear);
    this.selSurfaceButtons.push(clear);
  }

  /**
   * Arm (or disarm) a surface for subsequent placements. Clicking the surface
   * that is already armed disarms it, so the same chip toggles.
   *
   * When a piece is currently SELECTED, arming also applies the surface to that
   * piece straight away — otherwise clicking Ice with a piece selected would
   * appear to do nothing, which is the confusing case the old decoration flow
   * had. The two entry points therefore agree: the chip you click always affects
   * what you are looking at.
   */
  armSurface(id: SurfaceId | null): void {
    if (!this.enabled) return;
    const next = id !== null && this.activeSurface === id ? null : id;
    this.activeSurface = next;
    if (this.selectedIndex !== null) {
      this._applySurfaceToSelected(next, { quiet: true });
    }
    const label = next === null ? 'plain track' : SURFACES[next].name;
    this._setStatus(
      next === null
        ? 'Laying plain track.'
        : `Laying ${label} — every piece you place is on ${label.toLowerCase()}. Esc to stop.`,
      'ok',
    );
    this._refreshButtons();
  }

  /** Disarm the active surface, if any. Wired to Escape by the host. */
  disarmSurface(): boolean {
    if (this.activeSurface === null) return false;
    this.activeSurface = null;
    this._setStatus('Laying plain track.', 'ok');
    this._refreshButtons();
    return true;
  }

  /** Apply a surface to the currently selected piece (selection-bar chips). */
  private _applySurfaceToSelected(id: SurfaceId | null, opts: { quiet?: boolean } = {}): void {
    if (!this.enabled) return;
    if (this.selectedIndex === null) {
      this._setStatus('Select a piece first, or pick a surface and place new track.', 'err');
      return;
    }
    const pieceId = this.track.pieces[this.selectedIndex];
    if (id !== null && !canModify(pieceId)) {
      this._setStatus(`${SURFACES[id].name} can't be laid on a ${PIECES[pieceId].name}.`, 'err');
      return;
    }
    const changed = this.track.setSurface(this.selectedIndex, id);
    if (!changed) {
      this._refreshButtons();
      return;
    }
    this.renderer.rebuildTrack(this.track);
    // Re-apply the selection highlight (rebuild recreated the meshes).
    this.renderer.highlightPiece(this.selectedIndex);
    if (!opts.quiet) {
      this._setStatus(
        id === null
          ? `${PIECES[pieceId].name} is back to plain track.`
          : `Laid ${SURFACES[id].name} on the ${PIECES[pieceId].name}.`,
        'ok',
      );
    }
    this._refreshButtons();
    this.onChange();
  }

  /**
   * Stamp the armed surface onto a piece that has just been placed at `index`.
   * Silently does nothing when nothing is armed, or when the piece cannot carry a
   * surface — placing a loop while laying ice should still place the loop rather
   * than refuse, so the arm is an intent that simply does not apply everywhere.
   */
  private _stampActiveSurface(index: number): void {
    if (this.activeSurface === null) return;
    this.track.setSurface(index, this.activeSurface);
  }

  /**
   * " on ice" / " on gravel" suffix for a placement message. Reports what
   * actually landed, so a loop placed while ice is armed does not claim to be
   * icy.
   */
  private _laidSuffix(index: number): string {
    const laid = this.track.surfaceAt(index);
    return laid === null ? '' : ` on ${SURFACES[laid].name.toLowerCase()}`;
  }

  /**
   * A group heading that doubles as its own collapse toggle. Kept a real
   * `<button>` so it is keyboard-reachable and announces its state; the styling
   * strips the button chrome back to a heading.
   */
  private _makeGroupHeader(label: string, count: number): HTMLElement {
    const sep = document.createElement('button');
    sep.className = 'palette-sep';
    sep.dataset.groupLabel = label;
    sep.innerHTML = `
      <span class="palette-sep-chevron" aria-hidden="true">▾</span>
      <span class="palette-sep-label">${label}</span>
      <span class="palette-sep-count">${count}</span>
    `;
    if (typeof sep.setAttribute === 'function') sep.setAttribute('type', 'button');
    sep.addEventListener('click', () => this._toggleGroup(label));
    return sep;
  }

  /** Collapse or expand one group, and remember the choice. */
  private _toggleGroup(label: string): void {
    if (this._collapsed.has(label)) this._collapsed.delete(label);
    else this._collapsed.add(label);
    saveCollapsedGroups([...this._collapsed]);
    this._applyCollapsed();
  }

  /**
   * Reflect the collapsed set into the DOM. Visibility is driven by classes
   * rather than inline styles because the Editor is unit-tested against a
   * minimal element stub that has `classList.add`/`remove` and no `style`.
   *
   * A live search overrides collapse entirely: while filtering you want to see
   * every match wherever it lives, and the previous collapse state comes back
   * when the box is cleared.
   */
  private _applyCollapsed(): void {
    const searching = this._query.length > 0;
    for (const g of this._groups) {
      const shut = !searching && this._collapsed.has(g.label);
      if (shut) g.sep.classList.add('collapsed');
      else g.sep.classList.remove('collapsed');
      if (typeof g.sep.setAttribute === 'function') {
        g.sep.setAttribute('aria-expanded', shut ? 'false' : 'true');
      }
      for (const b of g.members) {
        if (shut) b.classList.add('hidden-by-group');
        else b.classList.remove('hidden-by-group');
      }
    }
  }

  /** Wire the search box, when the host supplied one. */
  private _installSearch(): void {
    const el = this.searchEl;
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener('input', () => {
      this._query = (el.value ?? '').trim().toLowerCase();
      this._applySearch();
    });
    // Escape clears the filter without reaching for the mouse.
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this._query.length > 0) {
        e.stopPropagation();
        el.value = '';
        this._query = '';
        this._applySearch();
      }
    });
    this._applySearch();
  }

  /**
   * Filter the palette to the current query, hiding groups that end up empty and
   * showing a note when nothing matches at all.
   */
  private _applySearch(): void {
    const q = this._query;
    let anyVisible = false;
    for (const g of this._groups) {
      let groupHasMatch = false;
      for (const b of g.members) {
        const hay = b.dataset.search ?? '';
        const hit = q.length === 0 || hay.includes(q);
        if (hit) { b.classList.remove('hidden-by-search'); groupHasMatch = true; }
        else b.classList.add('hidden-by-search');
      }
      if (groupHasMatch) { g.sep.classList.remove('hidden-by-search'); anyVisible = true; }
      else g.sep.classList.add('hidden-by-search');
    }
    if (this._emptyNote) {
      if (anyVisible) this._emptyNote.classList.add('is-hidden');
      else this._emptyNote.classList.remove('is-hidden');
    }
    // Collapse state is suppressed while searching, so re-apply it either way.
    this._applyCollapsed();
  }

  /**
   * Keep the palette panel's "more below" fade in step with the scroll position:
   * shown while there is more to reach, hidden at the end (and never shown at all
   * when the whole catalogue happens to fit).
   *
   * Purely an affordance, so every DOM API it needs is feature-detected: the
   * editor is unit-tested against a minimal element stub, and a cosmetic cue must
   * never be the reason the palette fails to build.
   */
  private _installScrollCue(): void {
    const pal = this.paletteEl as HTMLElement & { closest?: (s: string) => Element | null };
    if (typeof pal.closest !== 'function') return;
    const panel = pal.closest('.panel-pieces');
    if (!panel || typeof pal.addEventListener !== 'function') return;
    const sync = (): void => {
      const atEnd = pal.scrollTop + pal.clientHeight >= pal.scrollHeight - 2;
      panel.classList.toggle('at-end', atEnd);
    };
    pal.addEventListener('scroll', sync, { passive: true });
    // The palette's height depends on the window, so re-check on resize too.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(sync).observe(pal);
    sync();
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

  /**
   * Attach/remove a decoration (Ring of Fire) on the currently selected piece.
   * Requires a selected, decoration-compatible piece; otherwise shows a hint.
   */
  private _toggleDeco(decoId: DecorationId): void {
    if (!this.enabled) return;
    if (this.selectedIndex === null) {
      this._setStatus(`Select a flat piece first, then add the ${DECORATIONS[decoId].name}.`, 'err');
      return;
    }
    const pieceId = this.track.pieces[this.selectedIndex];
    if (!canDecorate(pieceId)) {
      this._setStatus(`${DECORATIONS[decoId].name} can't go on a ${PIECES[pieceId].name}.`, 'err');
      return;
    }
    const nowOn = this.track.toggleDecoration(this.selectedIndex, decoId);
    this.renderer.rebuildTrack(this.track);
    // Re-apply the selection highlight (rebuild recreated the meshes).
    this.renderer.highlightPiece(this.selectedIndex);
    this._setStatus(`${nowOn ? 'Added' : 'Removed'} ${DECORATIONS[decoId].name}.`, 'ok');
    this._refreshButtons();
    this.onChange();
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
      this._stampActiveSurface(this.selectedIndex);
      this.renderer.rebuildTrack(this.track);
      this.renderer.clearGhost();
      this._setStatus(`Replaced with ${PIECES[id].name}${this._laidSuffix(this.selectedIndex)}.`, 'ok');
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
      this._stampActiveSurface(insertIdx);
      this.renderer.rebuildTrack(this.track);
      this.renderer.clearGhost();
      this._setStatus(`Inserted ${PIECES[id].name}${this._laidSuffix(insertIdx)} - keep clicking to extend, or Rejoin.`, 'ok');
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
    const addedIdx = this.track.pieces.length - 1;
    this._stampActiveSurface(addedIdx);
    this.renderer.rebuildTrack(this.track);
    this.renderer.clearGhost();
    this._setStatus(`Added ${PIECES[id].name}${this._laidSuffix(addedIdx)}.`, 'ok');
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
    // Keep the gap-fill cursor alive while an edit is still open. deselectPiece
    // fires on incidental gestures during an edit — an empty-canvas click or
    // Escape after a delete — and the track is still in editing mode (frozen
    // downstream) at that point. Wiping insertCursor here would strand the next
    // palette click into the APPEND branch of _add(), which places past the
    // frozen suffix (or is blocked by the Finish line): the classic "removed a
    // piece, can't connect a new one back in" bug. Selecting another piece or
    // finishing the edit (Rejoin) clears the cursor through their own paths.
    if (!this.track.isEditing()) {
      this.insertCursor = null;
      this.insertAnchor = null;
    }
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
    // Decoration buttons are only usable when a compatible piece is selected.
    const canDeco = this.selectedIndex !== null && canDecorate(this.track.pieces[this.selectedIndex]);
    for (const b of this.decoButtons) {
      b.disabled = !this.enabled || !canDeco;
      const decoId = b.dataset.decoId as DecorationId | undefined;
      const active = decoId != null && this.selectedIndex !== null
        && this.track.decorationAt(this.selectedIndex) === decoId;
      if (active) b.classList.add('deco-active');
      else b.classList.remove('deco-active');
    }
    this._refreshSurfaceUI();
  }

  /**
   * Sync the surface strip, its armed banner, and the selection-bar chips.
   *
   * Drives everything by class and `textContent` only — no `classList.toggle`
   * and no inline `style` — because the editor is deliberately unit-tested
   * against a minimal element stub that implements just `classList.add`/`remove`.
   */
  private _refreshSurfaceUI(): void {
    for (const b of this.surfaceButtons) {
      b.disabled = !this.enabled;
      const raw = b.dataset.surface ?? '';
      const armed = raw === '' ? this.activeSurface === null : raw === this.activeSurface;
      if (armed) b.classList.add('surf-armed');
      else b.classList.remove('surf-armed');
    }

    if (this._armedNote) {
      if (this.activeSurface === null) {
        this._armedNote.classList.add('is-hidden');
        this._armedNote.textContent = '';
      } else {
        const s = SURFACES[this.activeSurface];
        this._armedNote.classList.remove('is-hidden');
        this._armedNote.textContent = `${s.icon} Laying ${s.name} — every piece you place is on ${s.name.toLowerCase()}. Esc to stop.`;
      }
    }

    // Selection-bar chips: only meaningful for a selected piece that can carry a
    // surface. The chip matching the piece's current surface is marked active
    // (the clear chip stands in for "plain").
    const selectable = this.selectedIndex !== null
      && canModify(this.track.pieces[this.selectedIndex]);
    const current = this.selectedIndex !== null ? this.track.surfaceAt(this.selectedIndex) : null;
    for (const b of this.selSurfaceButtons) {
      b.disabled = !this.enabled || !selectable;
      const raw = b.dataset.surface ?? '';
      const active = selectable && (raw === '' ? current === null : raw === current);
      if (active) b.classList.add('surf-active');
      else b.classList.remove('surf-active');
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
