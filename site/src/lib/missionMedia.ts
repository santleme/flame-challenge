export interface MissionMedia {
  src: string
  poster: string
  caption: string
}

const MEDIA = {
  apollo11: {
    src: '/assets/nasa/apollo11_loop.mp4',
    poster: '/assets/nasa/apollo11_loop_poster.jpg',
    caption: 'Apollo 11 Saturn V liftoff — NASA KSC',
  },
  sofie: {
    src: '/assets/sofie_flame.mp4',
    poster: '/assets/sofie_poster.jpg',
    caption: 'SoFIE-GEL flame in microgravity — NASA',
  },
  saffire: {
    src: '/assets/saffire5_uv_sd.mp4',
    poster: '/assets/nasa/saffire5_uv_poster.jpg',
    caption: 'Saffire-V flame, UV channel — NASA',
  },
  acme: {
    src: '/assets/nasa/acme_loop.mp4',
    poster: '/assets/nasa/acme_loop_poster.jpg',
    caption: 'ACME microgravity flame — NASA Glenn',
  },
  soot: {
    src: '/assets/nasa/soot_loop.mp4',
    poster: '/assets/nasa/soot_loop_poster.jpg',
    caption: 'Glowing soot in a microgravity flame — NASA',
  },
  droptower: {
    src: '/assets/nasa/droptower_loop.mp4',
    poster: '/assets/nasa/droptower_loop_poster.jpg',
    caption: 'Zero-G Drop Tower — NASA Glenn',
  },
  skylab: {
    src: '/assets/nasa/skylab_loop.mp4',
    poster: '/assets/nasa/skylab_loop_poster.jpg',
    caption: 'Skylab zero-g flammability studies — NASA Glenn',
  },
  mir: {
    src: '/assets/nasa/mir_loop.mp4',
    poster: '/assets/nasa/mir_loop_poster.jpg',
    caption: 'Mir space station operations — NASA/Roscosmos',
  },
} as const satisfies Record<string, MissionMedia>

/** one distinct NASA clip per investigation — no two reports share a plate */
const BY_INVESTIGATION: Record<string, keyof typeof MEDIA> = {
  flare: 'apollo11',
  'sofie-gel': 'sofie',
  'flex-2': 'droptower',
  flex: 'droptower',
  saffire: 'saffire',
  // smoke aerosol measurement ↔ soot chains in microgravity
  same: 'soot',
  acme: 'acme',
  'bass-ii': 'skylab',
  // confined cabin fire — the Mir 1997 oxygen-candle incident
  'confined-combustion': 'mir',
  soot: 'skylab',
}

/** NASA footage that best matches a report's investigation, falling
 *  back to its gravity regime so every report — including live-session
 *  ones — carries a contextual plate. */
export function missionMedia(investigationId: string, gravityRegime: string): MissionMedia {
  const byInv = BY_INVESTIGATION[investigationId.toLowerCase()]
  if (byInv) return MEDIA[byInv]
  const g = gravityRegime.toLowerCase()
  if (g.includes('lunar') || g.includes('0.16') || g.includes('mars')) return MEDIA.apollo11
  if (g.includes('earth') || g.includes('1g')) return MEDIA.acme
  return MEDIA.skylab
}
