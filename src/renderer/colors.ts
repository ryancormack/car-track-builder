// renderer/colors.ts — single source of truth for the visual palette.
// Hot Wheels-inspired oranges + cool cyan/blue accents on a dark navy stage.

export const COLORS = {
  bg: 0x06101f,
  ground: 0x0b1426,
  grid: 0x1b2a47,
  gridCenter: 0x33507e,
  trackOrange: 0xff7a1a,
  trackOrangeBright: 0xff9d3d,
  trackBlue: 0x3da9fc,
  trackEdge: 0x0a1422,
  booster: 0xff4500,
  boosterEm: 0xff7a1a,
  boosterArrow: 0xffe600,
  boosterArrowEm: 0xffaa00,
  jumpLip: 0xffd23f,
  jumpLipEm: 0xffaa00,
  finish: 0xffffff,
  finishAlt: 0x111111,
  finishPost: 0xddddee,
  ghost: 0x3da9fc,
  gap: 0x7488a6,
  car: 0x00ffd5,
  carEm: 0x004455,
  carAccent: 0xff3c00,
  carAccentEm: 0x661800,
  carCabin: 0x002233,
  carWheel: 0x0c0c10,
  carWheelRim: 0x333340,
  carHeadlight: 0xfff2cc,
  carHeadlightEm: 0xffe39a,
  start: 0x5dd39e,
  startEm: 0x115533,
  sun: 0xfff5e0,
  rim: 0x3da9fc,
  hemiSky: 0x9bb8ff,
  hemiGround: 0x14121f,

  // ---- Living-room environment (optional backdrop) ----
  roomFloor: 0xb07a48,      // warm wood floor
  roomFloorAlt: 0x9c6a3c,   // plank shading
  roomWall: 0xe7d9c3,       // soft warm off-white wall
  roomWallAlt: 0xd8c6aa,    // second wall, slightly deeper
  roomBaseboard: 0xf3ece0,  // pale trim
  rug: 0x3f6f7d,            // teal area rug under the track
  rugTrim: 0x2c5560,
  windowFrame: 0xf3ece0,
  windowSky: 0xbfe3ff,      // daytime sky seen through the window
  windowSkyEm: 0x9fd0f5,
  sofa: 0x6d5a8c,           // muted plum sofa
  sofaCushion: 0x8270a0,
  tvUnit: 0x4a3526,         // dark wood TV stand
  tvScreen: 0x10141c,
  tvScreenEm: 0x1b2740,
  coffeeTable: 0x6b4a30,
  shelf: 0x4a3526,
  plantPot: 0xc4663b,
  plantLeaf: 0x4f8a4c,
  lamp: 0xf0e2c0,
  lampGlow: 0xffd9a0,       // warm point-light tint
  roomFog: 0x4a3b46,        // warm fog so far walls fade naturally
  roomHemiSky: 0xfff0d8,    // warm indoor sky/ceiling bounce
  roomHemiGround: 0x4a3325, // floor bounce
} as const;
