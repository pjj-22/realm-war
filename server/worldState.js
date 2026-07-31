// The H3 resolution the *currently active* season is using. Lives in its own
// tiny module (not season.js) specifically to avoid a circular import: season.js
// already imports respawnBots from bots.js, and bots.js needs to read this value
// too - importing season.js directly from bots.js would create a cycle.
// ES module bindings are live, so `import { activeResolution } from './worldState.js'`
// always sees the current value after setActiveResolution() runs, without
// needing a getter function at every call site.
import { HEX_RESOLUTION } from './config.js'

export let activeResolution = HEX_RESOLUTION

export function setActiveResolution(resolution) {
  activeResolution = resolution
}
