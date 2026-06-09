// Realm War service worker - web push notifications

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data.json() } catch { /* ignore malformed payloads */ }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Realm War', {
      body: data.body || '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: data.data || {},
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus()
      return clients.openWindow('/')
    })
  )
})
