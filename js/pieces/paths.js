// pieces/paths.js — parametric path samplers, one per piece type.
// Each returns { lx, ly, lz, banking } at t in [0, 1] in piece-local coords.
// Pure functions of t — easy to unit-test for continuity and end-points.

export const pathStraight = (t) => ({ lx: t, ly: 0, lz: 0, banking: 0 });

export const pathCurveR = (t) => {
  // Quarter circle from (0, 0) to (0.5, 0.5), centred at (0, 0.5), radius 0.5.
  const a = -Math.PI / 2 + (Math.PI / 2) * t;
  return { lx: 0.5 * Math.cos(a), ly: 0.5 + 0.5 * Math.sin(a), lz: 0, banking: 0 };
};

export const pathCurveL = (t) => {
  // Quarter circle from (0, 0) to (0.5, -0.5), centred at (0, -0.5), radius 0.5.
  const a = Math.PI / 2 - (Math.PI / 2) * t;
  return { lx: 0.5 * Math.cos(a), ly: -0.5 + 0.5 * Math.sin(a), lz: 0, banking: 0 };
};

export const pathRampUp = (t) => ({ lx: t, ly: 0, lz: t, banking: 0 });
export const pathRampDown = (t) => ({ lx: t, ly: 0, lz: -t, banking: 0 });

export const pathLoop = (t) => {
  // Approach (0..0.1): straight from back edge to loop bottom (lx=0.5, lz=0).
  // Loop (0.1..0.9): full 360° vertical circle in xz-plane, radius R, centre (0.5, 0, R).
  // Depart (0.9..1.0): straight from loop bottom to front edge (lx=1, lz=0).
  const R = 0.5;
  if (t < 0.1) return { lx: (t / 0.1) * 0.5, ly: 0, lz: 0, banking: 0 };
  if (t > 0.9) return { lx: 0.5 + ((t - 0.9) / 0.1) * 0.5, ly: 0, lz: 0, banking: 0 };
  const u = (t - 0.1) / 0.8;
  const a = -Math.PI / 2 + 2 * Math.PI * u;
  return {
    lx: 0.5 + R * Math.cos(a),
    ly: 0,
    lz: R + R * Math.sin(a),
    banking: 0,
  };
};

export const pathCorkscrew = (t) => {
  // Barrel roll: lx advances 0->1 while car spins around the forward axis.
  const a = 2 * Math.PI * t;
  return { lx: t, ly: 0.3 * Math.sin(a), lz: 0.3 + 0.3 * Math.cos(a), banking: a };
};

export const pathJump = (t) => {
  // Parabolic arc: net dz = 0, rises to ~0.9 at the peak.
  const lz = 0.9 * Math.sin(Math.PI * t);
  return { lx: t, ly: 0, lz, banking: 0 };
};
