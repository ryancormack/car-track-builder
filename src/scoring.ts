// scoring.ts — Computes a score from a track + simulation result.
//
// Components:
//  • Length:     +5 per piece (encourages longer tracks)
//  • Excitement: each piece contributes its own excitement value
//  • Stunt combo: bonus for chaining multiple stunt pieces (loops, corkscrews, jumps)
//  • Top-speed bonus: scaled with peak speed reached
//  • Completion bonus: +250 for crossing the Finish piece
//  • Booster penalty: -15 per booster used (rewarding "natural" momentum)
//  • Fail penalty: ×0.4 multiplier if the car failed mid-run

import { PIECES } from './pieces/index.js';
import type { Track } from './track.js';
import type { ScoreResult, SimSummary } from './types.js';

export function computeScore(track: Track, sim: SimSummary | null | undefined): ScoreResult {
  let length = 0;
  let excitement = 0;
  let stuntCombo = 0;
  let stuntStreak = 0;

  for (let i = 0; i < track.pieces.length; i++) {
    const p = PIECES[track.pieces[i]];
    length += 5;
    excitement += p.excitement;
    if (p.category === 'stunt') {
      stuntStreak++;
      if (stuntStreak >= 2) stuntCombo += 15 * (stuntStreak - 1);
    } else {
      stuntStreak = 0;
    }
  }

  const topSpeed = sim?.topSpeed ?? 0;
  const speedBonus = Math.round(topSpeed * 4);
  const boosterPenalty = (sim?.boostersUsed ?? 0) * 15;
  const completionBonus = sim?.finished && !sim.failed ? 250 : 0;

  const subtotal = length + excitement + stuntCombo + speedBonus + completionBonus - boosterPenalty;
  const failMult = sim?.failed ? 0.4 : 1.0;
  const total = Math.max(0, Math.round(subtotal * failMult));

  return {
    total,
    breakdown: {
      length,
      excitement,
      stuntCombo,
      speedBonus,
      completionBonus,
      boosterPenalty,
      failMult,
    },
  };
}

// Quick "design score" used in build mode without a sim run yet.
export function designScore(track: Track): number {
  let length = 0;
  let excitement = 0;
  for (let i = 0; i < track.pieces.length; i++) {
    const p = PIECES[track.pieces[i]];
    length += 5;
    excitement += p.excitement;
  }
  return length + excitement;
}
