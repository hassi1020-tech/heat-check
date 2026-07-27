const CACHE="heat-check-v12-stage3-eye";
const FILES=[
  "./",
  "./index.html",
  "./styles.css?v=1200s3",
  "./app.js?v=1200s3",
  "./firebase-cloud.js?v=1200s3",
  "./device-mode.js?v=1200s3",
  "./face-landmarker.js?v=1200s3",
  "./manifest.webmanifest?v=1200s3"
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
