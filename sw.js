const CACHE='segunda-mente-v4';
const STATE_CACHE='segunda-mente-state-v1';
const PUSH_MARKER='./__push_registered__';
const ASSETS=['./','./index.html','./app.css','./app.js','./activar-notificaciones.html','./manifest.webmanifest','./icon.svg'];

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
  if(event.data?.type==='PUSH_REGISTERED'){
    event.waitUntil(caches.open(STATE_CACHE).then(cache=>cache.put(PUSH_MARKER,new Response('1',{headers:{'Content-Type':'text/plain'}}))));
  }
  if(event.data?.type==='PUSH_RESET'){
    event.waitUntil(caches.open(STATE_CACHE).then(cache=>cache.delete(PUSH_MARKER)));
  }
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

self.addEventListener('push',event=>{
  let payload={title:'Segunda Mente',body:'Tienes algo pendiente.',url:'/'};
  if(event.data){
    try{payload={...payload,...event.data.json()}}
    catch{payload.body=event.data.text()||payload.body}
  }
  const target=new URL(payload.url||'/',self.location.origin);
  if(target.origin!==self.location.origin)target.href=self.location.origin+'/';
  const options={
    body:String(payload.body||'').slice(0,240),
    icon:'./icon.svg',
    badge:'./icon.svg',
    data:{url:target.href},
    tag:payload.tag?String(payload.tag).slice(0,80):undefined,
  };
  event.waitUntil(self.registration.showNotification(String(payload.title||'Segunda Mente').slice(0,90),options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=event.notification.data?.url||self.location.origin+'/';
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if('focus'in client){
        try{await client.navigate(target)}catch{}
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const response=await fetch(request);
        if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy))}
        return response;
      }catch{
        const direct=await caches.match(request);
        if(direct)return direct;
        if(url.pathname.includes('activar-notificaciones'))return (await caches.match('./activar-notificaciones.html'))||Response.error();
        return (await caches.match('./index.html'))||(await caches.match('./'))||Response.error();
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(request);
    const refresh=fetch(request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy))}
      return response;
    }).catch(()=>null);
    return cached||(await refresh)||Response.error();
  })());
});
