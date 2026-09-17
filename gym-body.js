/* Personal muscle-progress view. It visualises strength progress from the user's own logged sets; it does not estimate real muscle mass. */
(function(){
  if(typeof gymState==='undefined')return;
  const PROGRESS_URL='https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/gym-progress';
  const state={rows:null,loading:false,last:0};
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const defs={
    chest:{label:'Pecho'},back:{label:'Espalda'},shoulders:{label:'Hombros'},arms:{label:'Brazos'},legs:{label:'Piernas'},core:{label:'Core'}
  };

  function weightsFor(name){
    const n=norm(name),w={};
    const add=(k,v)=>w[k]=(w[k]||0)+v;
    if(/apertura|press inclinado|press plano|press banca|pecho/.test(n)){add('chest',.7);add('shoulders',.12);add('arms',.18)}
    else if(/remo|jalon|dominada|espalda/.test(n)){add('back',.78);add('arms',.22)}
    else if(/lateral|hombro|militar/.test(n)){add('shoulders',.8);add('arms',.2)}
    else if(/curl|biceps|triceps|frances|extension.*triceps|polea.*triceps/.test(n)){add('arms',1)}
    else if(/prensa|bulgara|cuadriceps|femoral|aductor|gemelo|sentadilla|peso muerto|hip thrust|pierna/.test(n)){add('legs',1)}
    else if(/abdom|core|plancha/.test(n)){add('core',1)}
    return w;
  }

  async function loadProgress(force=false){
    if(state.loading||(!force&&state.rows&&Date.now()-state.last<30000))return;
    const token=localStorage.getItem('sm_device_token')||'';if(!token)return;
    state.loading=true;
    try{
      const r=await fetch(PROGRESS_URL,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      if(!r.ok)throw new Error('progress_http_'+r.status);
      const out=await r.json();state.rows=Array.isArray(out.rows)?out.rows:[];state.last=Date.now();
      if(gymState.tab==='body')window.renderBody?.();
    }catch(err){console.warn('[Gym progress]',err)}finally{state.loading=false}
  }

  function calculate(){
    const rows=new Map((state.rows||[]).map(r=>[r.exercise_id,r]));
    const groups=Object.fromEntries(Object.keys(defs).map(k=>[k,{gainSum:0,weight:0,sets:0,exercises:0,score:0,gain:0}]));
    for(const ex of gymState.data?.exercises||[]){
      const map=weightsFor(ex.name);if(!Object.keys(map).length)continue;
      const row=rows.get(ex.id);if(!row)continue;
      const base=Number(row.baseline_e1rm||0),best=Number(row.best_e1rm||0),sets=Number(row.set_count||0);
      if(!(base>0&&best>0&&sets>0))continue;
      const gain=Math.max(0,(best/base-1)*100);
      for(const [k,w] of Object.entries(map)){
        const g=groups[k];g.gainSum+=gain*w;g.weight+=w;g.sets+=sets;g.exercises+=1;
      }
    }
    let overallNum=0,overallDen=0;
    for(const [k,g] of Object.entries(groups)){
      if(g.weight>0){g.gain=g.gainSum/g.weight;g.score=clamp(25+(Math.min(g.gain,40)/40)*75);overallNum+=g.gain*g.weight;overallDen+=g.weight}
      else{g.gain=0;g.score=0}
    }
    const overallGain=overallDen?overallNum/overallDen:0;
    const overallScore=overallDen?clamp(25+(Math.min(overallGain,40)/40)*75):0;
    return {groups,overallGain,overallScore,hasData:overallDen>0};
  }

  function shape(level,key,inner){return `<g class="body-muscle" data-muscle="${key}" style="--level:${level.toFixed(1)}">${inner}</g>`}
  function figure(groups,overallScore){
    const l=k=>groups[k]?.score||0;
    return `<svg class="muscle-figure muscle-pulse" style="--body-grow:${overallScore.toFixed(1)}" viewBox="0 0 260 520" role="img" aria-label="Silueta muscular que crece con tu progreso de fuerza">
      <ellipse class="body-shell" cx="130" cy="47" rx="30" ry="38"/>
      <path class="body-shell" d="M111 80c-17 5-31 12-43 25-9 9-15 26-17 48l8 109 18 35 9 95 10 92 20 0 5-91 9-83 9 83 5 91 20 0 11-92 9-95 18-35 8-109c-2-22-8-39-17-48-12-13-26-20-43-25l-9 14h-20l-9-14Z"/>
      <path class="body-shell" d="M63 119c-15 5-24 19-26 39l-8 87 14 4 18-82 12-32-10-16Z"/><path class="body-shell" d="M197 119c15 5 24 19 26 39l8 87-14 4-18-82-12-32 10-16Z"/>
      ${shape(l('shoulders'),'shoulders',`<ellipse cx="82" cy="125" rx="24" ry="21"/><ellipse cx="178" cy="125" rx="24" ry="21"/>`)}
      ${shape(l('chest'),'chest',`<path d="M89 131c10-14 24-19 40-14v41c-16 3-31-3-42-18l2-9Z"/><path d="M171 131c-10-14-24-19-40-14v41c16 3 31-3 42-18l-2-9Z"/>`)}
      ${shape(l('back'),'back',`<path d="M83 151c7 4 14 7 24 9l-8 69c-14-9-23-25-25-48l9-30Z"/><path d="M177 151c-7 4-14 7-24 9l8 69c14-9 23-25 25-48l-9-30Z"/>`)}
      ${shape(l('arms'),'arms',`<ellipse cx="49" cy="174" rx="13" ry="31"/><ellipse cx="211" cy="174" rx="13" ry="31"/><ellipse cx="40" cy="227" rx="10" ry="31"/><ellipse cx="220" cy="227" rx="10" ry="31"/>`)}
      ${shape(l('core'),'core',`<rect x="111" y="168" width="18" height="27" rx="8"/><rect x="131" y="168" width="18" height="27" rx="8"/><rect x="112" y="198" width="17" height="28" rx="8"/><rect x="131" y="198" width="17" height="28" rx="8"/><rect x="114" y="229" width="15" height="27" rx="7"/><rect x="131" y="229" width="15" height="27" rx="7"/>`)}
      ${shape(l('legs'),'legs',`<path d="M88 278c11-10 23-15 34-12l-8 105-23 2-10-66 7-29Z"/><path d="M172 278c-11-10-23-15-34-12l8 105 23 2 10-66-7-29Z"/><path d="M96 376c8-7 14-8 20-3l-5 97-16 0-8-59 9-35Z"/><path d="M164 376c-8-7-14-8-20-3l5 97 16 0 8-59-9-35Z"/>`)}
      <circle class="body-joint" cx="103" cy="487" r="12"/><circle class="body-joint" cx="157" cy="487" r="12"/>
    </svg>`;
  }

  function card(key,g){
    const has=g.weight>0,label=defs[key].label;
    const big=has?`+${g.gain.toFixed(g.gain<10?1:0)}%`:'—';
    const desc=!has?'Sin series todavía':g.gain<1?'Base establecida':g.gain<5?'Empezando a subir':g.gain<15?'Progreso sólido':'Subida fuerte';
    return `<div class="muscle-card"><div class="muscle-card-top"><b>${label}</b><strong>${big}</strong></div><div class="muscle-bar" style="--fill:${g.score.toFixed(1)}"><i></i></div><small>${desc}${has?` · ${g.sets} series`:''}</small></div>`;
  }

  window.renderBody=function(){
    const d=gymState.data;if(!d)return;
    const p=calculate(),body=d.body||[],latest=body[0];
    if(!state.rows&&!state.loading)loadProgress();
    const ringLabel=p.hasData?`+${p.overallGain.toFixed(p.overallGain<10?1:0)}%`:'—';
    g$('gymContent').innerHTML=`<section class="gym-panel active muscle-progress">
      <div class="muscle-progress-head"><div><h2>Cuerpo</h2><p>La silueta crece con tus propias marcas. No te compara con nadie.</p></div><div class="muscle-ring" style="--ring:${p.overallScore.toFixed(1)}"><div class="muscle-ring-copy"><b>${ringLabel}</b><span>fuerza desde tu base</span></div></div></div>
      <div class="muscle-stage">${figure(p.groups,p.overallScore)}</div>
      <div class="muscle-grid">${['chest','shoulders','back','arms','legs','core'].map(k=>card(k,p.groups[k])).join('')}</div>
      ${!p.hasData?`<div class="muscle-data-empty"><b>Tu silueta aún está en el punto de partida.</b>Guarda tus primeras series con peso y repeticiones. Esas marcas serán tu base y, desde ahí, verás crecer cada zona.</div>`:''}
      <div class="muscle-note"><svg viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-8M22 19V3"/></svg><div><b>Basado en tus pesos y series</b>Usa la mejora de tu fuerza estimada por ejercicio para animar cada grupo muscular. Es una visualización de progreso, no una medición real de masa muscular.</div></div>
      <details class="bodyweight-optional"><summary><b>Peso corporal</b><span>${latest?kg(latest.weight_kg):'Opcional'} · mostrar</span></summary><div class="gym-body-card"><div class="gym-section-head" style="margin:0"><div><h2>Peso corporal</h2><div style="color:var(--muted);font-size:10px;margin-top:4px">Separado de tus pesos de entrenamiento.</div></div></div><div class="gym-body-input"><input id="gymBodyWeight" type="number" inputmode="decimal" min="20" max="400" step="0.1" placeholder="kg"><button class="gym-button signal" data-gym-action="log-body">Guardar</button></div></div></details>
    </section>`;
  };

  const baseLogSet=window.logGymSet;
  if(typeof baseLogSet==='function')window.logGymSet=async function(id,button){const out=await baseLogSet(id,button);setTimeout(()=>loadProgress(true),250);return out};

  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&gymState.tab==='body')loadProgress(true)});
})();
