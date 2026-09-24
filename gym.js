const GYM_URL='https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/gym';
const GYM_TOKEN_KEY='sm_device_token';
const GYM_REST_KEY='sm_gym_rest_end';
const gymState={data:null,loading:false,tab:'routine',drafts:new Map(),lastLoaded:0};
let gymRestTimer=null,gymElapsedTimer=null,gymPrTimer=null;
const g$=id=>document.getElementById(id);
const gEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
const gNum=(v,f=0)=>{const n=Number(v);return Number.isFinite(n)?n:f};
const kg=v=>`${new Intl.NumberFormat('es-ES',{maximumFractionDigits:2}).format(gNum(v))} kg`;
const shortDate=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short'}).format(d):'—'};
const clock=v=>{const s=Math.max(0,Math.floor(v));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`};

async function gymApi(method='GET',body=null){
  const token=localStorage.getItem(GYM_TOKEN_KEY)||'';
  if(!token)throw new Error('Este iPhone necesita volver a vincularse.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(GYM_URL,{method,signal:controller.signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const out=await r.json().catch(()=>({}));
    if(r.status===401)throw new Error('La sesión de este iPhone ha caducado.');
    if(!r.ok){
      const map={day_has_active_session:'Termina primero el entrenamiento activo.',session_not_open:'Ese entrenamiento ya está cerrado.',day_not_found:'Ese día ya no existe.',exercise_not_found:'Ese ejercicio ya no existe.'};
      throw new Error(map[out.error]||out.detail||out.error||'No pude guardar el cambio.');
    }
    return out;
  }finally{clearTimeout(timer)}
}

function gymIcon(){return `<svg viewBox="0 0 24 24"><path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/></svg>`}
function installGym(){
  if(g$('gym'))return;
  const main=document.querySelector('.app');
  const archive=g$('archivo');
  const view=document.createElement('main');
  view.id='gym';view.className='view gym-view';
  view.innerHTML=`
    <div class="gym-head"><div class="gym-kicker">ENTRENO</div><h1>Fuerte,<br>sin libreta.</h1><p>Tu rutina, tus series y tus pesos. Apuntar una serie debe tardar segundos.</p></div>
    <div class="gym-tabs" role="tablist" aria-label="Gimnasio"><button class="gym-tab active" data-gym-tab="routine">Rutina</button><button class="gym-tab" data-gym-tab="history">Historial</button><button class="gym-tab" data-gym-tab="body">Cuerpo</button></div>
    <div id="gymContent"><div class="gym-empty"><b>Cargando…</b>Recuperando tu rutina.</div></div>
    <div class="gym-rest" id="gymRest"><div class="gym-rest-ring" id="gymRestTime">0:00</div><div class="gym-rest-copy"><b>Descanso</b><span id="gymRestLabel">Recupera y sigue.</span></div><button data-gym-action="rest-add">+30s</button><button data-gym-action="rest-skip">Saltar</button></div>
    <div class="gym-sheet" id="gymSheet" aria-hidden="true"><div class="gym-sheet-panel"><div class="gym-sheet-grab"></div><div id="gymSheetBody"></div></div></div>
    <div class="gym-pr" id="gymPr">Nuevo récord personal</div>`;
  main.insertBefore(view,archive);

  const nav=document.querySelector('.nav');
  const archiveButton=nav.querySelector('[data-view="archivo"]');
  const button=document.createElement('button');
  button.dataset.view='gym';button.innerHTML=`${gymIcon()}<span>Gym</span>`;
  nav.insertBefore(button,archiveButton);
  button.onclick=()=>{go('gym');loadGym({quiet:true})};
  view.addEventListener('click',gymClick);
  view.addEventListener('submit',gymSubmit);
  g$('gymSheet').addEventListener('click',e=>{if(e.target===g$('gymSheet'))closeGymSheet()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&g$('gymSheet')?.classList.contains('show'))closeGymSheet()});
  restoreRestTimer();
}

async function loadGym({quiet=false}={}){
  if(gymState.loading)return;
  gymState.loading=true;
  if(!quiet&&!gymState.data)g$('gymContent').innerHTML='<div class="gym-empty"><b>Cargando…</b>Recuperando tu rutina.</div>';
  try{
    const out=await gymApi();
    gymState.data=out;gymState.lastLoaded=Date.now();seedDrafts();renderGym();
  }catch(e){
    g$('gymContent').innerHTML=`<div class="gym-empty"><b>No pude cargar el gym.</b>${gEsc(e.message)}<br><button class="gym-button signal" data-gym-action="retry" style="margin-top:14px">Reintentar</button></div>`;
  }finally{gymState.loading=false}
}

function seedDrafts(){
  const d=gymState.data;if(!d)return;
  for(const ex of d.exercises||[]){
    if(gymState.drafts.has(ex.id))continue;
    const active=(d.activeSets||[]).filter(s=>s.exercise_id===ex.id).at(-1);
    const recent=(d.recentSets||[]).find(s=>s.exercise_id===ex.id);
    const src=active||recent;
    gymState.drafts.set(ex.id,{weight:gNum(src?.weight_kg,0),reps:gNum(src?.reps,ex.rep_min||8),rpe:'',warmup:false});
  }
}
function exForDay(id){return (gymState.data?.exercises||[]).filter(e=>e.day_id===id).sort((a,b)=>a.position-b.position)}
function recentForExercise(id){return (gymState.data?.recentSets||[]).find(x=>x.exercise_id===id)}
function bestForExercise(id){return (gymState.data?.bests||[]).find(x=>x.exercise_id===id)}
function setsForExercise(id){return (gymState.data?.activeSets||[]).filter(s=>s.exercise_id===id)}

function renderGym(){
  const d=gymState.data;if(!d)return;
  document.querySelectorAll('.gym-tab').forEach(b=>b.classList.toggle('active',b.dataset.gymTab===gymState.tab));
  if(d.activeSession)renderWorkout();
  else if(gymState.tab==='history')renderHistory();
  else if(gymState.tab==='body')renderBody();
  else renderRoutine();
  updateElapsedTimer();
}

function summary(){
  const d=gymState.data||{},last=d.history?.[0],body=d.body?.[0];
  return `<div class="gym-summary">
    <div class="gym-stat primary"><span>Este mes</span><b>${gNum(d.stats?.sessions_month,0)}</b><small>entrenamientos</small></div>
    <div class="gym-stat"><span>Última sesión</span><b>${last?kg(last.volume_kg).replace(' kg','k'): '—'}</b><small>${last?shortDate(last.started_at):'sin datos'}</small></div>
    <div class="gym-stat"><span>Peso corporal</span><b>${body?kg(body.weight_kg):'—'}</b><small>${body?shortDate(body.measured_at):'opcional'}</small></div>
  </div>`;
}

function renderRoutine(){
  const d=gymState.data,days=d.days||[];
  const dayCards=days.map(day=>{
    const xs=exForDay(day.id);
    return `<article class="gym-day" data-day-id="${gEsc(day.id)}"><div class="gym-day-main"><div class="gym-day-top"><div><div class="gym-day-name">${gEsc(day.name)}</div><div class="gym-day-meta">${xs.length} ejercicio${xs.length===1?'':'s'}${day.notes?` · ${gEsc(day.notes)}`:''}</div></div><div class="gym-day-actions"><button class="gym-icon-button" data-gym-action="edit-day" data-id="${gEsc(day.id)}" aria-label="Editar día"><svg viewBox="0 0 24 24"><path d="m4 16 12-12 4 4L8 20H4v-4Z"/></svg></button></div></div>
      <div class="gym-exercise-preview">${xs.length?xs.map(ex=>`<div class="gym-preview-row"><b>${gEsc(ex.name)}</b><span>${ex.target_sets} × ${ex.rep_min}${ex.rep_max!==ex.rep_min?`–${ex.rep_max}`:''}</span></div>`).join(''):'<div class="gym-preview-row"><b style="color:var(--muted)">Añade el primer ejercicio</b><span>—</span></div>'}</div></div>
      <div class="gym-day-bottom"><button class="gym-button signal" data-gym-action="start" data-id="${gEsc(day.id)}" ${xs.length?'':'disabled'}>Empezar</button><button class="gym-button" data-gym-action="add-exercise" data-id="${gEsc(day.id)}">+ Ejercicio</button></div></article>`;
  }).join('');
  g$('gymContent').innerHTML=`<section class="gym-panel active">${summary()}<div class="gym-section"><div class="gym-section-head"><h2>${gEsc(d.routine?.name||'Mi rutina')}</h2><button data-gym-action="rename-routine">Renombrar</button></div><div class="gym-days">${dayCards||`<div class="gym-empty"><b>Crea tu rutina.</b>No voy a inventarte ejercicios. Añade tus días y luego tus ejercicios.<br><button class="gym-button signal" data-gym-action="add-day">+ Primer día</button></div>`}</div>${days.length?`<button class="gym-button ghost" data-gym-action="add-day" style="width:100%;margin-top:10px">+ Añadir día</button>`:''}</div>${historyPreview()}</section>`;
}

function historyPreview(){
  const hist=gymState.data?.history||[];if(!hist.length)return '';
  return `<div class="gym-section"><div class="gym-section-head"><h2>Últimas sesiones</h2><button data-gym-action="tab-history">Ver todas</button></div><div class="gym-history">${hist.slice(0,3).map(historyCard).join('')}</div></div>`;
}
function historySetsFor(sessionId){return (gymState.data?.historySets||[]).filter(s=>s.session_id===sessionId)}
function previousSetsForExercise(exerciseId){
  const d=gymState.data||{},sessions=d.history||[],sets=d.historySets||[];
  for(const session of sessions){
    const found=sets.filter(s=>s.session_id===session.id&&s.exercise_id===exerciseId&&!s.is_warmup);
    if(found.length)return found;
  }
  return [];
}
function historyCard(h){
  const sets=historySetsFor(h.id),groups=[];
  for(const s of sets){
    let group=groups.find(g=>(s.exercise_id&&g.id===s.exercise_id)||(!s.exercise_id&&g.name===s.exercise_name_snapshot));
    if(!group){group={id:s.exercise_id||'',name:s.exercise_name_snapshot||'Ejercicio',sets:[]};groups.push(group)}
    group.sets.push(s);
  }
  const detail=groups.length?`<div class="gym-history-detail">${groups.map(g=>`<div class="gym-history-exercise"><b>${gEsc(g.name)}</b><div class="gym-history-sets">${g.sets.map(s=>`<span class="${s.is_warmup?'warmup':''}">${kg(s.weight_kg)} × ${gNum(s.reps)} reps${s.rpe?` · RPE ${gEsc(s.rpe)}`:''}${s.is_warmup?' · calent.':''}</span>`).join('')}</div></div>`).join('')}</div>`:'<div class="gym-history-detail empty">No hay series guardadas en esta sesión.</div>';
  return `<details class="gym-history-card gym-history-session"><summary><div><b>${gEsc(h.day_name_snapshot||'Entreno')}</b><span>${shortDate(h.started_at)} · ${gNum(h.set_count)} series</span></div><span class="gym-history-vol">${new Intl.NumberFormat('es-ES',{maximumFractionDigits:0}).format(gNum(h.volume_kg))} kg</span><span class="gym-history-chevron">⌄</span></summary>${detail}</details>`
}

function renderHistory(){
  const d=gymState.data,h=d.history||[];
  g$('gymContent').innerHTML=`<section class="gym-panel active">${summary()}<div class="gym-section"><div class="gym-section-head"><h2>Historial</h2><span style="color:var(--muted);font-size:10px">30 días · ${gNum(d.stats?.sessions_30d)} sesiones</span></div><div class="gym-history">${h.length?h.map(historyCard).join(''):'<div class="gym-empty"><b>Aún no hay historial.</b>Termina tu primer entrenamiento y aparecerá aquí.</div>'}</div></div></section>`;
}

function renderBody(){
  const d=gymState.data,rows=d.body||[];
  g$('gymContent').innerHTML=`<section class="gym-panel active"><div class="gym-body-card"><div class="gym-section-head" style="margin:0"><div><h2>Peso corporal</h2><div style="color:var(--muted);font-size:10px;margin-top:4px">Opcional. Solo si te sirve seguirlo.</div></div></div><div class="gym-body-input"><input id="gymBodyWeight" type="number" inputmode="decimal" min="20" max="400" step="0.1" placeholder="kg"><button class="gym-button signal" data-gym-action="log-body">Guardar</button></div></div><div class="gym-section"><div class="gym-section-head"><h2>Registros</h2></div><div class="gym-body-list">${rows.length?rows.map(r=>`<div class="gym-body-row"><div><b>${kg(r.weight_kg)}</b><span>${shortDate(r.measured_at)}${r.note?` · ${gEsc(r.note)}`:''}</span></div><button data-gym-action="delete-body" data-id="${gEsc(r.id)}" aria-label="Borrar">×</button></div>`).join(''):'<div class="gym-empty"><b>Sin registros.</b>Cuando quieras, apunta tu peso arriba.</div>'}</div></div></section>`;
}

function renderWorkout(){
  const d=gymState.data,s=d.activeSession,day=(d.days||[]).find(x=>x.id===s.day_id),xs=exForDay(s.day_id);
  g$('gymContent').innerHTML=`<section class="gym-panel active"><div class="gym-workout-head"><small>ENTRENANDO</small><h2>${gEsc(s.day_name_snapshot||day?.name||'Sesión')}</h2><div class="gym-workout-meta"><span id="gymElapsed">0:00</span><span>${(d.activeSets||[]).length} series guardadas</span></div></div><div class="gym-exercises-live">${xs.map(liveExercise).join('')}</div><div class="gym-finish"><button class="gym-button signal" data-gym-action="finish">Terminar entrenamiento</button><button class="gym-button danger" data-gym-action="cancel">Cancelar</button></div></section>`;
}

function liveExercise(ex){
  const sets=setsForExercise(ex.id),recent=recentForExercise(ex.id),best=bestForExercise(ex.id),previous=previousSetsForExercise(ex.id),draft=gymState.drafts.get(ex.id)||{weight:0,reps:ex.rep_min||8,rpe:'',warmup:false};
  const chips=sets.map(s=>`<button class="gym-set-chip ${s.is_warmup?'warmup':''}" data-gym-action="edit-set" data-id="${gEsc(s.id)}"><b>${kg(s.weight_kg)} × ${s.reps}</b><span>${s.is_warmup?'calentamiento':`Serie ${s.set_number}${s.rpe?` · RPE ${s.rpe}`:''}`}</span></button>`).join('');
  return `<article class="gym-live-card" data-exercise="${gEsc(ex.id)}"><div class="gym-live-title"><div><h3>${gEsc(ex.name)}</h3><small>${ex.target_sets} series · ${ex.rep_min}${ex.rep_max!==ex.rep_min?`–${ex.rep_max}`:''} reps · ${Math.round(ex.rest_seconds/60*10)/10} min</small></div><div class="gym-best">${best?`<b>${kg(best.max_weight)}</b>máx · e1RM ${kg(best.best_e1rm)}`:recent?`<b>${kg(recent.weight_kg)} × ${recent.reps}</b>última vez`:'Sin marca previa'}</div></div><div class="gym-previous"><span>ANTERIOR</span>${previous.length?`<div class="gym-previous-sets">${previous.map(s=>`<b>${kg(s.weight_kg)} × ${gNum(s.reps)} reps</b>`).join('')}</div>`:`<b>Sin sesión anterior</b>`}</div><div class="gym-sets">${chips||'<span style="color:var(--muted);font-size:10px;padding:9px 2px">Aún no has guardado series.</span>'}</div><div class="gym-entry"><div class="gym-step"><div class="gym-step-label">PESO</div><div class="gym-step-main"><button data-gym-action="weight-minus" data-id="${gEsc(ex.id)}">−</button><input id="gymWeight-${gEsc(ex.id)}" type="number" inputmode="decimal" min="0" step="0.25" value="${gEsc(draft.weight)}"><button data-gym-action="weight-plus" data-id="${gEsc(ex.id)}">+</button></div><div class="gym-step-unit">kg · salto ${ex.increment_kg} kg</div></div><div class="gym-step"><div class="gym-step-label">REPS</div><div class="gym-step-main"><button data-gym-action="reps-minus" data-id="${gEsc(ex.id)}">−</button><input id="gymReps-${gEsc(ex.id)}" type="number" inputmode="numeric" min="0" max="200" value="${gEsc(draft.reps)}"><button data-gym-action="reps-plus" data-id="${gEsc(ex.id)}">+</button></div><div class="gym-step-unit">objetivo ${ex.rep_min}${ex.rep_max!==ex.rep_min?`–${ex.rep_max}`:''}</div></div></div><div class="gym-entry-options"><button class="gym-warmup ${draft.warmup?'active':''}" data-gym-action="warmup" data-id="${gEsc(ex.id)}">Calentamiento</button><select class="gym-rpe" id="gymRpe-${gEsc(ex.id)}" aria-label="RPE"><option value="">RPE —</option>${[6,7,8,9,10].map(n=>`<option value="${n}" ${String(draft.rpe)===String(n)?'selected':''}>RPE ${n}</option>`).join('')}</select><button class="gym-log-set" data-gym-action="log-set" data-id="${gEsc(ex.id)}">Guardar serie</button></div></article>`;
}

function updateDraftFromInputs(id){
  const ex=(gymState.data?.exercises||[]).find(e=>e.id===id);if(!ex)return null;
  const old=gymState.drafts.get(id)||{};
  const draft={weight:Math.max(0,gNum(g$(`gymWeight-${id}`)?.value,old.weight||0)),reps:Math.max(0,Math.round(gNum(g$(`gymReps-${id}`)?.value,old.reps||ex.rep_min||8))),rpe:g$(`gymRpe-${id}`)?.value||'',warmup:!!old.warmup};
  gymState.drafts.set(id,draft);return draft;
}
function nudge(id,field,delta){
  const ex=(gymState.data?.exercises||[]).find(e=>e.id===id);if(!ex)return;
  const draft=updateDraftFromInputs(id)||{};
  if(field==='weight')draft.weight=Math.max(0,Math.round((gNum(draft.weight)+delta)*100)/100);else draft.reps=Math.max(0,Math.round(gNum(draft.reps)+delta));
  gymState.drafts.set(id,draft);const input=g$(`${field==='weight'?'gymWeight':'gymReps'}-${id}`);if(input)input.value=field==='weight'?String(draft.weight):String(draft.reps);
}

async function gymClick(e){
  const tab=e.target.closest('[data-gym-tab]');if(tab){gymState.tab=tab.dataset.gymTab;renderGym();return}
  const el=e.target.closest('[data-gym-action]');if(!el)return;
  const a=el.dataset.gymAction,id=el.dataset.id;
  try{
    if(a==='retry')return loadGym();
    if(a==='tab-history'){gymState.tab='history';return renderGym()}
    if(a==='add-day')return openDaySheet();
    if(a==='edit-day')return openDaySheet(id);
    if(a==='add-exercise')return openExerciseSheet(id);
    if(a==='rename-routine')return openRoutineSheet();
    if(a==='start'){el.disabled=true;const out=await gymApi('POST',{action:'start_session',dayId:id});gymState.data=out;seedDrafts();renderGym();return}
    if(a==='weight-minus'||a==='weight-plus'){const ex=(gymState.data?.exercises||[]).find(x=>x.id===id),step=gNum(ex?.increment_kg,2.5);return nudge(id,'weight',a==='weight-plus'?step:-step)}
    if(a==='reps-minus'||a==='reps-plus')return nudge(id,'reps',a==='reps-plus'?1:-1);
    if(a==='warmup'){const d=updateDraftFromInputs(id);if(d){d.warmup=!d.warmup;gymState.drafts.set(id,d);el.classList.toggle('active',d.warmup)}return}
    if(a==='log-set')return logGymSet(id,el);
    if(a==='edit-set')return openSetSheet(id);
    if(a==='finish')return openFinishSheet();
    if(a==='cancel')return openCancelSheet();
    if(a==='log-body')return logBody(el);
    if(a==='delete-body'){if(confirm('¿Borrar este registro de peso?')){gymState.data=await gymApi('POST',{action:'delete_bodyweight',id});renderGym()}return}
    if(a==='rest-add')return adjustRest(30);
    if(a==='rest-skip')return stopRest();
    if(a==='sheet-close')return closeGymSheet();
    if(a==='delete-day')return deleteDay(id);
    if(a==='duplicate-day'){gymState.data=await gymApi('POST',{action:'duplicate_day',id});closeGymSheet();renderGym();return}
    if(a==='delete-exercise')return deleteExercise(id,el.dataset.day);
  }catch(err){toast(err?.message||'No pude guardar el cambio');if(el)el.disabled=false}
}

async function logGymSet(id,button){
  const d=updateDraftFromInputs(id),s=gymState.data?.activeSession,ex=(gymState.data?.exercises||[]).find(x=>x.id===id);if(!d||!s||!ex)return;
  button.disabled=true;button.textContent='Guardando…';
  try{
    const out=await gymApi('POST',{action:'log_set',sessionId:s.id,exerciseId:id,weightKg:d.weight,reps:d.reps,rpe:d.rpe?Number(d.rpe):null,isWarmup:d.warmup});
    gymState.data=out;const nd={...d,warmup:false};gymState.drafts.set(id,nd);renderGym();
    if(!d.warmup&&ex.rest_seconds>0)startRest(ex.rest_seconds,ex.name);
    if(out.isPr)showGymPr();
  }catch(e){toast(e.message||'No pude guardar la serie')}finally{button.disabled=false}
}

function openGymSheet(html){const sh=g$('gymSheet');g$('gymSheetBody').innerHTML=html;sh.classList.add('show');sh.setAttribute('aria-hidden','false');document.body.classList.add('sheet-open');setTimeout(()=>sh.querySelector('input,button,select,textarea')?.focus({preventScroll:true}),380)}
function closeGymSheet(){const sh=g$('gymSheet');sh.classList.remove('show');sh.setAttribute('aria-hidden','true');document.body.classList.remove('sheet-open')}
function openRoutineSheet(){openGymSheet(`<form class="gym-form" data-gym-form="routine"><h3>Nombre de la rutina</h3><div class="gym-field"><label>Nombre</label><input name="name" maxlength="60" value="${gEsc(gymState.data?.routine?.name||'Mi rutina')}" required></div><div class="gym-sheet-actions"><button type="button" class="gym-button" data-gym-action="sheet-close">Cancelar</button><button class="gym-button signal">Guardar</button></div></form>`)}
function openDaySheet(id=null){
  const day=(gymState.data?.days||[]).find(x=>x.id===id);
  openGymSheet(`<form class="gym-form" data-gym-form="day" data-id="${gEsc(id||'')}"><h3>${day?'Editar día':'Nuevo día'}</h3><div class="gym-field"><label>Nombre</label><input name="name" maxlength="70" placeholder="Ej. Push, Pierna, Torso…" value="${gEsc(day?.name||'')}" required></div><div class="gym-field"><label>Notas opcionales</label><textarea name="notes" maxlength="800" placeholder="Enfoque, recordatorios…">${gEsc(day?.notes||'')}</textarea></div><div class="gym-sheet-actions"><button type="button" class="gym-button" data-gym-action="sheet-close">Cancelar</button><button class="gym-button signal">Guardar</button></div>${day?`<div class="gym-sheet-actions"><button type="button" class="gym-button" data-gym-action="duplicate-day" data-id="${gEsc(day.id)}">Duplicar día</button><button type="button" class="gym-button danger" data-gym-action="delete-day" data-id="${gEsc(day.id)}">Eliminar día</button></div>`:''}</form>`)
}
function openExerciseSheet(dayId,id=null){
  const ex=(gymState.data?.exercises||[]).find(x=>x.id===id);
  openGymSheet(`<form class="gym-form" data-gym-form="exercise" data-day="${gEsc(dayId)}" data-id="${gEsc(id||'')}"><h3>${ex?'Editar ejercicio':'Nuevo ejercicio'}</h3><div class="gym-field"><label>Ejercicio</label><input name="name" maxlength="90" placeholder="Ej. Press banca" value="${gEsc(ex?.name||'')}" required></div><div class="gym-form-grid"><div class="gym-field"><label>Series</label><input name="sets" type="number" inputmode="numeric" min="1" max="12" value="${ex?.target_sets||3}"></div><div class="gym-field"><label>Descanso (seg)</label><input name="rest" type="number" inputmode="numeric" min="0" max="1200" value="${ex?.rest_seconds||120}"></div></div><div class="gym-form-grid"><div class="gym-field"><label>Reps mín.</label><input name="repMin" type="number" inputmode="numeric" min="1" max="100" value="${ex?.rep_min||6}"></div><div class="gym-field"><label>Reps máx.</label><input name="repMax" type="number" inputmode="numeric" min="1" max="100" value="${ex?.rep_max||12}"></div></div><div class="gym-field"><label>Salto rápido de peso (kg)</label><input name="increment" type="number" inputmode="decimal" min="0.25" max="100" step="0.25" value="${ex?.increment_kg||2.5}"></div><div class="gym-field"><label>Notas opcionales</label><textarea name="notes" maxlength="800" placeholder="Técnica, agarre, asiento…">${gEsc(ex?.notes||'')}</textarea></div><div class="gym-sheet-actions"><button type="button" class="gym-button" data-gym-action="sheet-close">Cancelar</button><button class="gym-button signal">Guardar</button></div>${ex?`<div class="gym-sheet-actions single"><button type="button" class="gym-button danger" data-gym-action="delete-exercise" data-id="${gEsc(ex.id)}" data-day="${gEsc(dayId)}">Eliminar ejercicio</button></div>`:''}</form>`)
}
function openSetSheet(id){
  const s=(gymState.data?.activeSets||[]).find(x=>x.id===id);if(!s)return;
  openGymSheet(`<form class="gym-form" data-gym-form="set" data-id="${gEsc(id)}"><h3>Editar serie</h3><div class="gym-form-grid"><div class="gym-field"><label>Peso (kg)</label><input name="weight" type="number" inputmode="decimal" min="0" step="0.25" value="${gEsc(s.weight_kg)}"></div><div class="gym-field"><label>Reps</label><input name="reps" type="number" inputmode="numeric" min="0" max="200" value="${gEsc(s.reps)}"></div></div><div class="gym-form-grid"><div class="gym-field"><label>RPE</label><select name="rpe"><option value="">—</option>${[6,7,8,9,10].map(n=>`<option value="${n}" ${String(s.rpe)===String(n)?'selected':''}>${n}</option>`).join('')}</select></div><div class="gym-field"><label>Tipo</label><select name="warmup"><option value="false" ${!s.is_warmup?'selected':''}>Serie normal</option><option value="true" ${s.is_warmup?'selected':''}>Calentamiento</option></select></div></div><div class="gym-sheet-actions"><button type="button" class="gym-button danger" data-gym-form-delete-set="${gEsc(id)}">Eliminar</button><button class="gym-button signal">Guardar</button></div></form>`);
  const del=g$('gymSheetBody').querySelector('[data-gym-form-delete-set]');del.onclick=async()=>{try{gymState.data=await gymApi('POST',{action:'delete_set',id});closeGymSheet();renderGym()}catch(e){toast(e.message)}};
}
function openFinishSheet(){openGymSheet(`<form class="gym-form" data-gym-form="finish"><h3>Entreno terminado.</h3><div class="gym-field"><label>Nota opcional</label><textarea name="notes" maxlength="1000" placeholder="Cómo fue, algo que quieras recordar…"></textarea></div><div class="gym-sheet-actions"><button type="button" class="gym-button" data-gym-action="sheet-close">Seguir entrenando</button><button class="gym-button signal">Guardar y terminar</button></div></form>`)}
function openCancelSheet(){openGymSheet(`<div class="gym-form"><h3>¿Cancelar sesión?</h3><div class="gym-sheet-note">Se borrarán las series de este entrenamiento. Tu rutina no cambia.</div><div class="gym-sheet-actions"><button class="gym-button" data-gym-action="sheet-close">No</button><button class="gym-button danger" id="gymCancelConfirm">Sí, cancelar</button></div></div>`);g$('gymCancelConfirm').onclick=async()=>{try{gymState.data=await gymApi('POST',{action:'cancel_session',sessionId:gymState.data.activeSession.id});closeGymSheet();stopRest();renderGym()}catch(e){toast(e.message)}}}

async function gymSubmit(e){
  const form=e.target.closest('[data-gym-form]');if(!form)return;e.preventDefault();const fd=new FormData(form),kind=form.dataset.gymForm,submit=form.querySelector('button[type="submit"],button:not([type])');if(submit)submit.disabled=true;
  try{
    let out;
    if(kind==='routine')out=await gymApi('POST',{action:'rename_routine',name:fd.get('name')});
    if(kind==='day')out=await gymApi('POST',{action:'save_day',id:form.dataset.id||null,name:fd.get('name'),notes:fd.get('notes')});
    if(kind==='exercise')out=await gymApi('POST',{action:'save_exercise',id:form.dataset.id||null,dayId:form.dataset.day,name:fd.get('name'),targetSets:fd.get('sets'),repMin:fd.get('repMin'),repMax:fd.get('repMax'),restSeconds:fd.get('rest'),incrementKg:fd.get('increment'),notes:fd.get('notes')});
    if(kind==='set')out=await gymApi('POST',{action:'update_set',id:form.dataset.id,weightKg:fd.get('weight'),reps:fd.get('reps'),rpe:fd.get('rpe')||null,isWarmup:fd.get('warmup')==='true'});
    if(kind==='finish'){out=await gymApi('POST',{action:'finish_session',sessionId:gymState.data.activeSession.id,notes:fd.get('notes')});stopRest();gymState.tab='history'}
    gymState.data=out;seedDrafts();closeGymSheet();renderGym();toast('Guardado');
  }catch(err){toast(err?.message||'No pude guardarlo')}finally{if(submit)submit.disabled=false}
}
async function deleteDay(id){if(!confirm('¿Eliminar este día y sus ejercicios?'))return;gymState.data=await gymApi('POST',{action:'delete_day',id});closeGymSheet();renderGym()}
async function deleteExercise(id){if(!confirm('¿Eliminar este ejercicio de la rutina?'))return;gymState.data=await gymApi('POST',{action:'delete_exercise',id});closeGymSheet();gymState.drafts.delete(id);renderGym()}
async function logBody(button){const input=g$('gymBodyWeight'),v=gNum(input?.value,null);if(v===null||v<20||v>400){toast('Escribe un peso válido');return}button.disabled=true;try{gymState.data=await gymApi('POST',{action:'log_bodyweight',weightKg:v});renderGym();toast('Peso guardado')}finally{button.disabled=false}}

function startRest(seconds,label){const end=Date.now()+seconds*1000;localStorage.setItem(GYM_REST_KEY,String(end));localStorage.setItem(`${GYM_REST_KEY}_label`,label||'Siguiente serie');runRest()}
function restoreRestTimer(){const end=Number(localStorage.getItem(GYM_REST_KEY)||0);if(end>Date.now())runRest();else stopRest()}
function runRest(){clearInterval(gymRestTimer);const tick=()=>{const end=Number(localStorage.getItem(GYM_REST_KEY)||0),left=Math.ceil((end-Date.now())/1000);if(left<=0){stopRest();if('vibrate'in navigator)navigator.vibrate?.([80,60,80]);toast('Descanso terminado');return}const box=g$('gymRest');if(!box)return;box.classList.add('show');g$('gymRestTime').textContent=clock(left);g$('gymRestLabel').textContent=localStorage.getItem(`${GYM_REST_KEY}_label`)||'Recupera y sigue.'};tick();gymRestTimer=setInterval(tick,1000)}
function adjustRest(sec){const end=Math.max(Date.now(),Number(localStorage.getItem(GYM_REST_KEY)||Date.now()))+sec*1000;localStorage.setItem(GYM_REST_KEY,String(end));runRest()}
function stopRest(){clearInterval(gymRestTimer);gymRestTimer=null;localStorage.removeItem(GYM_REST_KEY);localStorage.removeItem(`${GYM_REST_KEY}_label`);g$('gymRest')?.classList.remove('show')}
function showGymPr(){const p=g$('gymPr');if(!p)return;p.classList.add('show');clearTimeout(gymPrTimer);gymPrTimer=setTimeout(()=>p.classList.remove('show'),1900)}
function updateElapsedTimer(){clearInterval(gymElapsedTimer);gymElapsedTimer=null;const s=gymState.data?.activeSession;if(!s)return;const tick=()=>{const el=g$('gymElapsed');if(el)el.textContent=clock((Date.now()-new Date(s.started_at).getTime())/1000)};tick();gymElapsedTimer=setInterval(tick,1000)}

installGym();
