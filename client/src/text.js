// Strip pictographic emojis (legacy DB rows wrote them into messages;
// icons are rendered from event type now)
export function stripEmoji(s) {
  return (s || '').replace(/(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F})\s*/gu, '')
}

// A short, glanceable tag for a specific hex - h3 indices pad unused finer
// resolution digits with trailing 'f's, and nearby hexes share a long common
// prefix (same region), so neither end of the raw string is very useful on
// its own. Strip the padding, then keep just enough of the tail to actually
// tell hexes apart. Shared between BottomDrawer (display) and GameMap
// (search) so the two can never fall out of sync.
export function shortHex(h3) {
  if (!h3) return ''
  return h3.replace(/f+$/, '').slice(-6).toUpperCase()
}
