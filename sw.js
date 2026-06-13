// カロリーレンズ Service Worker
// ネットワーク優先（常に最新を取得し、オフライン時のみキャッシュにフォールバック）。
// これにより、ホーム画面から開いても古い壊れた版が出てエラーになる問題を防ぐ。
const CACHE = 'calorie-lens-v1';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function(){}); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // APIは常にネットワーク（キャッシュしない）
  if (url.pathname.indexOf('/api/') === 0) return;
  // ナビゲーションと静的: ネットワーク優先、失敗時キャッシュ
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && url.origin === self.location.origin) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy).catch(function(){}); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('/index.html');
      });
    })
  );
});
