/* One-time OpenAI API key setup for Segunda Mente. The key is sent directly to the authenticated Supabase Edge Function and is never stored in the browser. */
(function(){
  const CONFIG_URL='https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/mind-config';
  const TOKEN_KEY='sm_device_token';
  const qs=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const getToken=()=>localStorage.getItem(TOKEN_KEY)||'';

  async function call(method='GET',body){
    const t=getToken();if(!t)throw new Error('Sin sesión privada');
    const r=await fetch(CONFIG_URL,{method,cache:'no-store',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const out=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(out.detail||out.error||'No se pudo conectar');
    return out;
  }

  function installStyles(){
    if(qs('#openaiConnectStyles'))return;
    const s=document.createElement('style');s.id='openaiConnectStyles';s.textContent=`
      .ai-connect-card{margin:8px 0 14px;padding:14px;border:1px solid rgba(255,255,255,.07);border-radius:18px;background:rgba(255,255,255,.025)}
      .ai-connect-card[hidden]{display:none}.ai-connect-copy{font-size:10px;line-height:1.45;color:var(--muted);margin-bottom:10px}.ai-connect-copy b{display:block;color:var(--text);font-size:11px;margin-bottom:3px}
      .ai-connect-row{display:grid;grid-template-columns:1fr auto;gap:8px}.ai-connect-input{min-width:0;background:#0d0f11;color:var(--text);border:1px solid rgba(255,255,255,.1);border-radius:13px;padding:11px 12px;font:inherit;font-size:12px;outline:none}.ai-connect-input:focus{border-color:rgba(202,255,88,.42);box-shadow:0 0 0 3px rgba(202,255,88,.07)}
      .ai-connect-btn{border:0;border-radius:13px;padding:0 14px;background:var(--signal);color:#0a0c0e;font:inherit;font-size:10px;font-weight:800;min-height:42px}.ai-connect-btn:disabled{opacity:.45}.ai-connect-status{font-size:9px;color:var(--muted);margin-top:8px;min-height:13px}.ai-connect-status.ok{color:var(--signal)}
      .ai-setting-action{border:0;background:transparent;color:var(--signal);font:inherit;font-size:10px;font-weight:750;padding:8px 0 8px 12px}
    `;document.head.appendChild(s);
  }

  function mount(){
    const aiState=document.getElementById('aiState');if(!aiState)return;
    const setting=aiState.closest('.setting');if(!setting||qs('#openaiConnectCard'))return;
    installStyles();
    const btn=document.createElement('button');btn.className='ai-setting-action';btn.type='button';btn.id='openaiConnectToggle';btn.textContent='Conectar';setting.appendChild(btn);
    const card=document.createElement('div');card.className='ai-connect-card';card.id='openaiConnectCard';card.hidden=true;card.innerHTML=`
      <div class="ai-connect-copy"><b>Conectar OpenAI</b>Pega aquí una API key. Se valida y se guarda cifrada en el servidor; este iPhone no la conserva.</div>
      <div class="ai-connect-row"><input class="ai-connect-input" id="openaiKeyInput" type="password" inputmode="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="sk-…"><button class="ai-connect-btn" id="openaiKeySave" type="button">Guardar</button></div>
      <div class="ai-connect-status" id="openaiKeyStatus"></div>`;
    setting.insertAdjacentElement('afterend',card);

    const input=qs('#openaiKeyInput'),save=qs('#openaiKeySave'),status=qs('#openaiKeyStatus');
    btn.onclick=()=>{card.hidden=!card.hidden;if(!card.hidden)setTimeout(()=>input.focus(),80)};
    save.onclick=async()=>{
      const key=input.value.trim();if(key.length<20){status.textContent='Pega la clave completa.';return}
      save.disabled=true;status.className='ai-connect-status';status.textContent='Validando con OpenAI…';
      try{
        await call('POST',{action:'set_openai_key',key});
        input.value='';status.className='ai-connect-status ok';status.textContent='Conectada. Segunda Mente ya interpreta con OpenAI.';aiState.textContent='Avanzada';aiState.classList.add('ok');btn.textContent='Conectada';setTimeout(()=>{card.hidden=true},1300);
      }catch(e){status.textContent=esc(e.message||'No pude validar esa clave.').replace(/&quot;/g,'"')}
      finally{save.disabled=false}
    };

    call().then(out=>{if(out.aiEnabled){aiState.textContent='Avanzada';aiState.classList.add('ok');btn.textContent='Conectada'}}).catch(()=>{});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
