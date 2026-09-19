const MEMORY_URL='https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/mind';
let memoryCorrectionId=null;

async function memoryApi(body){
  const t=localStorage.getItem('sm_device_token')||'';
  if(!t)throw new Error('Este iPhone no está vinculado');
  const r=await fetch(MEMORY_URL,{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const out=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(out.detail||out.error||'No pude hacerlo');
  return out;
}

function memoryDate(v){
  const d=new Date(v);if(!Number.isFinite(d.getTime()))return'';
  return new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',year:'numeric'}).format(d);
}

/* La busqueda por significado devuelve tambien lo archivado: archivar es quitarlo
   de en medio, no olvidarlo. Pero entonces hay que decirlo, o parece que algo que
   apartaste sigue activo. */
let memoryHits=new Map();

function renderMemoryResults(items){
  const box=document.getElementById('memoryResults');if(!box)return;
  memoryHits=new Map((items||[]).map(m=>[String(m.id),m]));
  if(!items?.length){box.innerHTML='<div class="memory-empty">No encontré recuerdos suficientemente relacionados.</div>';return}
  box.innerHTML=items.map(m=>`<button class="memory-hit press" data-memory-id="${String(m.id).replace(/"/g,'&quot;')}"><span class="memory-hit-top"><b>${esc(m.title||m.raw_text||'Recuerdo')}</b><em>${Math.round((Number(m.similarity)||0)*100)}%</em></span><span class="memory-hit-meta">${esc(typeLabel(m.kind))} · ${esc(memoryDate(m.created_at))}${m.category?' · '+esc(m.category):''}${m.archived_at?' · <i class="memory-hit-archived">archivado</i>':''}</span><span class="memory-hit-raw">${esc(m.raw_text||'')}</span></button>`).join('');
}

/* Un resultado de busqueda era un boton que no hacia nada. Ahora abre el mismo
   editor que en Semana: cambiar el titulo, la fecha, el tipo, o borrarlo. */
function openMemory(id){
  const m=memoryHits.get(String(id))||state.captures.find(c=>c.id===id);
  if(!m)return;
  if(typeof openCaptureEditor==='function')openCaptureEditor(m);
  else toast('Abre Semana para editarlo');
}

async function runMemorySearch(){
  const input=document.getElementById('memoryQuery'),btn=document.getElementById('memorySearchBtn'),box=document.getElementById('memoryResults');
  const query=input?.value.trim();if(!query)return toast('Escribe qué quieres recordar');
  btn.disabled=true;box.innerHTML='<div class="memory-loading">Buscando por significado…</div>';
  try{const out=await memoryApi({action:'recall',query,limit:6});renderMemoryResults(out.memories||[])}
  catch(e){box.innerHTML='<div class="memory-empty">No pude buscar ahora.</div>';toast(e.message)}
  finally{btn.disabled=false}
}

function openCorrection(id){
  memoryCorrectionId=id;
  const c=state.captures.find(x=>x.id===id),sheet=document.getElementById('correctionSheet'),text=document.getElementById('correctionText');
  document.getElementById('correctionTarget').textContent=c?.title||c?.raw_text||'Este registro';
  text.value='';
  sheet.classList.add('show');sheet.setAttribute('aria-hidden','false');document.body.classList.add('sheet-open');
  setTimeout(()=>text.focus({preventScroll:true}),260);
}

function closeCorrection(){
  const sheet=document.getElementById('correctionSheet');
  sheet.classList.remove('show');sheet.setAttribute('aria-hidden','true');document.body.classList.remove('sheet-open');memoryCorrectionId=null;
}

async function submitCorrection(){
  const text=document.getElementById('correctionText'),btn=document.getElementById('correctionSave'),instruction=text.value.trim();
  if(!memoryCorrectionId||!instruction)return toast('Escribe qué estaba mal');
  btn.disabled=true;btn.textContent='Aprendiendo…';
  try{
    const out=await memoryApi({action:'correct',id:memoryCorrectionId,instruction});
    const i=state.captures.findIndex(x=>x.id===memoryCorrectionId);if(i>=0)state.captures[i]=out.capture;
    writeJSON(CACHE_KEY,state.captures);render();closeCorrection();toast('Corregido. Lo recordaré así');
  }catch(e){toast(e.message)}
  finally{btn.disabled=false;btn.textContent='Guardar corrección'}
}

async function memoryBackfill(){
  try{await memoryApi({action:'memory_backfill',limit:12})}catch{}
}

document.addEventListener('DOMContentLoaded',()=>{
  const search=document.getElementById('memorySearchBtn'),input=document.getElementById('memoryQuery');
  if(search)search.onclick=runMemorySearch;
  if(input)input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();runMemorySearch()}});
  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-correct]');if(b)openCorrection(b.dataset.correct)});
  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-memory-id]');if(b)openMemory(b.dataset.memoryId)});
  document.getElementById('correctionClose')?.addEventListener('click',closeCorrection);
  document.getElementById('correctionCancel')?.addEventListener('click',closeCorrection);
  document.getElementById('correctionSave')?.addEventListener('click',submitCorrection);
  document.getElementById('correctionSheet')?.addEventListener('click',e=>{if(e.target.id==='correctionSheet')closeCorrection()});
  setTimeout(memoryBackfill,1800);
});
