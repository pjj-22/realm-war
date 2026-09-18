// Reports a completed onboarding action to FTUEGuide. Fired from the spots
// where train/march/build actually succeed (BottomDrawer, GameMap) so the
// guide advances on the deed, not on a "Got it" click. Same window-event
// pattern as toastBus/rw:flyto - the guide sits in App, the actions happen
// several components away.
export function ftueProgress(step) {
  window.dispatchEvent(new CustomEvent('rw:ftue', { detail: step }))
}
