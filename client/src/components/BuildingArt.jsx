// SVG building portraits - dark fantasy strategy aesthetic, 72×72 viewBox.
// Shared conventions: light source top-left, radial vignette on every card,
// gradient ids are static per component (duplicate defs across instances are harmless).

function Vignette({ id }) {
  return (
    <>
      <defs>
        <radialGradient id={id} cx="50%" cy="42%" r="72%">
          <stop offset="55%" stopColor="#000" stopOpacity="0"/>
          <stop offset="100%" stopColor="#000" stopOpacity="0.5"/>
        </radialGradient>
      </defs>
      <rect width="72" height="72" rx="8" fill={`url(#${id})`}/>
    </>
  )
}

function Glint({ x, y, s = 1, fill = '#fff8d0', opacity = 0.75 }) {
  // 4-point sparkle
  return (
    <path
      d={`M${x},${y - 2 * s} L${x + 0.7 * s},${y - 0.7 * s} L${x + 2 * s},${y} L${x + 0.7 * s},${y + 0.7 * s} L${x},${y + 2 * s} L${x - 0.7 * s},${y + 0.7 * s} L${x - 2 * s},${y} L${x - 0.7 * s},${y - 0.7 * s} Z`}
      fill={fill} opacity={opacity}
    />
  )
}

export function MineArt({ size = 72, glow = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id="rw-mine-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#241a0c"/>
          <stop offset="100%" stopColor="#0d0905"/>
        </linearGradient>
        <linearGradient id="rw-mine-rock" x1="0.1" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#5c4120"/>
          <stop offset="100%" stopColor="#28190a"/>
        </linearGradient>
        <linearGradient id="rw-mine-rockback" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#352310"/>
          <stop offset="100%" stopColor="#1c1206"/>
        </linearGradient>
        <linearGradient id="rw-mine-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#30200e"/>
          <stop offset="100%" stopColor="#150d04"/>
        </linearGradient>
        <radialGradient id="rw-mine-tglow" cx="50%" cy="80%" r="65%">
          <stop offset="0%" stopColor="#ffa040" stopOpacity="0.55"/>
          <stop offset="100%" stopColor="#ffa040" stopOpacity="0"/>
        </radialGradient>
      </defs>

      <rect width="72" height="72" rx="8" fill="url(#rw-mine-sky)"/>
      {glow && <rect width="72" height="72" rx="8" fill="#ff9030" fillOpacity="0.06"/>}

      {/* Night sky */}
      <circle cx="13" cy="9" r="0.7" fill="#d8c9a0" opacity="0.5"/>
      <circle cx="30" cy="5.5" r="0.5" fill="#d8c9a0" opacity="0.4"/>
      <circle cx="47" cy="8" r="0.6" fill="#d8c9a0" opacity="0.45"/>
      <circle cx="60" cy="11" r="8" fill="#e8dcb8" opacity="0.1"/>
      <circle cx="60" cy="11" r="4.5" fill="#e8dcb8" opacity="0.85"/>
      <circle cx="58.5" cy="10" r="1.1" fill="#c9bd98" opacity="0.6"/>
      <circle cx="61.5" cy="12.5" r="0.8" fill="#c9bd98" opacity="0.5"/>

      {/* Distant ridge */}
      <path d="M0,46 L14,28 L26,38 L40,22 L54,34 L66,26 L72,36 L72,46 Z" fill="url(#rw-mine-rockback)"/>

      {/* Main rock face */}
      <path d="M0,52 L18,18 L32,34 L44,12 L60,30 L72,52 Z" fill="url(#rw-mine-rock)"/>
      {/* Lit edges (top-left light) */}
      <path d="M0,52 L18,18 L32,34 L44,12" fill="none" stroke="#8a6228" strokeWidth="1" opacity="0.55"/>
      <path d="M44,12 L60,30" fill="none" stroke="#6a4a1e" strokeWidth="0.8" opacity="0.4"/>

      {/* Gold veins */}
      <path d="M14,40 q3,-5 1,-9 q-2,-3 2,-7" fill="none" stroke="#e8a832" strokeWidth="1.2" strokeLinecap="round" opacity="0.85"/>
      <path d="M57,38 q-2,-5 1,-8" fill="none" stroke="#d89828" strokeWidth="1" strokeLinecap="round" opacity="0.7"/>
      <Glint x={16.5} y={27} s={1.1}/>
      <Glint x={58.5} y={28} s={0.8} opacity={0.6}/>

      {/* Ground */}
      <rect x="0" y="52" width="72" height="20" fill="url(#rw-mine-ground)"/>
      <ellipse cx="58" cy="58" rx="3" ry="1" fill="#3a2812" opacity="0.5"/>
      <ellipse cx="63" cy="63" rx="2" ry="0.8" fill="#3a2812" opacity="0.4"/>

      {/* Mine shaft - arched, glowing from within */}
      <path d="M25,72 L25,52 Q25,41 36,41 Q47,41 47,52 L47,72 Z" fill="#040201"/>
      <path d="M27,72 L27,53 Q27,44 36,44 Q45,44 45,53 L45,72 Z" fill="none" stroke="#c97a28" strokeWidth="0.8" opacity="0.2"/>
      <ellipse cx="36" cy="66" rx="9" ry="8" fill="url(#rw-mine-tglow)"/>

      {/* Rails out of the tunnel */}
      <line x1="31" y1="72" x2="33.5" y2="58" stroke="#6b4d24" strokeWidth="1.3"/>
      <line x1="41" y1="72" x2="38.5" y2="58" stroke="#6b4d24" strokeWidth="1.3"/>
      <line x1="31.6" y1="69" x2="40.4" y2="69" stroke="#54401e" strokeWidth="1.1"/>
      <line x1="32.4" y1="65" x2="39.6" y2="65" stroke="#54401e" strokeWidth="1.1"/>
      <line x1="33" y1="61" x2="39" y2="61" stroke="#54401e" strokeWidth="1"/>

      {/* Timber frame */}
      <path d="M22.5,50 L17,59" stroke="#5d401c" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M49.5,50 L55,59" stroke="#5d401c" strokeWidth="2.5" strokeLinecap="round"/>
      <rect x="22.5" y="46" width="3" height="26" rx="1.2" fill="#6a4a22"/>
      <rect x="46.5" y="46" width="3" height="26" rx="1.2" fill="#6a4a22"/>
      <rect x="21" y="44" width="30" height="4" rx="1.2" fill="#7d5826"/>
      <line x1="22" y1="45" x2="50" y2="45" stroke="#9a7032" strokeWidth="0.7" opacity="0.7"/>

      {/* Hanging lantern */}
      <line x1="44.5" y1="48" x2="44.5" y2="51" stroke="#3a2a10" strokeWidth="0.8"/>
      <circle cx="44.5" cy="53.5" r="4.5" fill="#ffae3a" opacity="0.22"/>
      <circle cx="44.5" cy="53.5" r="1.8" fill="#ffd080" opacity="0.95"/>
      <circle cx="44.5" cy="53.5" r="2.6" fill="none" stroke="#3a2a10" strokeWidth="0.8"/>

      {/* Ore cart */}
      <path d="M7,61 L21,61 L19.5,69 L8.5,69 Z" fill="#503418" stroke="#6e4c22" strokeWidth="0.8"/>
      <line x1="11" y1="61.5" x2="10.5" y2="68.5" stroke="#3a2410" strokeWidth="0.7" opacity="0.7"/>
      <line x1="17" y1="61.5" x2="17.5" y2="68.5" stroke="#3a2410" strokeWidth="0.7" opacity="0.7"/>
      <circle cx="11" cy="60" r="2" fill="#d99c2e"/>
      <circle cx="14.5" cy="59.2" r="2.4" fill="#e8ac38"/>
      <circle cx="18" cy="60" r="2" fill="#c98c26"/>
      <circle cx="13.6" cy="58.4" r="0.7" fill="#ffe9a0" opacity="0.9"/>
      <circle cx="10.5" cy="70" r="1.6" fill="#2a1c0c" stroke="#6e4c22" strokeWidth="0.7"/>
      <circle cx="17.5" cy="70" r="1.6" fill="#2a1c0c" stroke="#6e4c22" strokeWidth="0.7"/>

      <Vignette id="rw-mine-vin"/>
    </svg>
  )
}

export function BarracksArt({ size = 72, glow = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id="rw-bar-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a1414"/>
          <stop offset="100%" stopColor="#0d0607"/>
        </linearGradient>
        <linearGradient id="rw-bar-stone" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#5e4c42"/>
          <stop offset="100%" stopColor="#2c211c"/>
        </linearGradient>
        <linearGradient id="rw-bar-stonedark" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#4a3a32"/>
          <stop offset="100%" stopColor="#221813"/>
        </linearGradient>
        <linearGradient id="rw-bar-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#241510"/>
          <stop offset="100%" stopColor="#110a06"/>
        </linearGradient>
        <linearGradient id="rw-bar-banner" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a82c2c"/>
          <stop offset="100%" stopColor="#581414"/>
        </linearGradient>
      </defs>

      <rect width="72" height="72" rx="8" fill="url(#rw-bar-sky)"/>
      {glow && <rect width="72" height="72" rx="8" fill="#c03828" fillOpacity="0.06"/>}

      <circle cx="10" cy="10" r="0.6" fill="#d8c0a0" opacity="0.45"/>
      <circle cx="33" cy="6" r="0.5" fill="#d8c0a0" opacity="0.35"/>
      <circle cx="64" cy="13" r="0.6" fill="#d8c0a0" opacity="0.4"/>

      {/* Ground */}
      <rect x="0" y="60" width="72" height="12" fill="url(#rw-bar-ground)"/>
      <line x1="0" y1="60" x2="72" y2="60" stroke="#3c281e" strokeWidth="0.8" opacity="0.7"/>

      {/* Flanking towers */}
      <rect x="9" y="26" width="13" height="36" fill="url(#rw-bar-stonedark)" stroke="#6a5040" strokeWidth="0.8"/>
      <rect x="50" y="26" width="13" height="36" fill="url(#rw-bar-stonedark)" stroke="#6a5040" strokeWidth="0.8"/>
      {/* Tower merlons */}
      {[8, 13.5, 19].map(x => (
        <rect key={`l${x}`} x={x} y="20" width="4" height="7" fill="url(#rw-bar-stonedark)" stroke="#6a5040" strokeWidth="0.7"/>
      ))}
      {[49, 54.5, 60].map(x => (
        <rect key={`r${x}`} x={x} y="20" width="4" height="7" fill="url(#rw-bar-stonedark)" stroke="#6a5040" strokeWidth="0.7"/>
      ))}
      {/* Arrow slits, lit from inside */}
      <rect x="14.5" y="34" width="2.5" height="8" rx="1.2" fill="#060303"/>
      <rect x="14.5" y="34" width="2.5" height="8" rx="1.2" fill="#c06820" opacity="0.3"/>
      <rect x="55" y="34" width="2.5" height="8" rx="1.2" fill="#060303"/>
      <rect x="55" y="34" width="2.5" height="8" rx="1.2" fill="#c06820" opacity="0.3"/>
      {/* Stone joints */}
      <line x1="10" y1="46" x2="21" y2="46" stroke="#1e1410" strokeWidth="0.6" opacity="0.8"/>
      <line x1="51" y1="46" x2="62" y2="46" stroke="#1e1410" strokeWidth="0.6" opacity="0.8"/>

      {/* Central gatehouse wall */}
      <rect x="22" y="36" width="28" height="26" fill="url(#rw-bar-stone)" stroke="#6a5040" strokeWidth="0.8"/>
      {[23, 33.5, 44].map(x => (
        <rect key={x} x={x} y="31" width="5" height="6" fill="url(#rw-bar-stone)" stroke="#6a5040" strokeWidth="0.7"/>
      ))}
      <line x1="22" y1="44" x2="50" y2="44" stroke="#1e1410" strokeWidth="0.6" opacity="0.7"/>
      <line x1="22" y1="52" x2="50" y2="52" stroke="#1e1410" strokeWidth="0.6" opacity="0.7"/>

      {/* Gate with portcullis */}
      <path d="M30,62 L30,50 Q30,43 36,43 Q42,43 42,50 L42,62 Z" fill="#070303"/>
      <ellipse cx="36" cy="60" rx="5" ry="4" fill="#c06820" opacity="0.25"/>
      <g stroke="#4a3420" strokeWidth="0.9" opacity="0.85">
        <line x1="32.5" y1="45.5" x2="32.5" y2="62"/>
        <line x1="36" y1="43.5" x2="36" y2="62"/>
        <line x1="39.5" y1="45.5" x2="39.5" y2="62"/>
        <line x1="30.5" y1="49" x2="41.5" y2="49"/>
        <line x1="30" y1="55" x2="42" y2="55"/>
      </g>

      {/* Torches flanking the gate */}
      <circle cx="26" cy="45" r="5" fill="#ff8830" opacity="0.22"/>
      <path d="M26,42 q1.6,2.2 0,4.4 q-1.6,-2.2 0,-4.4" fill="#ffb050"/>
      <line x1="26" y1="46.5" x2="26" y2="49" stroke="#3a2a14" strokeWidth="1"/>
      <circle cx="46" cy="45" r="5" fill="#ff8830" opacity="0.22"/>
      <path d="M46,42 q1.6,2.2 0,4.4 q-1.6,-2.2 0,-4.4" fill="#ffb050"/>
      <line x1="46" y1="46.5" x2="46" y2="49" stroke="#3a2a14" strokeWidth="1"/>

      {/* War banner above the gate */}
      <path d="M32,36 L40,36 L40,47 L36,44.2 L32,47 Z" fill="url(#rw-bar-banner)" stroke="#c04040" strokeWidth="0.4" strokeOpacity="0.5"/>
      <circle cx="36" cy="40" r="1.8" fill="#e8c050" opacity="0.9"/>

      {/* Tower pennants */}
      <line x1="15.5" y1="12" x2="15.5" y2="21" stroke="#8a7050" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M15.5,12 L24,14.5 L15.5,17 Z" fill="#a82c2c"/>
      <line x1="56.5" y1="12" x2="56.5" y2="21" stroke="#8a7050" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M56.5,12 L48,14.5 L56.5,17 Z" fill="#a82c2c"/>

      {/* Shield leaning by the gate */}
      <circle cx="25" cy="58" r="3" fill="#5a3424" stroke="#8a6840" strokeWidth="0.8"/>
      <circle cx="25" cy="58" r="0.9" fill="#a8845a"/>

      <Vignette id="rw-bar-vin"/>
    </svg>
  )
}

// Star-fort geometry (aerial view): pentagon bastion tips + inner wall midpoints
const FORT_STAR = '36,5 46,23.2 66.4,27.1 52.2,42.3 54.8,62.9 36,54 17.2,62.9 19.8,42.3 5.6,27.1 26,23.2'
const FORT_STAR_INNER = '36,12 43.8,26.2 59.8,29.3 48.6,41.1 50.7,57.2 36,50.3 21.3,57.2 23.4,41.1 12.2,29.3 28.2,26.2'
const FORT_COURTYARD = '36,25 47.4,33.3 43.1,46.7 28.9,46.7 24.6,33.3'
const FORT_TIPS = [[36, 5], [66.4, 27.1], [54.8, 62.9], [17.2, 62.9], [5.6, 27.1]]

export function FortArt({ size = 72, glow = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <radialGradient id="rw-fort-terrain" cx="45%" cy="40%" r="75%">
          <stop offset="0%" stopColor="#27331a"/>
          <stop offset="100%" stopColor="#0c120a"/>
        </radialGradient>
        <linearGradient id="rw-fort-rampart" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#48652f"/>
          <stop offset="100%" stopColor="#1e2c16"/>
        </linearGradient>
        <linearGradient id="rw-fort-court" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#36502a"/>
          <stop offset="100%" stopColor="#1c2c14"/>
        </linearGradient>
        <radialGradient id="rw-fort-tower" cx="35%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#4e6c3a"/>
          <stop offset="100%" stopColor="#22341c"/>
        </radialGradient>
      </defs>

      <rect width="72" height="72" rx="8" fill="url(#rw-fort-terrain)"/>
      {glow && <rect width="72" height="72" rx="8" fill="#3a7838" fillOpacity="0.07"/>}

      {/* Field texture */}
      <circle cx="12" cy="14" r="1" fill="#36482a" opacity="0.4"/>
      <circle cx="62" cy="12" r="1.3" fill="#36482a" opacity="0.35"/>
      <circle cx="65" cy="50" r="1" fill="#36482a" opacity="0.4"/>
      <circle cx="9" cy="48" r="1.2" fill="#36482a" opacity="0.35"/>

      {/* Moat ring */}
      <polygon points={FORT_STAR} fill="#14282e" stroke="#14282e" strokeWidth="7" strokeLinejoin="round" opacity="0.85"/>
      <polygon points={FORT_STAR} fill="none" stroke="#2a4e58" strokeWidth="8.5" strokeLinejoin="round" opacity="0.2"/>

      {/* Drop shadow */}
      <polygon points={FORT_STAR} transform="translate(1.5,2.5)" fill="#000" opacity="0.35"/>

      {/* Ramparts */}
      <polygon points={FORT_STAR} fill="url(#rw-fort-rampart)" stroke="#5d7c44" strokeWidth="1.2" strokeLinejoin="round"/>
      {/* Inner walkway */}
      <polygon points={FORT_STAR_INNER} fill="#243818" stroke="#3c5830" strokeWidth="0.8" strokeLinejoin="round"/>

      {/* Courtyard */}
      <polygon points={FORT_COURTYARD} fill="url(#rw-fort-court)" stroke="#4a6838" strokeWidth="1"/>

      {/* Bastion tip towers */}
      {FORT_TIPS.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="3.2" fill="url(#rw-fort-tower)" stroke="#5d7c44" strokeWidth="1"/>
          <circle cx={x} cy={y} r="1" fill="#6a8850"/>
        </g>
      ))}

      {/* Central keep with standard */}
      <circle cx="36" cy="38" r="4" fill="url(#rw-fort-tower)" stroke="#5d7c44" strokeWidth="1"/>
      <circle cx="36" cy="31" r="6" fill="#6aa050" opacity="0.15"/>
      <line x1="36" y1="38" x2="36" y2="27.5" stroke="#8a9a70" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M36,27.5 L44.5,30 L36,32.5 Z" fill="#5a8a4a"/>

      <Vignette id="rw-fort-vin"/>
    </svg>
  )
}

export function CapitalArt({ size = 72, color = '#c9a020' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <radialGradient id="rw-cap-bg" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="#2c2210"/>
          <stop offset="100%" stopColor="#0d0a05"/>
        </radialGradient>
        <linearGradient id="rw-cap-gold" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#f0c850"/>
          <stop offset="100%" stopColor="#8a5f18"/>
        </linearGradient>
        <linearGradient id="rw-cap-golddark" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#c89830"/>
          <stop offset="100%" stopColor="#6a4a14"/>
        </linearGradient>
        <radialGradient id="rw-cap-aura" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0.28"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </radialGradient>
      </defs>

      <rect width="72" height="72" rx="8" fill="url(#rw-cap-bg)"/>

      {/* Aura behind the crown */}
      <ellipse cx="36" cy="36" rx="26" ry="22" fill="url(#rw-cap-aura)"/>

      {/* Royal cushion */}
      <ellipse cx="36" cy="57" rx="23" ry="6.5" fill="#2a1430" stroke="#4a2858" strokeWidth="0.8"/>
      <ellipse cx="36" cy="55.5" rx="18" ry="3.5" fill="#3a2044" opacity="0.7"/>

      {/* Outer spires */}
      <path d="M14,46 L16.5,31 L23,46 Z" fill="url(#rw-cap-golddark)" stroke="#a8852c" strokeWidth="0.7"/>
      <path d="M58,46 L55.5,31 L49,46 Z" fill="url(#rw-cap-golddark)" stroke="#a8852c" strokeWidth="0.7"/>
      {/* Mid spires */}
      <path d="M19,46 L25,22 L32,46 Z" fill="url(#rw-cap-golddark)" stroke="#c89c38" strokeWidth="0.7"/>
      <path d="M53,46 L47,22 L40,46 Z" fill="url(#rw-cap-golddark)" stroke="#c89c38" strokeWidth="0.7"/>
      {/* Center spire */}
      <path d="M28,46 L36,13 L44,46 Z" fill="url(#rw-cap-gold)" stroke="#f0d070" strokeWidth="0.7"/>
      <path d="M36,13 L31,34" fill="none" stroke="#ffe9a0" strokeWidth="0.8" opacity="0.5"/>

      {/* Spire orbs - player color */}
      <circle cx="25" cy="21" r="1.7" fill={color} opacity="0.9"/>
      <circle cx="47" cy="21" r="1.7" fill={color} opacity="0.9"/>
      <circle cx="36" cy="11.5" r="2.7" fill={color}/>
      <circle cx="35.1" cy="10.6" r="0.9" fill="#fff8e0" opacity="0.85"/>

      {/* Crown band */}
      <rect x="14" y="44" width="44" height="11" rx="3" fill="url(#rw-cap-gold)" stroke="#f8e090" strokeWidth="0.6"/>
      <line x1="16" y1="46.5" x2="56" y2="46.5" stroke="#7a5618" strokeWidth="0.6" opacity="0.6"/>
      <line x1="16" y1="52.5" x2="56" y2="52.5" stroke="#7a5618" strokeWidth="0.6" opacity="0.6"/>

      {/* Band gems - faceted diamonds in player color */}
      {[24, 36, 48].map(x => (
        <g key={x}>
          <path d={`M${x},46.4 L${x + 2.7},49.5 L${x},52.6 L${x - 2.7},49.5 Z`} fill={color} stroke="#fff" strokeWidth="0.4" strokeOpacity="0.4"/>
          <path d={`M${x},46.4 L${x + 2.7},49.5 L${x},49.5 Z`} fill="#fff" opacity="0.3"/>
        </g>
      ))}

      {/* Sparkles */}
      <Glint x={20} y={16} s={0.9}/>
      <Glint x={54} y={14} s={0.7} opacity={0.6}/>
      <Glint x={60} y={38} s={0.7} opacity={0.55}/>

      <Vignette id="rw-cap-vin"/>
    </svg>
  )
}

// ── Animated troop figure ─────────────────────────────────────────────────────

const MARCH_CSS = `
@keyframes rwBob {
  0%,100% { transform: translateY(0) }
  50%      { transform: translateY(-0.8px) }
}
@keyframes rwLegA {
  0%,100% { transform: rotate(20deg) }
  50%      { transform: rotate(-20deg) }
}
@keyframes rwLegB {
  0%,100% { transform: rotate(-20deg) }
  50%      { transform: rotate(20deg) }
}
@keyframes rwSway {
  0%,100% { transform: rotate(-2.5deg) }
  50%      { transform: rotate(2.5deg) }
}
`

export function TroopFigure({ color = '#c9b99a', size = 22, animate = false, count = null }) {
  const id = `tf-${color.replace('#', '')}`
  const legStyle = (anim) => animate
    ? { animation: `${anim} 0.5s ease-in-out infinite`, transformBox: 'fill-box', transformOrigin: 'center top' }
    : {}
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <style>{MARCH_CSS}</style>
      <svg width={size} height={size} viewBox="0 0 22 22" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </radialGradient>
        </defs>

        {animate && <circle cx="11" cy="11" r="10.5" fill={`url(#${id}-glow)`}/>}

        {/* Ground shadow */}
        <ellipse cx="11" cy="21.2" rx="4.5" ry="1" fill="#000" opacity="0.3"/>

        {/* Legs - swing from the hip when marching */}
        <line
          x1="9.4" y1="14.6" x2={animate ? 9.4 : 8.2} y2="20.6"
          stroke={color} strokeWidth="2.2" strokeLinecap="round" opacity="0.85"
          style={legStyle('rwLegA')}
        />
        <line
          x1="12.6" y1="14.6" x2={animate ? 12.6 : 13.8} y2="20.6"
          stroke={color} strokeWidth="2.2" strokeLinecap="round" opacity="0.85"
          style={legStyle('rwLegB')}
        />

        {/* Body group bobs as one */}
        <g style={animate ? { animation: 'rwBob 0.5s ease-in-out infinite' } : {}}>
          {/* Spear - wooden shaft, steel head */}
          <g style={animate ? { animation: 'rwSway 1s ease-in-out infinite', transformBox: 'fill-box', transformOrigin: 'center 80%' } : {}}>
            <line x1="16.4" y1="3.4" x2="16.4" y2="16.5" stroke="#9a8868" strokeWidth="1.1" strokeLinecap="round"/>
            <path d="M16.4,0.6 L17.9,3.8 L14.9,3.8 Z" fill="#b8c0c8"/>
            <path d="M16.4,0.6 L17.9,3.8 L16.4,3.8 Z" fill="#7a848c"/>
          </g>

          {/* Torso */}
          <rect x="8" y="8.2" width="6.4" height="7" rx="2" fill={color}/>
          <path d="M11.2,8.2 L14.4,8.2 L14.4,13.2 Q14.4,15.2 12.4,15.2 L11.2,15.2 Z" fill="#000" opacity="0.18"/>
          <line x1="8.3" y1="12.8" x2="14.1" y2="12.8" stroke="#000" strokeWidth="0.8" opacity="0.3"/>

          {/* Helmet with face shadow */}
          <path d="M7.7,6.4 Q7.7,1.7 11.1,1.7 Q14.5,1.7 14.5,6.4 Z" fill={color}/>
          <path d="M8.7,4.2 Q9.1,2.7 10.6,2.5" fill="none" stroke="#fff" strokeWidth="0.7" opacity="0.4" strokeLinecap="round"/>
          <rect x="8.2" y="5.7" width="5.8" height="1.5" rx="0.75" fill="#000" opacity="0.45"/>
          <rect x="10.6" y="5" width="1" height="2.6" rx="0.5" fill={color}/>

          {/* Round shield */}
          <circle cx="5.9" cy="11.6" r="3.3" fill={color} opacity="0.9"/>
          <circle cx="5.9" cy="11.6" r="3.3" fill="none" stroke="#000" strokeWidth="0.8" strokeOpacity="0.35"/>
          <circle cx="5.9" cy="11.6" r="1.1" fill="#000" opacity="0.3"/>
          <path d="M3.6,9.6 Q4.5,8.5 5.9,8.4" fill="none" stroke="#fff" strokeWidth="0.6" opacity="0.4" strokeLinecap="round"/>
        </g>
      </svg>

      {/* Troop count badge */}
      {count !== null && (
        <div style={{
          position: 'absolute', bottom: -4, right: -6,
          background: '#14101e', border: `1px solid ${color}`,
          borderRadius: 6, padding: '0px 3px',
          fontSize: 9, color, fontFamily: 'Georgia, serif', fontWeight: 700,
          lineHeight: '13px', minWidth: 14, textAlign: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,0.6)',
        }}>
          {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}
        </div>
      )}
    </div>
  )
}

// ── Building icon (small, for map overlay or compact display) ─────────────────

export function BuildingIcon({ type, size = 18 }) {
  if (type === 'mine') {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" style={{ display: 'block' }}>
        <defs>
          <radialGradient id="rw-bi-mine" cx="40%" cy="35%" r="80%">
            <stop offset="0%" stopColor="#2c1f0e"/>
            <stop offset="100%" stopColor="#120b04"/>
          </radialGradient>
        </defs>
        <circle cx="9" cy="9" r="8.5" fill="url(#rw-bi-mine)" stroke="#8a6228" strokeWidth="1"/>
        {/* Mountain */}
        <path d="M2,14 L7,6.5 L10,9 L13,4.5 L16,14 Z" fill="#46300f"/>
        <path d="M2,14 L7,6.5 L10,9 L13,4.5" fill="none" stroke="#6a4a1e" strokeWidth="0.6" opacity="0.8"/>
        {/* Tunnel with glow */}
        <path d="M6.5,14 L6.5,11 Q6.5,8.8 9,8.8 Q11.5,8.8 11.5,11 L11.5,14 Z" fill="#070402"/>
        <ellipse cx="9" cy="13" rx="1.8" ry="1.4" fill="#ff9838" opacity="0.45"/>
        {/* Crossbeam */}
        <line x1="5.8" y1="10.6" x2="12.2" y2="10.6" stroke="#8a6228" strokeWidth="1.2" strokeLinecap="round"/>
        {/* Gold glint */}
        <circle cx="4.8" cy="9.2" r="1.1" fill="#e8a832"/>
        <circle cx="4.5" cy="8.9" r="0.4" fill="#ffe9a0"/>
      </svg>
    )
  }
  if (type === 'barracks') {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" style={{ display: 'block' }}>
        <defs>
          <radialGradient id="rw-bi-bar" cx="40%" cy="35%" r="80%">
            <stop offset="0%" stopColor="#241414"/>
            <stop offset="100%" stopColor="#0e0707"/>
          </radialGradient>
          <linearGradient id="rw-bi-bar-stone" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="#564238"/>
            <stop offset="100%" stopColor="#2a1d16"/>
          </linearGradient>
        </defs>
        <circle cx="9" cy="9" r="8.5" fill="url(#rw-bi-bar)" stroke="#7a5038" strokeWidth="1"/>
        {/* Tower */}
        <rect x="5" y="8" width="8" height="7" fill="url(#rw-bi-bar-stone)" stroke="#6a5040" strokeWidth="0.5"/>
        {/* Battlements */}
        <rect x="4.6" y="5.5" width="2.6" height="3.2" fill="url(#rw-bi-bar-stone)" stroke="#6a5040" strokeWidth="0.5"/>
        <rect x="10.8" y="5.5" width="2.6" height="3.2" fill="url(#rw-bi-bar-stone)" stroke="#6a5040" strokeWidth="0.5"/>
        {/* Gate with glow */}
        <path d="M7.6,15 L7.6,12.4 Q7.6,11 9,11 Q10.4,11 10.4,12.4 L10.4,15 Z" fill="#070303"/>
        <ellipse cx="9" cy="14.2" rx="1.2" ry="0.9" fill="#e08030" opacity="0.5"/>
        {/* Banner */}
        <line x1="9" y1="2.2" x2="9" y2="6.2" stroke="#8a7050" strokeWidth="1"/>
        <path d="M9,2.2 L14,3.7 L9,5.2 Z" fill="#a82c2c"/>
      </svg>
    )
  }
  if (type === 'fort') {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" style={{ display: 'block' }}>
        <defs>
          <radialGradient id="rw-bi-fort" cx="40%" cy="35%" r="80%">
            <stop offset="0%" stopColor="#162012"/>
            <stop offset="100%" stopColor="#080e08"/>
          </radialGradient>
          <linearGradient id="rw-bi-fort-wall" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#446030"/>
            <stop offset="100%" stopColor="#1c2a16"/>
          </linearGradient>
        </defs>
        <circle cx="9" cy="9" r="8.5" fill="url(#rw-bi-fort)" stroke="#4e6a3c" strokeWidth="1"/>
        {/* Mini star fort */}
        <polygon
          points="9,1.8 11.4,6.1 16.1,7 12.8,10.5 13.4,15.4 9,13.3 4.6,15.4 5.2,10.5 1.9,7 6.6,6.1"
          fill="url(#rw-bi-fort-wall)" stroke="#5d7c44" strokeWidth="0.8" strokeLinejoin="round"
        />
        {/* Courtyard + keep */}
        <polygon points="9,6.3 11.6,8.2 10.6,11.3 7.4,11.3 6.4,8.2" fill="#243818" stroke="#3c5830" strokeWidth="0.5"/>
        <circle cx="9" cy="9" r="1.2" fill="#6a8850"/>
      </svg>
    )
  }
  return null
}
