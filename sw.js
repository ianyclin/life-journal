/* 人生手帳 Service Worker
   只負責一件事:讓這本手帳在沒有網路、甚至飛航模式下也打得開。
   策略是「先給快取、背景更新」——開啟永遠是瞬間的,新版會在下一次開啟套用。
   資料本身不經過這裡:所有紀錄都在 localStorage / IndexedDB,與快取無關。 */
'use strict';

const VERSION = 'v2';
const CACHE = `life-journal-${VERSION}`;
const SHELL = ['./index.html', './'];
/* 導覽請求一律對應到這一把鑰匙。捷徑會帶 ?tab=… 進來,如果照著網址各存一份,
   舊版本就會躲在某個參數組合裡一直復活 —— 手帳永遠只有一份。 */
const SHELL_KEY = './index.html';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* 有些主機不接受目錄形式的請求,少一個也不該讓安裝整個失敗 */
    await Promise.all(SHELL.map(u => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;

  /* 只有「開啟手帳本身」才對應到 shell。同一個網域下若還放了別的檔案
     (例如 cover.svg),直接開它時就該拿到那個檔案,而不是手帳畫面。 */
  const isShellNav = req.mode === 'navigate'
    && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
  const key = isShellNav ? SHELL_KEY : req;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key) || (isShellNav ? await cache.match('./') : null);
    const fresh = fetch(req).then(async res => {
      if (!res || !res.ok || res.type !== 'basic') return res;
      /* 手帳本體換新版時主動告訴頁面，讓它自己跳出提示 ——
         不然使用者永遠要「重新整理兩次」才看得到，而沒有人會記得這件事。 */
      if (isShellNav) {
        const old = await cache.match(key);
        await cache.put(key, res.clone());
        if (old && changed(old, res)) notifyClients();
      } else {
        cache.put(key, res.clone()).catch(() => {});
      }
      return res;
    }).catch(() => null);

    /* 有快取就先回快取,順便在背景把新版存起來 */
    if (cached) { e.waitUntil(fresh); return cached; }

    const res = await fresh;
    if (res) return res;

    /* 離線又沒快取:至少讓導覽請求拿到手帳本體 */
    if (isShellNav) {
      const shell = await cache.match(SHELL_KEY) || await cache.match('./');
      if (shell) return shell;
    }
    return new Response('離線中,而且這個資源還沒有被快取。', {
      status: 503,
      headers: {'Content-Type': 'text/plain;charset=utf-8'}
    });
  })());
});

/* 比對是不是同一份檔案。優先看 ETag，其次 Last-Modified，最後看長度。 */
function changed(a, b){
  const tag = r => r.headers.get('etag') || r.headers.get('last-modified') || r.headers.get('content-length') || '';
  const x = tag(a), y = tag(b);
  return !!x && !!y && x !== y;
}
function notifyClients(){
  self.clients.matchAll({type:'window', includeUncontrolled:true})
    .then(list => list.forEach(c => c.postMessage({type:'shell-updated'})))
    .catch(() => {});
}

self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

/* ===== 每晚提醒 =====
   點通知就直接打開反思頁;已經有開著的視窗就切過去,不再開一個新的。 */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    for (const c of all){
      if ('focus' in c){
        await c.focus();
        if (c.navigate) await c.navigate(url).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

/* Android / 桌面 Chrome 才有的背景定期同步。手帳沒開著時也提醒得到;
   iOS 目前沒有這個能力,那邊只能靠開著的分頁,設定頁已經誠實說明。 */
self.addEventListener('periodicsync', e => {
  if (e.tag === 'nightly-nudge') e.waitUntil(nightlyNudge());
});

/* 直接讀 IndexedDB 裡的最新快照,判斷今天是不是已經寫過了 —— 寫過就不打擾 */
function latestSnapshot(){
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done){ done = true; resolve(v); } };
    try{
      /* 不指定版本:主程式會把這個 DB 升到 v2(多一個 handles store),
         這裡若寫死舊版號會直接撞 VersionError。 */
      const q = indexedDB.open('life_journal_rescue');
      q.onerror = () => finish(null);
      q.onupgradeneeded = () => { try{ q.transaction.abort(); }catch(err){} finish(null); };
      q.onsuccess = () => {
        try{
          const db = q.result;
          if (!db.objectStoreNames.contains('snapshots')) return finish(null);
          const cur = db.transaction('snapshots').objectStore('snapshots').openCursor(null, 'prev');
          cur.onsuccess = () => finish(cur.result ? cur.result.value.raw : null);
          cur.onerror = () => finish(null);
        }catch(err){ finish(null); }
      };
    }catch(err){ finish(null); }
    setTimeout(() => finish(null), 3000);
  });
}
async function nightlyNudge(){
  try{
    const raw = await latestSnapshot();
    if (raw){
      const s = JSON.parse(raw);
      const c = s.settings && s.settings.reminder;
      if (!c || !c.enabled) return;                       /* 使用者已經關掉提醒 */
      const now = new Date();
      const k = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const r = s.reflections && s.reflections[k];
      if (r && (r.mood || (r.text || '').trim())) return;  /* 今天已經寫過了 */
      const [hh, mm] = String(c.time || '21:30').split(':').map(Number);
      if (now.getHours() * 60 + now.getMinutes() < (hh || 0) * 60 + (mm || 0)) return;  /* 還沒到時間 */
    }
    await self.registration.showNotification('人生手帳', {
      body:'替今天寫下一句話,只要一分鐘。',
      tag:'life-journal-nightly',
      data:{url:'./?tab=reflect'}
    });
  }catch(err){}
}
