/* Navigation fix for active workouts: training stays alive while Routine, History and Body remain browsable. */
(function(){
  if(typeof gymState==='undefined')return;

  let seenSessionId=null;

  function syncTabs(){
    const tabs=document.querySelector('.gym-tabs');
    if(!tabs)return;
    const activeId=gymState.data?.activeSession?.id||null;
    let workout=tabs.querySelector('[data-gym-tab="workout"]');
    if(activeId){
      if(!workout){
        workout=document.createElement('button');
        workout.className='gym-tab';
        workout.dataset.gymTab='workout';
        workout.textContent='Entreno';
        tabs.prepend(workout);
      }
      tabs.style.gridTemplateColumns='repeat(4,minmax(0,1fr))';
    }else{
      workout?.remove();
      tabs.style.gridTemplateColumns='repeat(3,minmax(0,1fr))';
    }
    tabs.querySelectorAll('.gym-tab').forEach(b=>b.classList.toggle('active',b.dataset.gymTab===gymState.tab));
  }

  function decorateRoutineDuringWorkout(){
    const session=gymState.data?.activeSession;if(!session)return;
    const root=document.querySelector('#gymContent .gym-panel');if(!root)return;
    if(!root.querySelector('.gym-active-nav')){
      const banner=document.createElement('div');
      banner.className='gym-active-nav';
      banner.innerHTML=`<div><small>ENTRENAMIENTO EN CURSO</small><b>${gEsc(session.day_name_snapshot||'Sesión activa')}</b><span>Puedes mirar o editar tu rutina sin perder el entrenamiento.</span></div><button class="gym-button signal" data-gym-tab="workout">Volver al entreno</button>`;
      banner.style.cssText='display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;margin:0 0 18px;padding:14px 14px 14px 16px;border:1px solid rgba(202,255,88,.16);border-radius:20px;background:linear-gradient(135deg,rgba(202,255,88,.09),rgba(19,22,26,.9));';
      const copy=banner.firstElementChild;
      copy.querySelector('small').style.cssText='display:block;color:var(--signal);font-size:9px;font-weight:780;margin-bottom:4px';
      copy.querySelector('b').style.cssText='display:block;font-size:14px';
      copy.querySelector('span').style.cssText='display:block;color:var(--muted);font-size:9px;line-height:1.35;margin-top:4px';
      banner.querySelector('button').style.cssText='min-width:118px';
      root.prepend(banner);
    }

    document.querySelectorAll('.gym-day[data-day-id]').forEach(card=>{
      const start=card.querySelector('[data-gym-action="start"]');if(!start)return;
      if(card.dataset.dayId===session.day_id){
        start.removeAttribute('data-gym-action');
        start.dataset.gymTab='workout';
        start.disabled=false;
        start.textContent='Volver al entreno';
      }else{
        start.disabled=true;
        start.textContent='Entreno en curso';
      }
    });
  }

  /* OJO: esto SUSTITUYE a renderGym, no lo envuelve. Es a proposito —durante una
     sesion se puede seguir navegando la rutina, y el reparto de pestañas original no
     lo permite—, pero tiene una consecuencia: cualquier modulo que se cuelgue de
     `renderGym` esperando que se llame al anterior se queda sin ejecutar y en
     silencio. Si necesitas anadir algo al panel de rutina, envuelve `renderRoutine`,
     que si se llama desde aqui. */
  window.renderGym=function(){
    const d=gymState.data;if(!d)return;
    const sessionId=d.activeSession?.id||null;

    if(sessionId&&sessionId!==seenSessionId){
      gymState.tab='workout';
      seenSessionId=sessionId;
    }else if(!sessionId){
      seenSessionId=null;
      if(gymState.tab==='workout')gymState.tab='routine';
    }

    syncTabs();

    if(gymState.tab==='workout'&&d.activeSession)renderWorkout();
    else if(gymState.tab==='history')renderHistory();
    else if(gymState.tab==='body')renderBody();
    else {
      renderRoutine();
      if(d.activeSession)decorateRoutineDuringWorkout();
    }

    syncTabs();
    updateElapsedTimer();
  };

  /* If another late-loaded enhancement redraws Gym, keep tab state consistent. */
  const target=document.getElementById('gymContent');
  if(target)new MutationObserver(()=>requestAnimationFrame(syncTabs)).observe(target,{childList:true,subtree:false});
})();
