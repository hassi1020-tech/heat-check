const CACHE="heat-check-v11-1103-cloud-stage1";
const FILES=[
  "./",
  "./index.html",
  "./styles.css?v=1103c1",
  "./app.js?v=1103c1",
  "./firebase-cloud.js?v=1103c1",
  "./manifest.webmanifest?v=1103c1"
];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  if(e.request.url.includes("gstatic.com/firebasejs")||e.request.url.includes("googleapis.com")){
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{
    const copy=r.clone();
    caches.open(CACHE).then(c=>c.put(e.request,copy));
    return r;
  }).catch(()=>caches.match(e.request)));
});
