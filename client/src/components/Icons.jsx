// Hand-drawn SVG icon set - replaces all pictographic emojis.
// Convention: 16×16 viewBox, thin parchment strokes, inline-block.

const base = (size) => ({ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, width: size, height: size })

function Svg({ size, children, title }) {
  return (
    <svg viewBox="0 0 16 16" style={base(size)} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  )
}

export function GoldIcon({ size = 13 }) {
  return (
    <Svg size={size}>
      <polygon points="8,1.5 13.6,4.7 13.6,11.3 8,14.5 2.4,11.3 2.4,4.7"
        fill="#c9902a" stroke="#e8b848" strokeWidth="1" />
    </Svg>
  )
}

export function ManaIcon({ size = 13 }) {
  return (
    <Svg size={size}>
      <polygon points="8,1.5 14.5,8 8,14.5 1.5,8" fill="#2a60b8" stroke="#5090e8" strokeWidth="1" />
    </Svg>
  )
}

export function SwordsIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <g stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none">
        <path d="M3 2.5l9 9M13 2.5l-9 9" />
        <path d="M10.6 11.4l-1.4 1.4M5.4 11.4l1.4 1.4" />
        <path d="M12.6 13.6l1 1M3.4 13.6l-1 1" strokeWidth="1.8" />
      </g>
    </Svg>
  )
}

export function CrownIcon({ size = 14, color = '#d4b060' }) {
  return (
    <Svg size={size}>
      <path d="M2.5 12.5v-7L6 8.6 8 3.5l2 5.1 3.5-3.1v7Z" fill={color} />
      <line x1="2.5" y1="12.5" x2="13.5" y2="12.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  )
}

export function FallenCrownIcon({ size = 14, color = '#9a7a6a' }) {
  return (
    <Svg size={size}>
      <g transform="rotate(32 8 8)">
        <path d="M3 11v-5l2.7 2.4L8 4.6l2.3 3.8L13 6v5Z" fill={color} opacity="0.85" />
      </g>
      <line x1="2" y1="14" x2="14" y2="14" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
    </Svg>
  )
}

export function BannerIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <line x1="4" y1="2" x2="4" y2="14.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 2.8h8.4l-2.2 2.6 2.2 2.6H4Z" fill={color} />
    </Svg>
  )
}

export function TrophyIcon({ size = 14, color = '#d4b060' }) {
  return (
    <Svg size={size}>
      <path d="M5 2.5h6V6a3 3 0 0 1-6 0Z" fill={color} />
      <path d="M5 3.5H2.8a2.4 2.4 0 0 0 2.4 2.9M11 3.5h2.2a2.4 2.4 0 0 1-2.4 2.9" fill="none" stroke={color} strokeWidth="1.2" />
      <rect x="7.2" y="8.7" width="1.6" height="2.6" fill={color} />
      <path d="M5.2 13.5c0-1.4 1.3-2.2 2.8-2.2s2.8.8 2.8 2.2Z" fill={color} />
    </Svg>
  )
}

const MEDAL_COLORS = ['#e0b84e', '#b8c0cc', '#c08850']
export function MedalIcon({ rank = 1, size = 15 }) {
  const c = MEDAL_COLORS[rank - 1] || '#8a7a9a'
  return (
    <Svg size={size}>
      <path d="M5.4 1.5h2L8 5 6 5.8Z" fill="#a04040" />
      <path d="M10.6 1.5h-2L8 5l2 .8Z" fill="#7a3030" />
      <circle cx="8" cy="9.6" r="4.6" fill={c} />
      <circle cx="8" cy="9.6" r="4.6" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
      <text x="8" y="11.8" textAnchor="middle" fontSize="6.4" fontFamily="Georgia, serif" fontWeight="bold" fill="rgba(20,12,4,0.85)">{rank}</text>
    </Svg>
  )
}

export function AllianceIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <g stroke={color} strokeWidth="1.3" strokeLinecap="round">
        <line x1="4.5" y1="3" x2="4.5" y2="14" />
        <line x1="11.5" y1="3" x2="11.5" y2="14" />
      </g>
      <path d="M4.5 3.4h4l-1 1.5 1 1.5h-4Z" fill={color} />
      <path d="M11.5 3.4h-4l1 1.5-1 1.5h4Z" fill={color} opacity="0.65" />
    </Svg>
  )
}

export function ShieldIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <path d="M8 1.8l5 1.9v4.1c0 3.3-3.4 5.6-5 6.4-1.6-.8-5-3.1-5-6.4V3.7Z" fill={color} opacity="0.9" />
      <path d="M8 4v8" stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
    </Svg>
  )
}

export function BellIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <path d="M8 2a4.2 4.2 0 0 1 4.2 4.2v2.9l1.3 2.2H2.5l1.3-2.2V6.2A4.2 4.2 0 0 1 8 2Z" fill={color} />
      <path d="M6.5 12.6a1.6 1.6 0 0 0 3 0" fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
    </Svg>
  )
}

export function BellOffIcon({ size = 14, color = '#7a6890' }) {
  return (
    <Svg size={size}>
      <path d="M8 2a4.2 4.2 0 0 1 4.2 4.2v2.9l1.3 2.2H2.5l1.3-2.2V6.2A4.2 4.2 0 0 1 8 2Z" fill={color} opacity="0.55" />
      <line x1="2.2" y1="2.2" x2="13.8" y2="13.8" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  )
}

export function FlameIcon({ size = 14, color = '#e08040' }) {
  return (
    <Svg size={size}>
      <path d="M8 1.8c.9 2.4 4 3.6 4 7a4 4 0 0 1-8 0c0-2.5 2.6-3.6 4-7Z" fill={color} />
      <path d="M8 7.5c.5 1.2 1.6 1.7 1.6 3a1.6 1.6 0 0 1-3.2 0c0-1.1 1.1-1.8 1.6-3Z" fill="#f0d080" />
    </Svg>
  )
}

export function BowIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <path d="M3.5 2.5a11 11 0 0 1 10 10" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <line x1="3.5" y1="2.5" x2="13.5" y2="12.5" stroke={color} strokeWidth="0.9" opacity="0.7" />
      <line x1="2" y1="14" x2="9.5" y2="6.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M9.8 6.2l-2.6.4 2.2 2.2.4-2.6Z" fill={color} />
    </Svg>
  )
}

export function SkullIcon({ size = 14, color = '#b0a090' }) {
  return (
    <Svg size={size}>
      <path d="M8 1.8a5 5 0 0 1 5 5c0 1.8-1 2.8-1.8 3.6v2.1h-6.4V10.4C4 9.6 3 8.6 3 6.8a5 5 0 0 1 5-5Z" fill={color} />
      <circle cx="6.1" cy="6.8" r="1.2" fill="#14101e" />
      <circle cx="9.9" cy="6.8" r="1.2" fill="#14101e" />
      <path d="M6.5 12.5v1.6M8 12.5v1.6M9.5 12.5v1.6" stroke={color} strokeWidth="1" strokeLinecap="round" />
    </Svg>
  )
}

export function PickaxeIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <line x1="5" y1="13.5" x2="10.8" y2="4.4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 5.8C6.5 2.2 11 2 13.3 4.4c-1.8-.5-4.3-.3-6 .8Z" fill={color} />
    </Svg>
  )
}

export function KeepIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <path d="M3.5 14V5.5h1.6V3.8h1.8v1.7h2.2V3.8h1.8v1.7h1.6V14Z" fill={color} />
      <path d="M7 14v-3a1 1 0 0 1 2 0v3Z" fill="#14101e" />
    </Svg>
  )
}

export function TentIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <path d="M2.5 13.5L8 3.5l5.5 10Z" fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 13.5V9.8" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </Svg>
  )
}

export function CheckIcon({ size = 14, color = '#7ab060' }) {
  return (
    <Svg size={size}>
      <path d="M3 8.6l3.4 3.6L13 4.2" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function LeafIcon({ size = 14, color = '#a08a50' }) {
  return (
    <Svg size={size}>
      <path d="M13 3c-6.5.5-9 4-9.5 10C9 12.5 12.5 9.5 13 3Z" fill={color} />
      <path d="M4.5 12C6.5 9 9 6.5 12 4.5" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="0.9" />
    </Svg>
  )
}

export function ChartIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <path d="M3 2.5V13h10.5" fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M4.8 10.6l3-3.4 1.8 1.6 3.4-4.4" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function ScrollIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <rect x="3" y="3.5" width="10" height="9.5" rx="1" fill="none" stroke={color} strokeWidth="1.3" />
      <path d="M5.2 6.5h5.6M5.2 8.8h5.6M5.2 11h3.4" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
    </Svg>
  )
}

export function ChatIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <path d="M2.5 3.5h11v7.2H7.6L4.8 13.2v-2.5H2.5Z" fill={color} />
    </Svg>
  )
}

export function SearchIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <circle cx="7" cy="7" r="4.2" fill="none" stroke={color} strokeWidth="1.5" />
      <line x1="10.2" y1="10.2" x2="14" y2="14" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  )
}

export function SpeakerIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <path d="M2.5 6h2.4L8.5 3v10L4.9 10H2.5Z" fill={color} />
      <path d="M10.5 5.5a3.6 3.6 0 0 1 0 5M12.4 4a6 6 0 0 1 0 8" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </Svg>
  )
}

export function SpeakerOffIcon({ size = 14, color = '#7a6890' }) {
  return (
    <Svg size={size}>
      <path d="M2.5 6h2.4L8.5 3v10L4.9 10H2.5Z" fill={color} opacity="0.55" />
      <line x1="10.2" y1="6" x2="14" y2="10" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <line x1="14" y1="6" x2="10.2" y2="10" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </Svg>
  )
}

export function GlobeIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="5.6" fill="none" stroke={color} strokeWidth="1.3" />
      <ellipse cx="8" cy="8" rx="2.5" ry="5.6" fill="none" stroke={color} strokeWidth="1" />
      <line x1="2.4" y1="8" x2="13.6" y2="8" stroke={color} strokeWidth="1" />
    </Svg>
  )
}

export function WaveIcon({ size = 14, color = '#6090c0' }) {
  return (
    <Svg size={size}>
      <path d="M2 6.5q2-2.4 4 0t4 0 4 0M2 10.5q2-2.4 4 0t4 0 4 0" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </Svg>
  )
}

export function TargetIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="5.6" fill="none" stroke={color} strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2.8" fill="none" stroke={color} strokeWidth="1.2" />
      <circle cx="8" cy="8" r="0.9" fill={color} />
    </Svg>
  )
}

export function BoltIcon({ size = 14, color = '#d4c050' }) {
  return (
    <Svg size={size}>
      <path d="M9.2 1.5L3.8 9h3.2l-.8 5.5L11.8 7H8.6Z" fill={color} />
    </Svg>
  )
}

export function BotIcon({ size = 14, color = '#c9b99a' }) {
  return (
    <Svg size={size}>
      <rect x="3.5" y="5.5" width="9" height="7.5" rx="1.5" fill="none" stroke={color} strokeWidth="1.3" />
      <circle cx="6.2" cy="9" r="1" fill={color} />
      <circle cx="9.8" cy="9" r="1" fill={color} />
      <line x1="8" y1="5.5" x2="8" y2="3.2" stroke={color} strokeWidth="1.2" />
      <circle cx="8" cy="2.6" r="0.9" fill={color} />
    </Svg>
  )
}

// Plague doctor mask - hooded head with the long beak
export function PlagueIcon({ size = 14, color = '#9ab080' }) {
  return (
    <Svg size={size}>
      <path d="M4 3.5a4.5 4.5 0 0 1 6.5 1.2l3.6 4.6-4.9-1.1c-.4 2.6-2.3 4.3-5.2 4.3-1.5-2.8-1.6-6.5 0-9Z" fill={color} />
      <circle cx="6.8" cy="6.4" r="1" fill="#14101e" />
      <line x1="10.6" y1="7.4" x2="13" y2="8.6" stroke="#14101e" strokeWidth="0.7" opacity="0.5" />
    </Svg>
  )
}

// Falling comet with motion streaks
export function MeteorIcon({ size = 14, color = '#e09050' }) {
  return (
    <Svg size={size}>
      <circle cx="10.8" cy="10.8" r="2.8" fill={color} />
      <circle cx="10" cy="10" r="0.8" fill="#f0d080" />
      <line x1="1.5" y1="1.5" x2="7.8" y2="7.8" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <line x1="6" y1="2" x2="9.8" y2="5.8" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      <line x1="2" y1="6" x2="5.8" y2="9.8" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.6" />
    </Svg>
  )
}

// Withered wheat stalk, drooping and shedding a grain
export function FamineIcon({ size = 14, color = '#b09050' }) {
  return (
    <Svg size={size}>
      <path d="M8 14C8 9 8.5 6 11 3.5" fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M9.2 8.2c-1.5-.3-2.4-1.2-2.7-2.7 1.5.3 2.4 1.2 2.7 2.7Z" fill={color} />
      <path d="M9.8 5.9c-1.3-.6-1.9-1.6-1.9-3.1 1.3.6 1.9 1.6 1.9 3.1Z" fill={color} />
      <path d="M10 6.2c.2-1.4 1-2.3 2.4-2.8-.2 1.4-1 2.3-2.4 2.8Z" fill={color} opacity="0.7" />
      <circle cx="4.8" cy="12.2" r="0.9" fill={color} opacity="0.6" />
    </Svg>
  )
}

// Raised pitchfork - peasant revolt
export function RevoltIcon({ size = 14, color = '#c07050' }) {
  return (
    <Svg size={size}>
      <line x1="8" y1="14" x2="8" y2="5.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4.6 1.8v3.4a1.2 1.2 0 0 0 1.2 1.2h4.4a1.2 1.2 0 0 0 1.2-1.2V1.8" fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      <line x1="8" y1="1.8" x2="8" y2="5.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
    </Svg>
  )
}
