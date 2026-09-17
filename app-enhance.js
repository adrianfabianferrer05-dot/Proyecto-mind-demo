const MIND_CONFIG_URL='https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/mind-config';

async function configRequest(method='GET',body=null){
  const t=localStorage.getItem('sm_device_token')||'';
  if(!t)throw new Error('Este iPhone todavía no está vinculado.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(MIND_CONFIG_URL,{method,signal:controller.signal,headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const out=await r.json().catch(()=>({}));
    if(r.status===401)throw new Error('La sesión de este iPhone necesita renovarse.');
    if(!r.ok)throw new Error(out.detail||out.error||'No pude completar la configuración.');
    return out;
  }finally{clearTimeout(timer)}
}

function buildApiLayer(){
  if(document.getElementById('apiLayer'))return;
  const layer=document.createElement('div');
  layer.id='apiLayer';layer.className='api-layer';layer.setAttribute('aria-hidden','true');
  layer.innerHTML=`<div class="api-panel" role="dialog" aria-modal="true" aria-labelledby="apiTitle">
    <button class="api-close" id="apiClose" aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="grabber"></div>
    <p class="api-kicker">Interpretación privada</p>
    <h2 class="api-title" id="apiTitle">Que entienda como hablas.</h2>
    <p class="api-copy">Conecta tu propia clave de OpenAI. Segunda Mente la prueba una vez y la guarda cifrada en tu servidor; la clave no se vuelve a mostrar ni se guarda en el navegador.</p>
    <div class="api-field"><label for="apiKeyInput">Clave de OpenAI</label><input id="apiKeyInput" type="password" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-…"></div>
    <div class="api-status" id="apiStatus">Cuando esté conectada, gastos, tareas, ideas, planes y deudas se interpretarán con el mismo flujo.</div>
    <div class="api-actions"><a class="api-action" href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">Crear / ver clave</a><button class="api-action primary" id="apiSave">Conectar</button></div>
    <div class="api-privacy">La clave viaja por HTTPS directamente a tu backend. No se añade al repositorio, a Vercel ni a localStorage.</div>
  </div>`;
  document.body.appendChild(layer);
  const close=()=>{layer.classList.remove('show');layer.setAttribute('aria-hidden','true');document.body.classList.remove('sheet-open');setTimeout(()=>$('settingsBtn')?.focus({preventScroll:true}),170)};
  $('apiClose').onclick=close;
  layer.onclick=e=>{if(e.target===layer)close()};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&layer.classList.contains('show'))close()});
  $('apiSave').onclick=async()=>{
    const input=$('apiKeyInput'),status=$('apiStatus'),button=$('apiSave'),key=input.value.trim();
    if(!key){status.textContent='Pega primero tu clave.';status.className='api-status err';input.focus();return}
    button.disabled=true;status.textContent='Comprobando la clave con OpenAI…';status.className='api-status';
    try{
      const out=await configRequest('POST',{action:'set_openai_key',key});
      input.value='';state.aiEnabled=!!out.aiEnabled;updateSettings();status.textContent='Conectada. La interpretación avanzada ya está activa.';status.className='api-status ok';toast('Interpretación avanzada activa');
      await load({quiet:true});
      setTimeout(close,720);
    }catch(e){status.textContent=e?.name==='AbortError'?'La comprobación tardó demasiado. Inténtalo otra vez.':(e?.message||'No pude conectar la clave.');status.className='api-status err'}finally{button.disabled=false}
  };
  window.__openMindApi=async()=>{
    if($('settingsSheet')?.classList.contains('show'))closeSheet();
    layer.classList.add('show');layer.setAttribute('aria-hidden','false');document.body.classList.add('sheet-open');
    const status=$('apiStatus');status.textContent=state.aiEnabled?'Ya está conectada. Si quieres, puedes sustituir la clave por otra.':'Cuando esté conectada, gastos, tareas, ideas, planes y deudas se interpretarán con el mismo flujo.';status.className='api-status';
    setTimeout(()=>$('apiKeyInput')?.focus({preventScroll:true}),390);
  };
}

function attachSettingsActions(){
  const aiState=$('aiState');
  if(aiState&&!document.getElementById('aiConnect')){
    const right=document.createElement('div');right.className='setting-right';
    aiState.parentNode.insertBefore(right,aiState);right.appendChild(aiState);
    const button=document.createElement('button');button.id='aiConnect';button.className='setting-mini signal';button.type='button';button.textContent=state.aiEnabled?'Cambiar':'Conectar';button.onclick=()=>window.__openMindApi?.();right.appendChild(button);
    const observer=new MutationObserver(()=>{button.textContent=aiState.textContent==='Avanzada'?'Cambiar':'Conectar'});observer.observe(aiState,{childList:true,subtree:true,characterData:true});
  }

  const notificationState=$('notificationState');
  if(notificationState&&!document.getElementById('notificationTest')){
    const right=document.createElement('div');right.className='setting-right';
    notificationState.parentNode.insertBefore(right,notificationState);right.appendChild(notificationState);
    const button=document.createElement('button');button.id='notificationTest';button.className='setting-mini';button.type='button';button.textContent='Probar';right.appendChild(button);
    button.onclick=async()=>{
      try{
        if(!('Notification'in window)||!('serviceWorker'in navigator))throw new Error('Este iPhone no ofrece notificaciones web aquí.');
        let permission=Notification.permission;
        if(permission==='default')permission=await Notification.requestPermission();
        if(permission!=='granted')throw new Error('Las notificaciones están bloqueadas en Ajustes del iPhone.');
        const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager?.getSubscription();
        if(!sub)throw new Error('Los avisos necesitan volver a vincularse desde la pantalla de activación.');
        await reg.showNotification('Segunda Mente',{body:'Los avisos de este iPhone están activos.',icon:'./icon.svg',badge:'./icon.svg',tag:'segunda-mente-self-check',data:{url:location.origin+'/'}});
        toast('Aviso de prueba enviado');updateSettings();
      }catch(e){toast(e?.message||'No pude probar los avisos')}
    };
  }
}

function installMotionPolish(){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  document.addEventListener('click',e=>{
    const trigger=e.target.closest?.('[data-view],[data-go]');if(!trigger)return;
    const id=trigger.dataset.view||trigger.dataset.go;if(!id||id===currentView)return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const view=document.getElementById(id);if(!view||!view.classList.contains('active'))return;
      view.animate([{opacity:.74,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(.23,1,.32,1)'});
    }));
  });
  const breatheTarget=$('moneyNet');
  if(breatheTarget){let previous=breatheTarget.textContent;new MutationObserver(()=>{const next=breatheTarget.textContent;if(next===previous)return;previous=next;breatheTarget.animate([{opacity:.55,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(.23,1,.32,1)'})}).observe(breatheTarget,{childList:true,subtree:true,characterData:true})}
}

buildApiLayer();
attachSettingsActions();
installMotionPolish();
