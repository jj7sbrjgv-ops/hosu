// Service Worker - バックグラウンドでのセンサーリッスン

const CACHE_NAME = 'step-counter-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js'
];

// インストール
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache).catch(() => {
                // キャッシュに失敗しても続行
                return Promise.resolve();
            }))
            .catch(() => Promise.resolve())
    );
    self.skipWaiting();
});

// アクティベーション
self.addEventListener('activate', event => {
    event.waitUntil(clients.claim());
});

// Fetch イベント（オフラインサポート）
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                return response || fetch(event.request).catch(() => {
                    // オフラインの場合、キャッシュから返す
                    return caches.match('/index.html');
                });
            })
    );
});

// バックグラウンド同期
self.addEventListener('sync', event => {
    if (event.tag === 'sync-steps') {
        event.waitUntil(syncSteps());
    }
});

async function syncSteps() {
    // バックグラウンドでのステップ同期ロジック
    // （メインスレッドとの通信用）
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
        client.postMessage({
            type: 'SYNC_STEPS'
        });
    });
}

// メッセージハンドラー（メインスレッドからの通信）
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
