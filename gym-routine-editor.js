/* Editor real de rutina para iPhone.
   La pantalla de rutina sigue siendo la vista rápida; este modo permite cambiar la
   estructura sin convertir cada tarjeta normal en un panel lleno de controles. */
const GYM_LAYOUT_URL='https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/gym-layout';
let gymRoutineEditing=false;
const greEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));

async function gymLayoutApi(body){
  const token=localStorage.getItem('sm_device_token')||'';
  if(!token)throw new Error('Este iPhone necesita volver a vincularse.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(GYM_LAYOUT_URL,{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const out=await r.json().catch(()=>({}));
    if(r.status===409&&out.error==='active_session_locked')throw new Error('Termina el entrenamiento actual antes de cambiar la estructura de la rutina.');
    if(!r.ok)throw new Error(out.detail||out.error||'No pude cambiar la rutina.');
    return out;
  }finally{clearTimeout(timer)}
}

async function refreshGymEditor(){
  gymState.data=await gymApi();
  if(typeof seedDrafts==='function')seedDrafts();
  renderGym();
}
function orderedDays(){return [...(gymState.data?.days||[])].sort((a,b)=>a.position-b.position)}
function orderedExercises(dayId){return (gymState.data?.exercises||[]).filter(x=>x.day_id===dayId).sort((a,b)=>a.position-b.position)}

function routineExerciseRow(ex,day,index,total){
  const days=orderedDays();
  return `<div class="gym-routine-exercise" data-routine-exercise="${greEsc(ex.id)}">
    <button class="gym-routine-exercise-main" data-routine-action="edit-exercise" data-id="${greEsc(ex.id)}" data-day="${greEsc(day.id)}">
      <span><b>${greEsc(ex.name)}</b><small>${ex.target_sets} × ${ex.rep_min}${ex.rep_max!==ex.rep_min?`–${ex.rep_max}`:''} · ${Math.round(ex.rest_seconds/60*10)/10} min</small></span><span class="gym-routine-chevron">›</span>
    </button>
    <div class="gym-routine-tools">
      <div class="gym-routine-order" aria-label="Cambiar orden">
        <button data-routine-action="exercise-up" data-id="${greEsc(ex.id)}" data-day="${greEsc(day.id)}" ${index===0?'disabled':''} aria-label="Subir ${greEsc(ex.name)}">↑</button>
        <button data-routine-action="exercise-down" data-id="${greEsc(ex.id)}" data-day="${greEsc(day.id)}" ${index===total-1?'disabled':''} aria-label="Bajar ${greEsc(ex.name)}">↓</button>
      </div>
      <label class="gym-routine-move"><span>Mover a</span><select data-routine-move="${greEsc(ex.id)}" data-from-day="${greEsc(day.id)}">${days.map(d=>`<option value="${greEsc(d.id)}" ${d.id===day.id?'selected':''}>${greEsc(d.name)}</option>`).join('')}</select></label>
    </div>
  </div>`;
}
function routineDayEditor(day,index,total){
  const xs=orderedExercises(day.id);
  return `<section class="gym-routine-day" data-routine-day="${greEsc(day.id)}">
    <div class="gym-routine-day-head"><div><small>DÍA ${index+1}</small><h3>${greEsc(day.name)}</h3><p>${xs.length} ejercicio${xs.length===1?'':'s'}${day.notes?` · ${greEsc(day.notes)}`:''}</p></div>
      <div class="gym-routine-day-actions"><button data-routine-action="day-up" data-id="${greEsc(day.id)}" ${index===0?'disabled':''} aria-label="Subir día">↑</button><button data-routine-action="day-down" data-id="${greEsc(day.id)}" ${index===total-1?'disabled':''} aria-label="Bajar día">↓</button><button data-routine-action="edit-day" data-id="${greEsc(day.id)}">Editar</button></div>
    </div>
    <div class="gym-routine-exercises">${xs.length?xs.map((ex,i)=>routineExerciseRow(ex,day,i,xs.length)).join(''):'<div class="gym-routine-empty">Este día todavía no tiene ejercicios.</div>'}</div>
    <button class="gym-button gym-routine-add" data-routine-action="add-exercise" data-day="${greEsc(day.id)}">+ Añadir ejercicio</button>
  </section>`;
}
function renderRoutineEditor(){
  const d=gymState.data,days=orderedDays();
  g$('gymContent').innerHTML=`<section class="gym-panel active gym-routine-editor">
    <div class="gym-routine-editor-head"><div><div class="gym-kicker">RUTINA</div><h2>${greEsc(d?.routine?.name||'Mi rutina')}</h2><p>Mueve ejercicios entre días, cambia su orden o toca uno para editarlo.</p></div><button class="gym-button signal" data-routine-action="done">Hecho</button></div>
    <div class="gym-routine-editor-actions"><button class="gym-button" data-routine-action="rename-routine">Renombrar rutina</button><button class="gym-button" data-routine-action="add-day">+ Añadir día</button></div>
    ${days.length?days.map((day,i)=>routineDayEditor(day,i,days.length)).join(''):'<div class="gym-empty"><b>Sin días.</b>Añade el primero para empezar.</div>'}
    <div class="gym-routine-editor-foot">La distribución de lunes a domingo se configura en <b>Tu semana</b> al salir del editor.</div>
  </section>`;
}

function openRoutineExerciseForm(dayId,id=null){
  const ex=(gymState.data?.exercises||[]).find(x=>x.id===id),days=orderedDays(),selected=ex?.day_id||dayId||days[0]?.id||'';
  if(!selected){toast('Añade primero un día a la rutina');return}
  openGymSheet(`<form class="gym-form" data-routine-form="exercise" data-id="${greEsc(id||'')}" data-original-day="${greEsc(ex?.day_id||selected)}"><h3>${ex?'Editar ejercicio':'Nuevo ejercicio'}</h3>
    <div class="gym-field"><label>Ejercicio</label><input name="name" maxlength="90" placeholder="Ej. Press banca" value="${greEsc(ex?.name||'')}" required></div>
    <div class="gym-field"><label>Día de la rutina</label><select name="dayId">${days.map(d=>`<option value="${greEsc(d.id)}" ${d.id===selected?'selected':''}>${greEsc(d.name)}</option>`).join('')}</select></div>
    <div class="gym-form-grid"><div class="gym-field"><label>Series</label><input name="sets" type="number" inputmode="numeric" min="1" max="12" value="${ex?.target_sets||3}"></div><div class="gym-field"><label>Descanso (seg)</label><input name="rest" type="number" inputmode="numeric" min="0" max="1200" value="${ex?.rest_seconds??120}"></div></div>
    <div class="gym-form-grid"><div class="gym-field"><label>Reps mín.</label><input name="repMin" type="number" inputmode="numeric" min="1" max="100" value="${ex?.rep_min||6}"></div><div class="gym-field"><label>Reps máx.</label><input name="repMax" type="number" inputmode="numeric" min="1" max="100" value="${ex?.rep_max||12}"></div></div>
    <div class="gym-field"><label>Salto rápido de peso (kg)</label><input name="increment" type="number" inputmode="decimal" min="0.25" max="100" step="0.25" value="${ex?.increment_kg||2.5}"></div>
    <div class="gym-field"><label>Notas opcionales</label><textarea name="notes" maxlength="800" placeholder="Técnica, agarre, asiento…">${greEsc(ex?.notes||'')}</textarea></div>
    <div class="gym-sheet-actions"><button type="button" class="gym-button" data-routine-action="close-sheet">Cancelar</button><button class="gym-button signal" type="submit">Guardar</button></div>
    ${ex?`<div class="gym-sheet-actions single"><button type="button" class="gym-button danger" data-routine-action="delete-exercise" data-id="${greEsc(ex.id)}">Eliminar ejercicio</button></div>`:''}
  </form>`);
}

async function reorderExercise(id,dayId,delta){
  const xs=orderedExercises(dayId),i=xs.findIndex(x=>x.id===id),j=i+delta;if(i<0||j<0||j>=xs.length)return;
  const next=xs.map(x=>x.id);[next[i],next[j]]=[next[j],next[i]];
  await gymLayoutApi({action:'reorder_exercises',dayId,ids:next});await refreshGymEditor();
}
async function reorderDay(id,delta){
  const ds=orderedDays(),i=ds.findIndex(x=>x.id===id),j=i+delta;if(i<0||j<0||j>=ds.length)return;
  const next=ds.map(x=>x.id);[next[i],next[j]]=[next[j],next[i]];
  await gymLayoutApi({action:'reorder_days',ids:next});await refreshGymEditor();
}
async function moveExercise(id,targetDayId,select){
  select.disabled=true;
  try{await gymLayoutApi({action:'move_exercise',exerciseId:id,targetDayId});await refreshGymEditor();toast('Ejercicio movido')}
  catch(e){toast(e.message||'No pude moverlo');renderRoutineEditor()}
}

async function routineEditorClick(e){
  const el=e.target.closest('[data-routine-action]');if(!el)return;
  const a=el.dataset.routineAction,id=el.dataset.id,day=el.dataset.day;
  try{
    if(a==='open'){if(gymState.data?.activeSession){toast('Termina el entrenamiento actual antes de editar la rutina.');return}gymRoutineEditing=true;renderGym();return}
    if(a==='done'){gymRoutineEditing=false;renderGym();return}
    if(a==='rename-routine')return openRoutineSheet();
    if(a==='add-day')return openDaySheet();
    if(a==='edit-day')return openDaySheet(id);
    if(a==='add-exercise')return openRoutineExerciseForm(day);
    if(a==='edit-exercise')return openRoutineExerciseForm(day,id);
    if(a==='exercise-up')return await reorderExercise(id,day,-1);
    if(a==='exercise-down')return await reorderExercise(id,day,1);
    if(a==='day-up')return await reorderDay(id,-1);
    if(a==='day-down')return await reorderDay(id,1);
    if(a==='close-sheet')return closeGymSheet();
    if(a==='delete-exercise'){
      if(!confirm('¿Eliminar este ejercicio de la rutina?'))return;
      gymState.data=await gymApi('POST',{action:'delete_exercise',id});gymState.drafts?.delete(id);closeGymSheet();renderGym();toast('Ejercicio eliminado');return;
    }
  }catch(err){toast(err?.message||'No pude guardar el cambio')}
}
async function routineEditorSubmit(e){
  const form=e.target.closest('[data-routine-form="exercise"]');if(!form)return;e.preventDefault();
  const fd=new FormData(form),id=form.dataset.id||null,originalDay=form.dataset.originalDay,targetDay=String(fd.get('dayId')||originalDay),submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;
  try{
    const saveDay=id?originalDay:targetDay;
    gymState.data=await gymApi('POST',{action:'save_exercise',id,dayId:saveDay,name:fd.get('name'),targetSets:fd.get('sets'),repMin:fd.get('repMin'),repMax:fd.get('repMax'),restSeconds:fd.get('rest'),incrementKg:fd.get('increment'),notes:fd.get('notes')});
    if(id&&targetDay!==originalDay){await gymLayoutApi({action:'move_exercise',exerciseId:id,targetDayId:targetDay});gymState.data=await gymApi()}
    if(typeof seedDrafts==='function')seedDrafts();closeGymSheet();renderGym();toast('Rutina actualizada');
  }catch(err){toast(err?.message||'No pude guardar el ejercicio')}finally{if(submit)submit.disabled=false}
}

(function installRoutineEditor(){
  if(typeof gymState==='undefined'||typeof renderRoutine!=='function')return;
  const base=renderRoutine;
  window.renderRoutine=function(){
    if(gymRoutineEditing){renderRoutineEditor();return}
    const out=base.apply(this,arguments);
    const head=document.querySelector('#gymContent .gym-section-head');
    if(head&&!head.querySelector('[data-routine-action="open"]')){
      const old=head.querySelector('[data-gym-action="rename-routine"]');if(old)old.remove();
      const b=document.createElement('button');b.type='button';b.dataset.routineAction='open';b.textContent='Editar rutina';head.appendChild(b);
    }
    return out;
  };
  const gym=g$('gym');gym?.addEventListener('click',routineEditorClick,true);gym?.addEventListener('submit',routineEditorSubmit,true);
  gym?.addEventListener('change',e=>{const select=e.target.closest('[data-routine-move]');if(select&&select.value!==select.dataset.fromDay)moveExercise(select.dataset.routineMove,select.value,select)});
})();
