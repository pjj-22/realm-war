const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/api'

async function request(method, path, body, { allowNull } = {}) {
  const token = localStorage.getItem('rw_token')
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json()
  if (!res.ok) {
    if (allowNull) return null
    throw new Error(data.error || 'Request failed')
  }
  return data
}

export const api = {
  register: (username, password, color) => request('POST', '/players/register', { username, password, color }),
  login: (username, password) => request('POST', '/players/login', { username, password }),
  me: () => request('GET', '/players/me'),
  getLeaderboard: () => request('GET', '/players/leaderboard'),
  getStats: () => request('GET', '/players/stats'),
  claimHex: (h3Index) => request('POST', '/hexes/claim', { h3Index }),
  getHexes: () => request('GET', '/hexes'),
  getBuildings: (h3Index) => request('GET', `/buildings/${h3Index}`),
  build: (h3Index, type) => request('POST', '/buildings', { h3Index, type }),
  demolish: (buildingId) => request('DELETE', `/buildings/${buildingId}`),
  upgradeHex: (h3Index) => request('POST', `/buildings/${h3Index}/upgrade`),
  getMilitary: (h3Index) => request('GET', `/military/hex/${h3Index}`),
  trainTroops: (h3Index, type, quantity) => request('POST', '/military/train', { h3Index, type, quantity }),
  marchArmy: (fromHex, toHex, type, quantity) => request('POST', '/military/march', { fromHex, toHex, type, quantity }),
  getArmies: () => request('GET', '/military/armies'),
  recallArmy: (id) => request('DELETE', `/military/armies/${id}`),
  checkTerrain: (h3Indexes) => request('POST', '/hexes/terrain', { h3Indexes }),
  getBattle: (h3Index) => request('GET', `/battles/hex/${h3Index}`),
  getActiveBattles: () => request('GET', '/battles/active'),
  getEvents: () => request('GET', '/events'),
  getEventCount: () => request('GET', '/events/count'),
  devRefill: () => request('POST', '/dev/refill'),
  getConfig: () => request('GET', '/health'),
  setRally: (fromHex, rallyHex) => request('POST', '/military/rally', { fromHex, rallyHex }),
  clearRally: (h3Index) => request('DELETE', `/military/rally/${h3Index}`),
}
