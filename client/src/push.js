import { api } from './api/client'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// 'on' | 'off' | 'blocked' | 'unsupported'
export async function getPushStatus() {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Notifications not supported in this browser')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications blocked')
  const reg = await navigator.serviceWorker.register('/sw.js')
  const { key } = await api.getPushKey()
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  })
  await api.pushSubscribe(sub.toJSON())
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    try { await api.pushUnsubscribe(sub.endpoint) } catch { /* server cleanup is best-effort */ }
    await sub.unsubscribe()
  }
}
