// HexNation service worker - web push notifications

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data.json() } catch { /* ignore malformed payloads */ }
  event.waitUntil(
    self.registration.showNotification(data.title || 'HexNation', {
      body: data.body || '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: data.data || {},
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const hex = event.notification.data?.hex
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) {
        if (hex) list[0].postMessage({ type: 'goto-hex', hex })
        return list[0].focus()
      }
      return clients.openWindow(hex ? `/?hex=${encodeURIComponent(hex)}` : '/')
    })
  )
})
