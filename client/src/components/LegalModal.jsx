import { useState } from 'react'
import { useViewportOverlayFix } from '../hooks/useViewportOverlayFix'
import { theme } from '../theme'

// Contact address shown in the policy - set VITE_CONTACT_EMAIL at build time.
const CONTACT = import.meta.env.VITE_CONTACT_EMAIL || 'the site operator'
const UPDATED = 'August 2026'

const S = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 250, padding: 16,
  },
  box: {
    background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 8,
    padding: '28px 32px', width: '100%', maxWidth: 560,
    maxHeight: '100%', overflowY: 'auto',
    fontFamily: 'Georgia, serif', color: theme.text.primary,
    boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
  },
  tabs: { display: 'flex', gap: 8, marginBottom: 18, borderBottom: `1px solid ${theme.border}` },
  tab: (active) => ({
    padding: '8px 14px', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase',
    cursor: 'pointer', border: 'none', background: 'none',
    color: active ? theme.accentStrong : theme.text.secondary,
    borderBottom: active ? `2px solid ${theme.accentStrong}` : '2px solid transparent',
    fontFamily: theme.headerFont,
  }),
  h: { fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: theme.accentStrong, margin: '16px 0 6px', fontFamily: theme.headerFont },
  p: { fontSize: 14, lineHeight: 1.6, color: theme.text.secondary, marginBottom: 8 },
  li: { fontSize: 14, lineHeight: 1.6, color: theme.text.secondary, marginBottom: 4 },
  meta: { fontSize: 12, color: theme.text.tertiary, marginBottom: 4 },
  btn: {
    width: '100%', padding: '11px', marginTop: 20,
    background: theme.accent, border: `1px solid ${theme.accentStrong}`,
    borderRadius: 5, color: theme.accentText, fontSize: 13, fontWeight: 600,
    letterSpacing: 3, textTransform: 'uppercase',
    fontFamily: theme.headerFont, cursor: 'pointer',
  },
}

function Privacy() {
  return (
    <div>
      <div style={S.meta}>Last updated: {UPDATED}</div>
      <p style={S.p}>
        RealmWar is a free browser strategy game. This policy explains what
        data it holds and why. It is written to be short and honest rather
        than exhaustive.
      </p>

      <div style={S.h}>What is collected</div>
      <ul>
        <li style={S.li}><b>Account:</b> the username and password you choose (the password is stored only as a bcrypt hash), your chosen faction colour, and an optional flag design and motto.</li>
        <li style={S.li}><b>Gameplay:</b> the territory, buildings, armies, battles, alliance membership, and event history your account generates by playing.</li>
        <li style={S.li}><b>Technical:</b> your IP address is used transiently for rate-limiting and appears in standard server access logs. Login dates and a login streak counter are stored.</li>
        <li style={S.li}><b>Push notifications:</b> if you enable them, the browser push subscription for that device is stored so the game can alert you to attacks. Disable them any time in the dispatches panel.</li>
      </ul>

      <div style={S.h}>What is not collected</div>
      <p style={S.p}>
        No real name, email address, phone number, or payment information is
        requested or stored. There are no third-party advertising or analytics
        trackers, and no cookies beyond a single local login token kept in
        your browser.
      </p>

      <div style={S.h}>How it is used</div>
      <p style={S.p}>
        Solely to run the game: authenticate you, simulate the world, show
        leaderboards and the public world feed, and send attack alerts you
        opted into. Data is not sold or shared, except as required to operate
        the service (hosting and database providers) or to comply with law.
      </p>

      <div style={S.h}>Public information</div>
      <p style={S.p}>
        Your username, faction colour, flag, motto, territory, and battle
        record are visible to other players in-game, on leaderboards, and in
        the world feed. Champion records are permanent by design.
      </p>

      <div style={S.h}>Retention and your choices</div>
      <ul>
        <li style={S.li}>You can export everything tied to your account as a JSON file from the account panel.</li>
        <li style={S.li}>You can delete your account from the account panel. This removes your profile details, live game presence, personal events, chat messages, and push subscriptions. De-identified references may remain in historical battle records and season standings.</li>
        <li style={S.li}>Server access logs rotate on the host's normal schedule.</li>
      </ul>

      <div style={S.h}>Age</div>
      <p style={S.p}>
        RealmWar is not directed at children. You must be at least 16 years
        old (or the digital-consent age in your country, if lower but not
        under 13) to create an account.
      </p>

      <div style={S.h}>Contact</div>
      <p style={S.p}>For data requests or questions, contact {CONTACT}.</p>
    </div>
  )
}

function Terms() {
  return (
    <div>
      <div style={S.meta}>Last updated: {UPDATED}</div>

      <div style={S.h}>The service</div>
      <p style={S.p}>
        RealmWar is provided free of charge, as-is and as-available, with no
        warranty. It is a hobby project: the world may be reset, wiped,
        rebalanced, or taken offline at any time, and seasons end and reset
        the map by design.
      </p>

      <div style={S.h}>Your account</div>
      <ul>
        <li style={S.li}>You are responsible for activity under your account and for keeping your password safe.</li>
        <li style={S.li}>One person may not use another player's account without permission.</li>
        <li style={S.li}>You must be 16 or older (or the digital-consent age in your country, not under 13).</li>
      </ul>

      <div style={S.h}>Fair play</div>
      <p style={S.p}>Do not:</p>
      <ul>
        <li style={S.li}>use bots, scripts, or automated clients, or exploit bugs instead of reporting them;</li>
        <li style={S.li}>attempt to disrupt, overload, or gain unauthorised access to the service;</li>
        <li style={S.li}>choose usernames, mottos, flags, alliance names, or chat messages that are hateful, harassing, threatening, sexual, or otherwise abusive, or that impersonate others.</li>
      </ul>
      <p style={S.p}>
        Accounts that break these rules may be suspended or removed without
        notice.
      </p>

      <div style={S.h}>User content</div>
      <p style={S.p}>
        You keep ownership of the names and designs you create, and grant the
        operator the right to display them within the game. Content you post
        in chat or as profile text may be moderated or removed.
      </p>

      <div style={S.h}>Liability</div>
      <p style={S.p}>
        To the fullest extent permitted by law, the operator is not liable for
        any loss arising from use of, or inability to use, RealmWar, including
        loss of game progress.
      </p>

      <div style={S.h}>Changes</div>
      <p style={S.p}>
        These terms may change; continued play after a change means you accept
        the updated terms.
      </p>

      <div style={S.h}>Contact</div>
      <p style={S.p}>Questions: {CONTACT}.</p>
    </div>
  )
}

export default function LegalModal({ initialTab = 'privacy', onClose }) {
  const overlayRef = useViewportOverlayFix()
  const [tab, setTab] = useState(initialTab)

  return (
    <div ref={overlayRef} style={S.overlay} onClick={onClose}>
      <div style={{ ...S.box, position: 'relative' }} onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 14, right: 18, background: 'none', border: 'none', color: theme.text.secondary, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>
          ×
        </button>
        <div style={S.tabs}>
          <button style={S.tab(tab === 'privacy')} onClick={() => setTab('privacy')}>Privacy</button>
          <button style={S.tab(tab === 'terms')} onClick={() => setTab('terms')}>Terms</button>
        </div>
        {tab === 'privacy' ? <Privacy /> : <Terms />}
        <button style={S.btn} onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
