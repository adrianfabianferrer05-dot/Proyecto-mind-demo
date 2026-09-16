const CACHE='segunda-mente-v2';
const STATE_CACHE='segunda-mente-state-v1';
const PUSH_MARKER='./__push_registered__';
const ASSETS=['./','./index.html','./activar-notificaciones.html','./manifest.webmanifest','./icon.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

async function pushReady(){
  try{
    const subscription=await self.registration.pushManager.getSubscription();
    if(!subscription)return false;
    const state=await caches.open(STATE_CACHE);
    return !!(await state.match(PUSH_MARKER));
  }catch{return false}
}

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key!==CACHE&&key!==STATE_CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
    if(!(await pushReady())){
      const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      for(const client of windows){
        try{await client.navigate('./activar-notificaciones.html')}catch{}
      }
    }
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='PUSH_REGISTERED'){
    event.waitUntil(caches.open(STATE_CACHE).then(cache=>cache.put(PUSH_MARKER,new Response('1',{headers:{'Content-Type':'text/plain'}}))));
  }
  if(event.data?.type==='PUSH_RESET'){
    event.waitUntil(caches.open(STATE_CACHE).then(cache=>cache.delete(PUSH_MARKER)));
  }
});

self.addEventListener('push',event=>{
  let payload={title:'Segunda Mente',body:'Tienes algo pendiente.',url:'/'};
  if(event.data){
    try{payload={...payload,...event.data.json()}}catch{payload.body=event.data.text()||payload.body}
  }
  const targetUrl=new URL(payload.url||'/',self.location.origin);
  if(targetUrl.origin!==self.location.origin)targetUrl.href=self.location.origin+'/';
  const options={
    body:String(payload.body||'').slice(0,240),
    icon:'./icon.svg',
    data:{url:targetUrl.href},
  };
  if(payload.tag)options.tag=String(payload.tag).slice(0,80);
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
      const isRoot=url.pathname==='/'||url.pathname.endsWith('/index.html');
      if(isRoot&&!(await pushReady())){
        return (await caches.match('./activar-notificaciones.html'))||fetch('./activar-notificaciones.html');
      }
      try{
        const response=await fetch(request);
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(request,copy));
        return response;
      }catch{
        return (await caches.match(request))||(await caches.match('./index.html'));
      }
    })());
    return;
  }

  event.respondWith(caches.match(request).then(hit=>hit||fetch(request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(request,copy));
    return response;
  })));
});