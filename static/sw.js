// Service Worker for Push Notifications

self.addEventListener('install', function(event) {
    console.log('Service Worker installing');
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    console.log('Service Worker activating');
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
    console.log('Push message received');
    
    let data = {};
    if (event.data) {
        data = event.data.json();
    }
    
    const title = data.title || 'Camera Alert';
    const options = {
        body: data.body || 'Motion detected on your camera',
        icon: '/static/icon-192x192.png',
        badge: '/static/icon-72x72.png',
        tag: 'camera-notification',
        renotify: true,
        requireInteraction: true,
        actions: [
            {
                action: 'view',
                title: 'View Camera'
            },
            {
                action: 'dismiss',
                title: 'Dismiss'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', function(event) {
    console.log('Notification clicked:', event);
    event.notification.close();
    
    if (event.action === 'view') {
        const urlToOpen = new URL('/', self.location.origin).href;
        event.waitUntil(
            clients.openWindow(urlToOpen)
        );
    }
});
