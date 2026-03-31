import { useState, useEffect } from 'react'
import { api } from '../api/client'

const TROOPS = [
  { type: 'knight',    label: 'Knights',    cost: '1g',  time: '6s',  icon: '⚔',  bonus: 'versatile raider' },
  { type: 'archer',    label: 'Archers',    cost: '1g',  time: '6s',  icon: '🏹',  bonus: '+25% when defending' },
  { type: 'trebuchet', label: 'Trebuchets', cost: '5g',  time: '12s', icon: '💣',  bonus: '+50% when attacking' },
]

function TrainingBar({ job }) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    function update() {
      const total = new Date(job.completes_at) - new Date(job.started_at)
      const elapsed = Date.now() - new Date(job.started_at)
      setProgress(Math.min(100, (elapsed / total) * 100))
    }
    update()
    const interval = setInterval(update, 500)
    return () => clearInterval(interval)
  }, [job])

  const remaining = Math.max(0, Math.ceil((new Date(job.completes_at) - Date.now()) / 1000))
  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#7a6a9a', marginBottom: 4 }}>
        <span>Training {job.quantity} {job.type}s</span>
        <span>{mins}:{String(secs).padStart(2, '0')}</span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }}>
        <div style={{
          height: '100%', borderRadius: 2,
          background: 'linear-gradient(90deg, #4a3a9a, #8060d0)',
          width: `${progress}%`, transition: 'width 0.5s linear',
        }} />
      </div>
    </div>
  )
}

function GroupComposition({ group }) {
  const icons = { knight: '⚔', archer: '🏹', trebuchet: '💣' }
  const parts = ['knight', 'archer', 'trebuchet']
    .filter(t => group[t] > 0)
    .map(t => `${icons[t]}${group[t]}`)
  return <span style={{ color: '#a090c0', fontSize: 12 }}>{parts.join('  ') || '—'}</span>
}

function GroupEditor({ group, troopMap, onSave, onCancel }) {
  const [name, setName] = useState(group?.name || '')
  const [knight, setKnight] = useState(group?.knight || 0)
  const [archer, setArcher] = useState(group?.archer || 0)
  const [trebuchet, setTrebuchet] = useState(group?.trebuchet || 0)

  const inputStyle = {
    width: 60, padding: '4px 8px',
    background: 'rgba(255,255,255,0.05)', border: '1px solid #4a3a7a',
    borderRadius: 4, color: '#c9b99a', fontFamily: 'Georgia, serif', fontSize: 13,
  }

  return (
    <div style={{ background: 'rgba(40,20,80,0.3)', border: '1px solid #3a2a6a', borderRadius: 6, padding: '12px', marginBottom: 10 }}>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Group name…"
        style={{ ...inputStyle, width: '100%', marginBottom: 10, boxSizing: 'border-box' }}
        autoFocus
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {[
          { type: 'knight', icon: '⚔', label: 'Knights', val: knight, set: setKnight },
          { type: 'archer', icon: '🏹', label: 'Archers', val: archer, set: setArcher },
          { type: 'trebuchet', icon: '💣', label: 'Trebuchets', val: trebuchet, set: setTrebuchet },
        ].map(({ type, icon, label, val, set }) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>{icon} {label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#5a4a7a' }}>have {troopMap[type] || 0}</span>
              <input
                type="number" min="0" max={troopMap[type] || 999} value={val}
                onChange={e => set(Math.max(0, parseInt(e.target.value) || 0))}
                style={inputStyle}
              />
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onSave({ ...(group?.id ? { id: group.id } : {}), name, knight, archer, trebuchet })}
          style={{
            flex: 1, padding: '7px 0', background: 'rgba(80,40,160,0.35)', border: '1px solid #6a4aaa',
            borderRadius: 4, color: '#c9b99a', cursor: 'pointer', fontSize: 12, fontFamily: 'Georgia, serif',
          }}>
          Save
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '7px 14px', background: 'rgba(40,20,60,0.3)', border: '1px solid #3a2a5a',
            borderRadius: 4, color: '#7a6a9a', cursor: 'pointer', fontSize: 12, fontFamily: 'Georgia, serif',
          }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function MilitaryPanel({ hex, player, onPlayerUpdate, onMarchStart, onMarchGroupStart, onClose }) {
  const [military, setMilitary] = useState(null)
  const [groups, setGroups] = useState([])
  const [quantity, setQuantity] = useState(1)
  const [loading, setLoading] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null) // group object or 'new'
  const [showGroups, setShowGroups] = useState(true)

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [hex.h3])

  useEffect(() => {
    loadGroups()
  }, [])

  async function load() {
    try {
      const data = await api.getMilitary(hex.h3)
      setMilitary(data)
    } catch {}
  }

  async function loadGroups() {
    try { setGroups(await api.getGroups()) } catch {}
  }

  async function handleRecall(id) {
    setLoading(true)
    try { await api.recallArmy(id); await load() } catch (err) { alert(err.message) } finally { setLoading(false) }
  }

  async function handleTrain(type) {
    setLoading(true)
    try {
      const result = await api.trainTroops(hex.h3, type, quantity)
      onPlayerUpdate?.(result.player)
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveGroup(groupData) {
    setLoading(true)
    try {
      await api.saveGroup(groupData)
      await loadGroups()
      setEditingGroup(null)
    } catch (err) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteGroup(id) {
    setLoading(true)
    try { await api.deleteGroup(id); await loadGroups() } catch (err) { alert(err.message) } finally { setLoading(false) }
  }

  const troopMap = {}
  military?.troops?.forEach(t => { troopMap[t.type] = t.quantity })

  return (
    <div style={{
      position: 'absolute', bottom: 30, left: 30,
      background: 'rgba(10,8,25,0.92)', border: '1px solid #4a3a7a',
      borderRadius: 8, padding: '20px 24px', minWidth: 300, maxWidth: 360,
      color: '#c9b99a', fontFamily: 'Georgia, serif',
      boxShadow: '0 0 30px rgba(80,40,160,0.4)',
      maxHeight: '85vh', overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 15, letterSpacing: 3, color: '#7a6a9a', textTransform: 'uppercase' }}>Military</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#7a6a9a', cursor: 'pointer', fontSize: 22 }}>×</button>
      </div>

      {/* Quantity selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 14, color: '#7a6a9a' }}>QTY</span>
        <input
          type="number" min="1" max="100" value={quantity}
          onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
          style={{
            width: 80, padding: '6px 10px', background: 'rgba(255,255,255,0.05)',
            border: '1px solid #4a3a7a', borderRadius: 4, color: '#c9b99a',
            fontFamily: 'Georgia, serif', fontSize: 15,
          }}
        />
      </div>

      {/* Training queue */}
      {military?.training?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#7a6a9a', letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>Training</div>
          {military.training.map(job => <TrainingBar key={job.id} job={job} />)}
        </div>
      )}

      {/* Troops & actions */}
      <div style={{ fontSize: 13, color: '#7a6a9a', letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase' }}>Troops</div>
      {TROOPS.map(t => (
        <div key={t.type} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div>
              <span style={{ fontSize: 15 }}>{t.icon} {t.label}</span>
              <div style={{ fontSize: 11, color: '#5a4a6a', marginTop: 2 }}>{t.bonus}</div>
            </div>
            <span style={{ fontSize: 15, color: '#a090c0', fontWeight: 'bold' }}>{troopMap[t.type] || 0} ready</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleTrain(t.type)}
              disabled={loading}
              style={{
                flex: 1, padding: '8px 0', background: 'rgba(80,40,160,0.25)',
                border: '1px solid #4a3a7a', borderRadius: 4,
                color: '#c9b99a', cursor: 'pointer', fontSize: 13,
                letterSpacing: 1, fontFamily: 'Georgia, serif',
              }}>
              Train {t.cost} · {t.time}
            </button>
            {(troopMap[t.type] || 0) > 0 && (
              <button
                onClick={() => onMarchStart?.(hex.h3, t.type, Math.min(quantity, troopMap[t.type]))}
                disabled={loading}
                style={{
                  padding: '8px 14px', background: 'rgba(160,40,40,0.25)',
                  border: '1px solid #7a3a3a', borderRadius: 4,
                  color: '#c9a0a0', cursor: 'pointer', fontSize: 13,
                  fontFamily: 'Georgia, serif',
                }}>
                March
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Marching armies */}
      {military?.armies?.length > 0 && (
        <div style={{ marginTop: 4, marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#7a6a9a', letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>Marching</div>
          {military.armies.map(a => {
            const total = new Date(a.arrives_at) - new Date(a.departed_at)
            const elapsed = Date.now() - new Date(a.departed_at)
            const progress = Math.min(100, (elapsed / total) * 100)
            const remaining = Math.max(0, Math.ceil((new Date(a.arrives_at) - Date.now()) / 60000))
            return (
              <div key={a.id} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#7a6a9a', marginBottom: 4 }}>
                  <span>{a.quantity} {a.type}s → {a.to_hex}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{remaining}min</span>
                    <button
                      onClick={() => handleRecall(a.id)}
                      disabled={loading}
                      style={{
                        padding: '1px 7px', background: 'rgba(100,30,30,0.4)',
                        border: '1px solid #6a2a2a', borderRadius: 3,
                        color: '#c09090', cursor: 'pointer', fontSize: 10,
                        fontFamily: 'Georgia, serif',
                      }}>
                      Recall
                    </button>
                  </div>
                </div>
                <div style={{ height: 5, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
                    background: 'linear-gradient(90deg, #9a3a3a, #d06060)',
                    width: `${progress}%`, transition: 'width 0.5s linear',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Army Groups ── */}
      <div style={{ borderTop: '1px solid #2a1a4a', paddingTop: 14 }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: showGroups ? 12 : 0 }}
          onClick={() => setShowGroups(s => !s)}
        >
          <span style={{ fontSize: 12, letterSpacing: 2, color: '#7a6a9a', textTransform: 'uppercase' }}>
            Army Groups
          </span>
          <span style={{ color: '#5a4a7a', fontSize: 14 }}>{showGroups ? '▲' : '▼'}</span>
        </div>

        {showGroups && (
          <>
            {groups.length === 0 && editingGroup === null && (
              <div style={{ fontSize: 12, color: '#5a4a7a', marginBottom: 10 }}>
                No groups saved. Create one to march mixed armies with one click.
              </div>
            )}

            {groups.map(group => (
              editingGroup?.id === group.id ? (
                <GroupEditor
                  key={group.id}
                  group={group}
                  troopMap={troopMap}
                  onSave={handleSaveGroup}
                  onCancel={() => setEditingGroup(null)}
                />
              ) : (
                <div key={group.id} style={{
                  background: 'rgba(40,20,80,0.25)', border: '1px solid #3a2a6a',
                  borderRadius: 6, padding: '10px 12px', marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 'bold', color: '#c9b99a' }}>{group.name}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => setEditingGroup(group)}
                        style={{ background: 'none', border: 'none', color: '#7a6a9a', cursor: 'pointer', fontSize: 11, padding: '0 4px' }}>
                        ✎
                      </button>
                      <button
                        onClick={() => handleDeleteGroup(group.id)}
                        disabled={loading}
                        style={{ background: 'none', border: 'none', color: '#7a4a4a', cursor: 'pointer', fontSize: 13, padding: '0 4px' }}>
                        ×
                      </button>
                    </div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <GroupComposition group={group} />
                  </div>
                  <button
                    onClick={() => onMarchGroupStart?.(hex.h3, group)}
                    disabled={loading}
                    style={{
                      width: '100%', padding: '7px 0',
                      background: 'rgba(120,40,160,0.3)', border: '1px solid #7a3aaa',
                      borderRadius: 4, color: '#c0a0e0', cursor: 'pointer',
                      fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
                      fontFamily: 'Georgia, serif',
                    }}>
                    ⚔ March Group
                  </button>
                </div>
              )
            ))}

            {editingGroup === 'new' ? (
              <GroupEditor
                group={null}
                troopMap={troopMap}
                onSave={handleSaveGroup}
                onCancel={() => setEditingGroup(null)}
              />
            ) : (
              <button
                onClick={() => setEditingGroup('new')}
                style={{
                  width: '100%', padding: '7px 0', marginTop: 4,
                  background: 'rgba(40,20,80,0.2)', border: '1px dashed #4a3a7a',
                  borderRadius: 4, color: '#7a6a9a', cursor: 'pointer',
                  fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
                  fontFamily: 'Georgia, serif',
                }}>
                + New Group
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
