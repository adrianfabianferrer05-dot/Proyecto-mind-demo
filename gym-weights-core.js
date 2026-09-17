/* Planned exercise weights: weights live on each exercise in the routine, not on body weight. */
(function(){
  if(typeof gymState==='undefined')return;

  const fmt=v=>Number(v).toLocaleString('es-ES',{maximumFractionDigits:2});
  const planOf=ex=>{
    const raw=ex?.planned_weight_kg ?? ex?.working_weight_kg;
    if(raw===null||raw===undefined||raw==='')return null;
    const n=Number(raw);return Number.isFinite(n)?n:null;
  };

  const baseSeed=window.seedDrafts;
  window.seedDrafts=function(){
    const d=gymState.data;if(!d)return;
    for(const ex of d.exercises||[]){
      if(gymState.drafts.has(ex.id))continue;
      const active=(d.activeSets||[]).filter(s=>s.exercise_id===ex.id).at(-1);
      const recent=(d.recentSets||[]).find(s=>s.exercise_id===ex.id);
      const planned=planOf(ex);
      const weight=active?Number(active.weight_kg):(planned!==null?planned:Number(recent?.weight_kg||0));
      const reps=active?Number(active.reps):(recent?Number(recent.reps):Number(ex.rep_min||8));
      gymState.drafts.set(ex.id,{weight:Number.isFinite(weight)?weight:0,reps:Number.isFinite(reps)?reps:Number(ex.rep_min||8),rpe:'',warmup:false});
    }
  };

  window.openExerciseSheet=function(dayId,id=null){
    const ex=(gymState.data?.exercises||[]).find(x=>x.id===id),planned=planOf(ex);
    openGymSheet(`<form class="gym-form" data-gym-form="exercise" data-day="${gEsc(dayId)}" data-id="${gEsc(id||'')}">
      <h3>${ex?'Editar ejercicio':'Nuevo ejercicio'}</h3>
      <div class="gym-field"><label>Ejercicio</label><input name="name" maxlength="90" placeholder="Ej. Press banca" value="${gEsc(ex?.name||'')}" required></div>
      <div class="gym-form-grid">
        <div class="gym-field"><label>Series</label><input name="sets" type="number" inputmode="numeric" min="1" max="12" value="${ex?.target_sets||3}"></div>
        <div class="gym-field"><label>Peso de trabajo (kg)</label><input name="plannedWeight" type="number" inputmode="decimal" min="0" max="1000" step="0.25" placeholder="Ej. 80" value="${planned===null?'':gEsc(planned)}"></div>
      </div>
      <div class="gym-form-grid">
        <div class="gym-field"><label>Reps mín.</label><input name="repMin" type="number" inputmode="numeric" min="1" max="100" value="${ex?.rep_min||6}"></div>
        <div class="gym-field"><label>Reps máx.</label><input name="repMax" type="number" inputmode="numeric" min="1" max="100" value="${ex?.rep_max||12}"></div>
      </div>
      <div class="gym-form-grid">
        <div class="gym-field"><label>Descanso (seg)</label><input name="rest" type="number" inputmode="numeric" min="0" max="1200" value="${ex?.rest_seconds||120}"></div>
        <div class="gym-field"><label>Salto rápido de peso (kg)</label><input name="increment" type="number" inputmode="decimal" min="0.25" max="100" step="0.25" value="${ex?.increment_kg||2.5}"></div>
      </div>
      <div class="gym-field"><label>Notas opcionales</label><textarea name="notes" maxlength="800" placeholder="Técnica, agarre, asiento…">${gEsc(ex?.notes||'')}</textarea></div>
      <div class="gym-sheet-note">El peso de trabajo queda guardado en tu rutina y será el valor inicial al empezar este ejercicio. Cada serie real puede usar otro peso.</div>
      <div class="gym-sheet-actions"><button type="button" class="gym-button" data-gym-action="sheet-close">Cancelar</button><button class="gym-button signal">Guardar</button></div>
      ${ex?`<div class="gym-sheet-actions single"><button type="button" class="gym-button danger" data-gym-action="delete-exercise" data-id="${gEsc(ex.id)}" data-day="${gEsc(dayId)}">Eliminar ejercicio</button></div>`:''}
    </form>`);
  };

  document.addEventListener('submit',async e=>{
    const form=e.target.closest?.('[data-gym-form="exercise"]');if(!form)return;
    e.preventDefault();e.stopImmediatePropagation();
    const fd=new FormData(form),submit=form.querySelector('button[type="submit"],button:not([type])');if(submit)submit.disabled=true;
    try{
      const id=form.dataset.id||null;
      const out=await gymApi('POST',{
        action:'save_exercise',id,dayId:form.dataset.day,name:fd.get('name'),targetSets:fd.get('sets'),repMin:fd.get('repMin'),repMax:fd.get('repMax'),restSeconds:fd.get('rest'),incrementKg:fd.get('increment'),plannedWeightKg:fd.get('plannedWeight')===''?null:fd.get('plannedWeight'),notes:fd.get('notes')
      });
      gymState.data=out;if(id)gymState.drafts.delete(id);window.seedDrafts();closeGymSheet();renderGym();toast('Ejercicio guardado');
    }catch(err){toast(err?.message||'No pude guardar el ejercicio')}finally{if(submit)submit.disabled=false}
  },true);

  function decorateWeights(){
    if(!gymState.data)return;
    const bodyTab=document.querySelector('[data-gym-tab="body"]');if(bodyTab)bodyTab.textContent='Cuerpo';
    document.querySelectorAll('.gym-day[data-day-id]').forEach(card=>{
      const xs=(gymState.data.exercises||[]).filter(x=>x.day_id===card.dataset.dayId).sort((a,b)=>a.position-b.position);
      [...card.querySelectorAll('.gym-preview-row')].forEach((row,i)=>{
        const ex=xs[i];if(!ex)return;const right=row.querySelector(':scope > span:last-child');if(!right)return;
        const reps=`${ex.target_sets} × ${ex.rep_min}${ex.rep_max!==ex.rep_min?`–${ex.rep_max}`:''}`;
        const planned=planOf(ex);right.textContent=planned===null?reps:`${reps} · ${fmt(planned)} kg`;
      });
    });
    document.querySelectorAll('.gym-live-card[data-exercise]').forEach(card=>{
      const ex=(gymState.data.exercises||[]).find(x=>x.id===card.dataset.exercise),planned=planOf(ex),meta=card.querySelector('.gym-live-title small');
      if(!ex||planned===null||!meta||meta.dataset.planWeight)return;
      meta.dataset.planWeight='1';meta.textContent+=` · plan ${fmt(planned)} kg`;
    });
  }

  const target=document.getElementById('gymContent');if(target)new MutationObserver(()=>requestAnimationFrame(decorateWeights)).observe(target,{childList:true,subtree:true});
  decorateWeights();
})();
