const S = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200, padding: 16,
  },
  box: {
    background: '#080502', border: '1px solid rgba(160,110,30,0.5)', borderRadius: 10,
    padding: '28px 32px', width: '100%', maxWidth: 480,
    maxHeight: '90vh', overflowY: 'auto',
    boxShadow: '0 0 60px rgba(160,100,20,0.3)',
    fontFamily: 'Georgia, serif', color: '#c9b99a',
  },
  title: {
    fontSize: 22, letterSpacing: 4, textTransform: 'uppercase',
    textAlign: 'center', marginBottom: 6, color: '#e0c070',
  },
  subtitle: {
    fontSize: 12, color: '#9a8060', textAlign: 'center',
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 24,
  },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 11, letterSpacing: 3, textTransform: 'uppercase',
    color: '#b08040', marginBottom: 10, borderBottom: '1px solid rgba(160,110,30,0.2)',
    paddingBottom: 4,
  },
  row: { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  icon: { fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0, marginTop: 1 },
  label: { fontSize: 13, color: '#e0c070', fontWeight: 'bold', marginBottom: 2 },
  desc: { fontSize: 12, color: '#9a8a7a', lineHeight: 1.5 },
  tip: {
    fontSize: 12, color: '#8a7860', lineHeight: 1.6, marginBottom: 6,
    paddingLeft: 12, borderLeft: '2px solid rgba(160,110,30,0.4)',
  },
  btn: {
    width: '100%', padding: '11px', marginTop: 8,
    background: 'rgba(150,100,20,0.3)', border: '1px solid rgba(200,150,40,0.5)',
    borderRadius: 5, color: '#d4b870', fontSize: 13,
    letterSpacing: 3, textTransform: 'uppercase',
    fontFamily: 'Georgia, serif', cursor: 'pointer',
  },
}

function Row({ icon, label, desc }) {
  return (
    <div style={S.row}>
      <span style={S.icon}>{icon}</span>
      <div>
        <div style={S.label}>{label}</div>
        <div style={S.desc}>{desc}</div>
      </div>
    </div>
  )
}

export default function HelpModal({ onClose }) {
  return (
    <div style={S.overlay}>
      <div style={{ ...S.box, position: 'relative' }}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 14, right: 18, background: 'none', border: 'none', color: '#7a6840', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>
          ×
        </button>
        <div style={S.title}>How to Play</div>
        <div style={S.subtitle}>Realm War</div>

        <div style={S.section}>
          <div style={S.sectionTitle}>Your Goal</div>
          <div style={S.desc}>
            Expand your territory across the world map. Build an economy, train armies,
            march them to unclaimed hexes or enemy territory, and crush anyone who stands in your way.
          </div>
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>Getting Started</div>
          <Row icon="1️⃣" label="Claim your first hex"
            desc="Click any unclaimed hex on the map and claim it. This becomes your capital. You start with troops already stationed there." />
          <Row icon="2️⃣" label="Build on your hex"
            desc="Open the Buildings tab. Each hex holds one building — choose Mine for income, Barracks to train more troops, or Fort for defense." />
          <Row icon="3️⃣" label="March your troops"
            desc="Go to the Military tab. Select how many troops to send, click March, then click the target hex on the map." />
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>Gold</div>
          <Row icon="💰" label="Your only resource"
            desc="Earned automatically every 10 minutes. You get 1 gold per hex you own. Each Mine adds +3 gold per tick." />
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>Buildings — one per hex</div>
          <Row icon="⛏" label="Mine — +3 gold/tick"
            desc="The backbone of your economy. Build these on as many hexes as you can." />
          <Row icon="🏰" label="Barracks — enables training"
            desc="Required to train new troops on that hex. Without one, you can't recruit soldiers there." />
          <Row icon="🛡" label="Fort — +40% defender strength"
            desc="Makes your troops significantly harder to defeat when defending that hex." />
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>Marching &amp; Combat</div>
          <Row icon="⚔" label="Claiming land"
            desc="March troops to an unclaimed adjacent hex — once they arrive, you can claim it." />
          <Row icon="💥" label="Attacking enemies"
            desc="March to a hex owned by another player. A battle begins automatically on arrival. Higher troop strength wins." />
          <Row icon="🌊" label="Ocean crossings"
            desc="You can cross ocean hexes, but it takes 10× longer. Plan naval moves carefully." />
          <Row icon="↩" label="Recall"
            desc="Open the Armies panel (⚔ top-left) to see your marching armies and recall them before they arrive." />
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>Tips</div>
          <div style={S.tip}>Build a Mine on your capital first — gold is everything early on.</div>
          <div style={S.tip}>Always keep some troops at home. An empty hex is easy to capture.</div>
          <div style={S.tip}>Forts are cheap and make your hexes much harder to take.</div>
          <div style={S.tip}>Claim territory in clusters — isolated hexes are hard to defend.</div>
        </div>

        <button style={S.btn} onClick={onClose}>Begin</button>
      </div>
    </div>
  )
}
