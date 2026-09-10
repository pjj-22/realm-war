// Single source of truth for UI chrome colors and header type. Gameplay-map
// paint colors in GameMap.jsx (territory ownership, fog, threat markers) are
// a separate concern and intentionally do not live here.
export const theme = {
  bg: '#0a0a14',
  surface: '#14101e',
  surfaceRaised: '#1c1630',
  border: '#3a2e22',
  borderStrong: '#6a5030',
  text: {
    primary: '#c9b99a',
    secondary: '#a89880',
    tertiary: '#8a7a68',
  },
  accent: '#c9a040',
  accentStrong: '#e0c070',
  accentText: '#1c1408', // text color for on-accent surfaces (solid gold buttons)
  danger: '#c0453f',
  success: '#6a9a5a',
  steel: '#5878a0',
  headerFont: "'Cinzel', Georgia, serif",
}
