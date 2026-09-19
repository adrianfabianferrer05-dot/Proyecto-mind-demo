const CACHE='segunda-mente-v26';
const STATE_CACHE='segunda-mente-state-v1';
const PUSH_MARKER='./__push_registered__';
const BANK_URL='https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/bank';
const BANK_BALANCE_URL='https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/bank-balance';
const ASSETS=['./','./index.html','./app.css?v=8','./app-polish.css?v=7','./app.js?v=15','./app-enhance.js?v=7','./memory-ui.js?v=2','./gym.css?v=1','./gym-enhance.css?v=2','./gym-body.css?v=2','./memory-ui.css?v=2','./gym.js?v=2','./gym-weights.js?v=2','./week.js?v=2','./week.css?v=2','./today.js?v=2','./today.css?v=1','./voice-capture.js?v=1','./voice-capture.css?v=1','./edit-api.js?v=2','./edit-ui.js?v=2','./edit-ui.css?v=2','./prefs-ui.js?v=1','./gym-weights-core.js?v=1','./gym-nav.js?v=1','./gym-anatomy.js?v=2','./gym-body.js?v=2','./activar-notificaciones.html','./manifest.webmanifest','./icon.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key!==CACHE&&key!==STATE_CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='PUSH_REGISTERED')event.waitUntil(caches.open(STATE_CACHE).then(cache=>cache.put(PUSH_MARKER,new Response('1',{headers:{'Content-Type':'text/plain'}}))));
  if(event.data?.type==='PUSH_RESET')event.waitUntil(caches.open(STATE_CACHE).then(cache=>cache.delete(PUSH_MARKER)));
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

self.addEventListener('push',event=>{
  let payload={title:'Segunda Mente',body:'Tienes algo pendiente.',url:'/'};
  if(event.data){try{payload={...payload,...event.data.json()}}catch{payload.body=event.data.text()||payload.body}}
  const target=new URL(payload.url||'/',self.location.origin);
  if(target.origin!==self.location.origin)target.href=self.location.origin+'/';
  event.waitUntil(self.registration.showNotification(String(payload.title||'Segunda Mente').slice(0,90),{
    body:String(payload.body||'').slice(0,240),icon:'./icon.svg',badge:'./icon.svg',data:{url:target.href},tag:payload.tag?String(payload.tag).slice(0,80):undefined,
  }));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=event.notification.data?.url||self.location.origin+'/';
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){if('focus'in client){try{await client.navigate(target)}catch{}return client.focus()}}
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method==='POST'&&request.url===BANK_URL){
    event.respondWith((async()=>{
      try{
        const raw=await request.clone().text();let body={};try{body=raw?JSON.parse(raw):{}}catch{}
        if(body?.action==='balance'){
          const authorization=request.headers.get('authorization')||'';
          return fetch(BANK_BALANCE_URL,{method:'POST',cache:'no-store',headers:{Authorization:authorization,'Content-Type':'application/json'},body:'{}'});
        }
      }catch{}
      return fetch(request);
    })());
    return;
  }
  if(request.method!=='GET')return;
  const url=new URL(request.url);if(url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    try{
      const response=await fetch(request,{cache:'no-cache'});
      if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)))}
      return response;
    }catch{
      const hit=await caches.match(request);if(hit)return hit;
      if(request.mode==='navigate'){
        if(url.pathname.includes('activar-notificaciones'))return (await caches.match('./activar-notificaciones.html'))||Response.error();
        return (await caches.match('./index.html'))||(await caches.match('./'))||Response.error();
      }
      return Response.error();
    }
  })());
});
