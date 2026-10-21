// Central colour palette (sRGB hex). Tweak here to restyle the whole game.
export const PAL = {
  skin: [0xe8b48a, 0xd59a6e, 0xb97a52, 0x8d5a3b],
  // Posse (player): blue shirts, light hats
  posseShirt: [0x3d7fd6, 0x2f6bc0, 0x4a92e8, 0x2a5aa8],
  posseHat: [0xd9c49a, 0xc9a66b, 0xefe6d2, 0xa8814f],
  posseVest: [0x6b4a2e, 0x4e3a28, 0x8a6a45],
  pants: [0x4a5a78, 0x5a4a3a, 0x3e4a5e, 0x6b5a44],
  // Bandits: dark hats, red bandanas, dark coats
  banditCoat: [0x3a2c26, 0x4a3a2e, 0x2e2a2a, 0x5a3a2a],
  banditShirt: [0x8a3a2a, 0x6a5a4a, 0x7a2a2a],
  banditHat: [0x1e1a18, 0x2a2420, 0x3a2a20],
  bandana: 0xd8262e,
  bandanaDark: 0xa81a22,
  // Shared
  boot: 0x3a2618,
  bootSole: 0x221510,
  belt: 0x2a1a10,
  buckle: 0xf0c040,
  hatBand: 0x2a1a12,
  eye: 0x1a1210,
  mustache: 0x4a2e1a,
  star: 0xffd84a,
  metal: 0x5a5e66,
  metalDark: 0x2e3036,
  metalLight: 0x9aa0aa,
  wood: 0x8a5a32,
  woodDark: 0x5a3a20,
  dynamite: 0xd8302a,
  fuse: 0xe8d8a8,
  brass: 0xc89a3a,
  // Town
  dirt: 0xc9965e,
  dirtDark: 0xa8784a,
  plank: [0x9a6a3e, 0x8a5c34, 0xa87848, 0x7a5030],
  paint: [0xb85a3a, 0x5a8a8a, 0xd8c8a0, 0x8a6a8a, 0x6a8a5a, 0xc8a050],
  trim: 0xf0e0c0,
  roof: 0x5a3a2a,
  glass: 0x2a3a4a,
  glassLight: 0x5a7a8a,
  door: 0x4a2e1a,
  sign: 0x2a1a10,
  signText: 0xf8e8c0,
  cactus: 0x4a8a3a,
  cactusDark: 0x3a6a2a,
  hay: 0xe0c060,
  water: 0x4a8ab8,
  red: 0xc83a2a,
};

export function pick<T>(arr: readonly T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length) % arr.length];
}
