// Gold only ever changes at discrete server events (a tick, plunder, spend) -
// there's nothing to smooth between them, so this just reflects the last
// synced value directly instead of predicting a continuous increase.
export function useResourceTicker(player) {
  return { display: { gold: player?.gold ?? 0 } }
}
