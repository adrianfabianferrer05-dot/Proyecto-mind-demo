/* Extra gym polish: edit exercises directly from the routine and surface progress without adding clutter. */
(function(){
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let decorating=false;
  const iconEdit='<svg viewBox="0 0 24 24"><path d="m4 16 12-12 4 4L8 20H4v-4Z"/></svg>';
  const iconUp='<svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6"/></svg>';
  const iconDown='<svg viewBox="0 0 24 24"><path d="m6 10 6 6 6-6"/></svg>';

  function enhanceRoutine(){
    if(typeof gymState==='undefined'||!gymState.data||gymState.data.activeSession)return;
    document.querySelectorAll('.gym-day[data-day-id]').forEach(card=>{
      const dayId=card.dataset.dayId,rows=[...card.querySelectorAll('.gym-preview-row')],xs=(gymState.data.exercises||[]).filter(x=>x.day_id===dayId).sort((a,b)=>a.position-b.position);
      rows.forEach((row,i)=>{
        const ex=xs[i];if(!ex||row.dataset.enhanced)return;row.dataset.enhanced='1';row.dataset.exerciseId=ex.id;
        row.style.cursor='pointer';row.setAttribute('role','button');row.setAttribute('tabindex','0');row.setAttribute('aria-label',`Editar ${ex.name}`);
        const right=row.querySelector('span');if(right)right.insertAdjacentHTML('beforebegin',`<span class="gym-inline-actions"><button class="gym-mini-icon" data-gym-extra="up" data-day="${dayId}" data-id="${ex.id}" aria-label="Subir ${ex.name}" ${i===0?'disabled':''}>${iconUp}</button><button class="gym-mini-icon" data-gym-extra="down" data-day="${dayId}" data-id="${ex.id}" aria-label="Bajar ${ex.name}" ${i===xs.length-1?'disabled':''}>${iconDown}</button><button class="gym-mini-icon edit" data-gym-extra="edit" data-day="${dayId}" data-id="${ex.id}" aria-label="Editar ${ex.name}">${iconEdit}</button></span>`);
      });
    });
  }
  function enhanceRpe(){
    document.querySelectorAll('.gym-rpe').forEach(sel=>{
      if(sel.dataset.halves)return;sel.dataset.halves='1';const current=sel.value;
      sel.innerHTML='<option value="">RPE —</option>'+[6,6.5,7,7.5,8,8.5,9,9.5,10].map(n=>`<option value="${n}">RPE ${String(n).replace('.',',')}</option>`).join('');sel.value=current;
    });
  }
  function enhanceProgress(){
    if(typeof gymState==='undefined'||gymState.tab!=='history'||gymState.data?.activeSession)return;
    const content=document.getElementById('gymContent');if(!content||content.querySelector('[data-gym-records]'))return;
    const bests=(gymState.data?.bests||[]).map(b=>({b,e:(gymState.data.exercises||[]).find(e=>e.id===b.exercise_id)})).filter(x=>x.e).sort((a,b)=>Number(b.b.best_e1rm)-Number(a.b.best_e1rm)).slice(0,8);
    if(!bests.length)return;
    const section=document.createElement('section');section.className='gym-section';section.dataset.gymRecords='1';section.innerHTML=`<div class="gym-section-head"><h2>Marcas</h2><span class="gym-record-note">Estimación para comparar contigo mismo</span></div><div class="gym-record-grid">${bests.map(({b,e})=>`<div class="gym-record-card"><span>${String(e.name).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]))}</span><b>${Number(b.max_weight).toLocaleString('es-ES',{maximumFractionDigits:2})} kg</b><small>e1RM ${Number(b.best_e1rm).toLocaleString('es-ES',{maximumFractionDigits:1})} kg</small></div>`).join('')}</div>`;
    content.querySelector('.gym-panel')?.appendChild(section);
    if(!reduce)section.animate([{opacity:.5,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(.23,1,.32,1)'});
  }
  function decorate(){if(decorating)return;decorating=true;requestAnimationFrame(()=>{enhanceRoutine();enhanceRpe();enhanceProgress();decorating=false})}

  async function reorder(dayId,id,dir){
    const xs=(gymState.data?.exercises||[]).filter(x=>x.day_id===dayId).sort((a,b)=>a.position-b.position),i=xs.findIndex(x=>x.id===id),j=i+dir;if(i<0||j<0||j>=xs.length)return;
    [xs[i],xs[j]]=[xs[j],xs[i]];
    try{const out=await gymApi('POST',{action:'reorder_exercises',ids:xs.map(x=>x.id)});gymState.data=out;renderGym();toast('Orden actualizado')}catch(e){toast(e?.message||'No pude mover el ejercicio')}
  }
  document.addEventListener('click',e=>{
    const extra=e.target.closest?.('[data-gym-extra]');
    if(extra){e.preventDefault();e.stopPropagation();const {gymExtra,day,id}=extra.dataset;if(gymExtra==='edit')openExerciseSheet(day,id);if(gymExtra==='up')reorder(day,id,-1);if(gymExtra==='down')reorder(day,id,1);return}
    const row=e.target.closest?.('.gym-preview-row[data-exercise-id]');if(row&&!e.target.closest('button')){const card=row.closest('.gym-day'),id=row.dataset.exerciseId;openExerciseSheet(card.dataset.dayId,id)}
  },true);
  document.addEventListener('keydown',e=>{const row=e.target.closest?.('.gym-preview-row[data-exercise-id]');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openExerciseSheet(row.closest('.gym-day').dataset.dayId,row.dataset.exerciseId)}});
  const target=document.getElementById('gymContent');if(target)new MutationObserver(decorate).observe(target,{childList:true,subtree:true});
  decorate();
})();