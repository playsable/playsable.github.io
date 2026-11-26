// Retire the old download cache without taking control of game pages.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        await caches.delete('sable-play-game-packs-v1');
        await self.registration.unregister();
    })());
});
