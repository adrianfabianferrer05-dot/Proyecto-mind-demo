/* Gym → Cuerpo. Personal body-progress panel.

   It draws an anatomical silhouette whose muscle groups light up, fill and gain
   definition from the user's own logged strength. It never compares the user with
   anybody else: every number is measured against that user's own first recorded set.

   Data it reads
     · gymState.data                    — /functions/v1/gym (routine, exercises, history, stats, body log)
     · /functions/v1/gym-progress rows  — {exercise_id, baseline_e1rm, best_e1rm, first_at, last_at, set_count, total_volume}
                                          baseline_e1rm is the chronologically first estimated 1RM for that
                                          exercise and best_e1rm the highest one, so their ratio is the
                                          user's own gain on that movement.

   What it shows is strength progress, not a measurement of real muscle mass. */
(function(){
  if(typeof gymState==='undefined')return;

  const PROGRESS_URL='https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/gym-progress';

  /* Tuning constants. Everything below is deterministic: same logs in, same picture out. */
  const MIN_SETS=2;       // an exercise needs a baseline plus at least one later set before a gain means anything
  const GAIN_FULL=45;     // % improvement over your own baseline that already lights a zone completely
  const WORK_FULL=150;    // accumulated working sets that already count as full training volume for a zone
  const BASE_LEVEL=20;    // a zone with real data is never drawn empty
  const TRUST_SETS=8;     // sets after which an exercise's gain is trusted at full weight

  const state={rows:null,loading:false,fetchedAt:0,focus:null};

  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number.isFinite(+n)?+n:0));
  const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  const pct=n=>`${(n<10?Math.round(n*10)/10:Math.round(n)).toLocaleString('es-ES')}%`;

  /* ── Muscle groups ─────────────────────────────────────────────────────── */
  const GROUPS={
    chest:{label:'Pecho',hint:'Empujes horizontales'},
    back:{label:'Espalda',hint:'Tirones y remos'},
    shoulders:{label:'Hombros',hint:'Empujes verticales'},
    arms:{label:'Brazos',hint:'Bíceps, tríceps y antebrazo'},
    core:{label:'Core',hint:'Abdomen y estabilidad'},
    legs:{label:'Piernas',hint:'Tren inferior completo'}
  };
  const ORDER=['chest','back','shoulders','arms','core','legs'];

  /* ── Exercise → muscle map ─────────────────────────────────────────────────
     Ordered list, first match wins. Each rule splits one exercise across the
     groups it actually trains, so a bench press feeds chest mostly but also
     shoulders and triceps. The order is specific → generic on purpose: "curl
     femoral" is a hamstring movement and must match before the generic "curl"
     (biceps) rule, and quad extensions before triceps extensions. Names are
     normalised (lowercase, accents stripped) before matching, and both Spanish
     and the usual English names are covered.
     To extend this: add a rule ABOVE the generic ones and keep each rule's
     weights adding up to 1, so every exercise contributes the same total. */
  const MAP=[
    // ── Ambiguous names that must beat a later, broader rule ──────────────
    {re:/elevacion(es)? de piernas|leg raise|elevacion(es)? de rodillas/,w:{core:1}},  // core work, not a leg lift

    // ── Legs ──────────────────────────────────────────────────────────────
    {re:/curl femoral|femoral|isquio|leg curl|hamstring/,w:{legs:1}},
    {re:/extension (de )?(cuadriceps|pierna|rodilla)|leg extension|cuadriceps|quad/,w:{legs:1}},
    {re:/gemelo|soleo|calf|elevacion de talon|talones/,w:{legs:1}},
    {re:/aductor|abductor|adduct|abduct/,w:{legs:1}},
    {re:/hip thrust|puente de glute|glute|gluteo|patada de cadera/,w:{legs:.85,core:.15}},
    {re:/zancada|lunge|bulgara|split squat|estocada|step up|subida al cajon/,w:{legs:.85,core:.15}},
    {re:/prensa|leg press|hack/,w:{legs:.9,core:.1}},
    {re:/sentadilla|squat|goblet/,w:{legs:.8,core:.2}},
    {re:/peso muerto|deadlift|rumano|romanian|\brdl\b/,w:{legs:.4,back:.45,core:.15}},
    {re:/buenos dias|good morning|hiperextension|lumbar|espinales/,w:{back:.6,legs:.3,core:.1}},
    {re:/pierna|tren inferior/,w:{legs:1}},

    // ── Back ──────────────────────────────────────────────────────────────
    {re:/dominada|pull ?up|chin ?up|jalon|pulldown|polea alta/,w:{back:.75,arms:.25}},
    {re:/remo|row|pendlay|serrucho|gironda/,w:{back:.7,arms:.2,shoulders:.1}},
    {re:/pullover/,w:{back:.6,chest:.3,arms:.1}},
    {re:/face ?pull|pajaro|posterior|reverse fly/,w:{back:.5,shoulders:.5}},
    {re:/encogimiento|shrug|trapecio|\btrap\b/,w:{back:.7,shoulders:.3}},
    {re:/espalda|dorsal|\blat\b|lats/,w:{back:1}},

    // ── Chest ─────────────────────────────────────────────────────────────
    {re:/apertura|\bfly\b|contractora|peck ?deck|pec ?deck|cruce|crossover/,w:{chest:.9,shoulders:.1}},
    {re:/fondo|dips|paralelas/,w:{chest:.5,arms:.35,shoulders:.15}},
    {re:/flexion|push ?up|lagartija/,w:{chest:.6,arms:.25,shoulders:.15}},
    {re:/press (de )?banca|bench|banca|press (plano|inclinado|declinado|pecho)/,w:{chest:.65,arms:.2,shoulders:.15}},
    {re:/pecho|pectoral/,w:{chest:1}},

    // ── Shoulders ─────────────────────────────────────────────────────────
    {re:/elevacion lateral|lateral raise|laterales/,w:{shoulders:1}},
    {re:/elevacion frontal|front raise|frontales/,w:{shoulders:1}},
    {re:/press militar|militar|overhead|press (de )?hombro|arnold|\bohp\b|push press/,w:{shoulders:.7,arms:.2,core:.1}},
    {re:/hombro|deltoide|deltoid|shoulder/,w:{shoulders:1}},

    // ── Arms ──────────────────────────────────────────────────────────────
    {re:/triceps|frances|skull ?crusher|copa|pushdown|press cerrado/,w:{arms:1}},
    {re:/biceps|martillo|hammer|predicador|preacher|concentrado|spider/,w:{arms:1}},
    {re:/antebrazo|forearm|muneca|wrist|agarre|grip|rodillo/,w:{arms:1}},
    {re:/\bcurl\b/,w:{arms:1}},
    {re:/brazo/,w:{arms:1}},

    // ── Core ──────────────────────────────────────────────────────────────
    {re:/abdomin|abdomen|crunch|plancha|plank|rueda|ab ?wheel|russian|oblicuo|hollow|\bcore\b|dead ?bug|pallof/,w:{core:1}}
  ];

  /* Returns the group split for an exercise name, or null when it is not classified. */
  function muscleMix(name){
    const n=norm(name);
    for(const rule of MAP)if(rule.re.test(n))return rule.w;
    return null;
  }

  /* ── Progress data ─────────────────────────────────────────────────────── */
  async function loadProgress(force=false){
    if(state.loading||(!force&&state.rows&&Date.now()-state.fetchedAt<30000))return;
    const token=localStorage.getItem('sm_device_token')||'';
    if(!token)return;
    state.loading=true;
    let changed=false;
    try{
      const r=await fetch(PROGRESS_URL,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      if(!r.ok)throw new Error('progress_http_'+r.status);
      const out=await r.json();
      state.rows=Array.isArray(out.rows)?out.rows:[];
      state.fetchedAt=Date.now();
      changed=true;
    }catch(err){
      console.warn('[Gym progress]',err);
    }finally{
      state.loading=false;
      if(changed&&gymState.tab==='body'&&!gymState.data?.activeSession)window.renderBody?.();
    }
  }

  /* ── Model ─────────────────────────────────────────────────────────────────
     Builds the whole panel from the user's own logs. Pure function of the current
     data: no randomness, no time-based drift, no comparison with other people. */
  function buildModel(){
    const data=gymState.data||{};
    const rows=new Map((state.rows||[]).map(r=>[r.exercise_id,r]));
    const groups={};
    for(const key of ORDER)groups[key]={key,...GROUPS[key],gainNum:0,gainDen:0,sets:0,volume:0,lastAt:null,level:0,gain:0,share:0,drivers:[]};

    let unmapped=0;
    const tracked=[];
    for(const ex of data.exercises||[]){
      const mix=muscleMix(ex.name);
      if(!mix){unmapped++;continue}
      const row=rows.get(ex.id);
      const sets=Math.max(0,Number(row?.set_count)||0);
      const base=Number(row?.baseline_e1rm)||0;
      const best=Number(row?.best_e1rm)||0;
      const volume=Math.max(0,Number(row?.total_volume)||0);
      const usable=sets>=MIN_SETS&&base>0&&best>0;
      /* Gains are floored at zero: a bad day never eats into what you already built. */
      const gain=usable?clamp((best/base-1)*100,0,150):0;
      /* Few sets means weak evidence, so trust ramps up to full at TRUST_SETS. */
      const trust=usable?clamp(sets/TRUST_SETS,0,1):0;
      if(usable&&gain>1)tracked.push({ex,row,gain});
      for(const [key,share] of Object.entries(mix)){
        const g=groups[key];if(!g)continue;
        g.sets+=sets*share;
        g.volume+=volume*share;
        if(usable){
          g.gainNum+=gain*share*trust;
          g.gainDen+=share*trust;
          g.drivers.push({name:ex.name,gain,sets,share});
        }
        const last=row?.last_at?new Date(row.last_at).getTime():0;
        if(Number.isFinite(last)&&last&&(!g.lastAt||last>g.lastAt))g.lastAt=last;
      }
    }

    let gainNum=0,gainDen=0,totalSets=0;
    for(const g of Object.values(groups)){
      g.gain=g.gainDen>0?g.gainNum/g.gainDen:0;
      g.hasData=g.sets>0;
      /* Level = how built the zone looks: presence + your own improvement + accumulated work.
         A zone you train hard but that has plateaued still reads as developed; a zone you
         never touch stays dark. */
      const gainPart=Math.min(g.gain,GAIN_FULL)/GAIN_FULL*50;
      const workPart=Math.min(g.sets,WORK_FULL)/WORK_FULL*30;
      g.level=g.hasData?clamp(BASE_LEVEL+gainPart+workPart):0;
      gainNum+=g.gainNum;gainDen+=g.gainDen;totalSets+=g.sets;
    }
    for(const g of Object.values(groups))g.share=totalSets>0?g.sets/totalSets*100:0;

    const withData=Object.values(groups).filter(g=>g.hasData);
    const overallGain=gainDen>0?gainNum/gainDen:0;
    /* The global figure averages the six zones, so skipping a zone visibly holds the body back. */
    const overallLevel=clamp(ORDER.reduce((a,k)=>a+groups[k].level,0)/ORDER.length);

    const ranked=withData.filter(g=>g.gainDen>0).sort((a,b)=>b.gain-a.gain);
    const best=ranked[0]&&ranked[0].gain>=1?ranked[0]:null;

    /* Most recently trained exercise that already sits above its own baseline. */
    const latest=tracked.sort((a,b)=>new Date(b.row.last_at||0)-new Date(a.row.last_at||0))[0]||null;

    return {
      groups,
      overallGain,
      overallLevel,
      hasData:gainDen>0,
      hasAnySets:withData.length>0,
      best,
      latest:latest?{name:latest.ex.name,gain:latest.gain,at:latest.row.last_at}:null,
      consistency:consistency(data),
      /* True until the strength history has actually arrived, so a slow network never
         flashes "still building your base" at somebody who has years of logs. */
      pending:!state.rows,
      unmapped
    };
  }

  /* Training consistency from finished sessions: how many of the latest weeks in a
     row hold at least one session, plus the plain 30-day count. */
  function consistency(data){
    const hist=(data.history||[]).map(h=>new Date(h.started_at).getTime()).filter(Number.isFinite);
    const now=Date.now(),week=6048e5;
    let streak=0;
    for(let i=0;i<8;i++){
      const to=now-i*week,from=to-week;
      if(hist.some(t=>t>from&&t<=to))streak++;else break;
    }
    return {streak,sessions30:Number(data.stats?.sessions_30d)||hist.filter(t=>t>now-2592e6).length};
  }


  /* ── Presentation ──────────────────────────────────────────────────────────
     Layout: a board with the figure (and its progress arc) on the left and the
     six muscle zones on the right, each zone card carrying a thumbnail that is a
     crop of the very same anatomy, so list and silhouette always agree. */
  const A=()=>window.GYM_ANATOMY;

  /* How a level turns into light.

     The level drives the muscle's COLOUR, not its transparency: a barely trained zone
     is a deep moss green and a well built one is full neon lime. Dimming a lime fill
     with opacity instead just turns it olive against the dark body, which is what
     makes this kind of panel look washed out. Volume, definition and halo ride along
     on the same curve, which is deliberately non-linear — the first sets should
     already show, and the top of the range is reserved for zones you have pushed. */
  /* Interpolating dark-grey → lime in RGB passes through washed-out greys, so the
     ramp runs in HSL instead: the lime hue never moves, only its saturation and
     lightness. An untrained zone is a deep olive that still reads as anatomy; a
     fully built one lands exactly on the app's signal lime. */
  function massGradient(key,level){
    const k=Math.pow(clamp(level,0,100)/100,.6);
    const s=40+58*k,l=11+55*k;
    const c=(dl,ds)=>`hsl(76, ${Math.round(Math.min(100,s+ds))}%, ${Math.round(Math.max(4,l+dl))}%)`;
    return `<linearGradient id="bpM-${key}" x1="0" y1="0" x2="0" y2="1">`
      +`<stop offset="0" stop-color="${c(13,-8)}"/><stop offset=".48" stop-color="${c(0,0)}"/><stop offset="1" stop-color="${c(-9,2)}"/></linearGradient>`;
  }

  function lightVars(key,level,index){
    const t=clamp(level,0,100)/100;
    return `--mf:url(#bpM-${key});`
      +`--sc:${(.955+t*.07).toFixed(4)};`                  // a subtle gain in volume
      +`--def:${Math.max(0,(level-38)/62).toFixed(3)};`    // separations only once it is built
      +`--glow:${(.6+t*5).toFixed(2)}px;`                  // halo in viewBox units
      +`--lvl:${level.toFixed(1)};--i:${index||0}`;
  }

  function figure(model){
    const a=A();if(!a)return '';
    const shell=a.both(a.SHELL);
    const layers=a.ORDER.map((key,i)=>{
      const m=a.MUSCLES[key];
      return `<g class="bp-group" data-group="${key}" style="${lightVars(key,model.groups[key].level,i)}">`
        +a.both(m.mass,'bp-mass')+a.both(m.def,'bp-def')+a.once(m.mid,'bp-def')+`</g>`;
    }).join('');
    return `<svg class="bp-figure" viewBox="0 0 260 600" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Silueta corporal: cada zona se ilumina según tu propio progreso de fuerza">
      ${gradients('bp',a.ORDER.map(k=>massGradient(k,model.groups[k].level)).join(''))}
      <defs><clipPath id="bpClip">${a.flat(a.SHELL)}</clipPath></defs>
      <g class="bp-edge">${shell}</g>
      <g class="bp-shell">${shell}</g>
      <g class="bp-muscles" clip-path="url(#bpClip)">${layers}</g>
      <g class="bp-detail">${a.both(a.DETAIL)}</g>
      <g class="bp-sweep" clip-path="url(#bpClip)" aria-hidden="true"><rect x="0" y="0" width="260" height="190" fill="url(#bpSweepFill)"/></g>
      <g class="bp-hit" aria-hidden="true">${a.ORDER.map(k=>`<g data-bp-zone="${k}">${a.both(a.MUSCLES[k].mass)}</g>`).join('')}</g>
    </svg>`;
  }

  /* The same crop of the same body, so a card's icon is literally its zone. */
  function thumb(key,g){
    const a=A();if(!a)return '';
    const m=a.MUSCLES[key];
    return `<svg class="bp-thumb" viewBox="${m.thumb}" aria-hidden="true" style="${lightVars('t-'+key,g.level)}">
      <defs>${massGradient('t-'+key,g.level)}<clipPath id="bpClipT${key}">${a.flat(a.SHELL)}</clipPath>${shellGradient('bpT'+key)}</defs>
      <g class="bp-shell" style="--shell:url(#bpT${key}ShellFill)">${a.both(a.SHELL)}</g>
      <g clip-path="url(#bpClipT${key})"><g class="bp-group">${a.both(m.mass,'bp-mass')}</g></g>
    </svg>`;
  }

  function shellGradient(id){
    return `<linearGradient id="${id}ShellFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#151b21"/><stop offset=".55" stop-color="#0f141a"/><stop offset="1" stop-color="#090c0f"/>
    </linearGradient>`;
  }

  function gradients(id,extra){
    return `<defs>${shellGradient(id)}
      <linearGradient id="${id}SweepFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#caff58" stop-opacity="0"/>
        <stop offset=".5" stop-color="#f4ffd8" stop-opacity=".38"/>
        <stop offset="1" stop-color="#caff58" stop-opacity="0"/>
      </linearGradient>${extra||''}</defs>`;
  }

  /* Progress arc behind the figure: a 240° sweep starting at the lower left. */
  function arc(level){
    const len=(level*3.686).toFixed(1);
    return `<svg class="bp-arc" viewBox="0 0 200 200" aria-hidden="true">
      <circle class="bp-arc-track" cx="100" cy="100" r="88"/>
      ${level>=1?`<circle class="bp-arc-fill" cx="100" cy="100" r="88" style="--len:${len}"/>`:''}
    </svg>`;
  }

  const ICON_BARS='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V10M10 19V5M16 19v-6M22 19V8"/></svg>';

  function badge(model){
    return `<div class="bp-badge" style="--ring:${model.overallLevel.toFixed(1)}">
      <div class="bp-badge-copy">${ICON_BARS}<b>${model.hasData?`+${pct(model.overallGain)}`:'—'}</b><span>fuerza desde tu base</span></div>
    </div>`;
  }

  function zoneCard(g,focused){
    const value=g.hasData?`${Math.round(g.level)}%`:'<i>—</i>';
    return `<button type="button" class="bp-zone${focused?' is-focus':''}" data-bp-zone="${g.key}" aria-pressed="${focused}" style="--lvl:${g.level.toFixed(1)}">
      <span class="bp-zone-icon">${thumb(g.key,g)}</span>
      <span class="bp-zone-body">
        <span class="bp-zone-top"><b>${g.label}</b><strong>${value}</strong></span>
        <span class="bp-zone-bar"><i></i></span>
      </span>
      <span class="bp-zone-chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></span>
    </button>`;
  }

  function readout(model){
    const g=state.focus?model.groups[state.focus]:null;
    if(!g)return `<div class="bp-readout">
      <b>${model.pending?'Leyendo tus marcas…':model.hasAnySets?'Toca una zona del cuerpo':'Tu punto de partida'}</b>
      <span>${model.pending?'Un momento: estoy repasando tus series y tus pesos.':model.hasAnySets?'Verás qué ejercicios la alimentan y cuánto ha subido desde tu primera marca.':'Cada serie que guardes empieza a dar forma a esta silueta.'}</span>
    </div>`;
    const drivers=[...g.drivers].sort((a,b)=>b.gain*b.share-a.gain*a.share).slice(0,3);
    return `<div class="bp-readout is-zone">
      <b>${g.label}<em>${Math.round(g.level)}%</em></b>
      <span>${g.gainDen>0?`+${pct(g.gain)} sobre tu base`:'Todavía sin margen medible'} · ${Math.round(g.sets)} series · ${Math.round(g.share)}% de tu trabajo</span>
      <div class="bp-drivers">${drivers.length?drivers.map(d=>`<em>${gEsc(d.name)}<i>+${pct(d.gain)}</i></em>`).join(''):`<em>${gEsc(g.hint)}</em>`}</div>
    </div>`;
  }

  function stats(model){
    const tiles=[
      {k:'Zona más mejorada',v:model.best?model.best.label:'—',s:model.best?`+${pct(model.best.gain)} sobre tu base`:'aún sin margen medible'},
      {k:'Última mejora',v:model.latest?`+${pct(model.latest.gain)}`:'—',s:model.latest?`${model.latest.name} · ${shortDate(model.latest.at)}`:'esperando tu próxima marca'}
    ];
    return `<div class="bp-stats">${tiles.map(t=>`<div class="bp-stat"><span>${t.k}</span><b>${gEsc(t.v)}</b><small>${gEsc(t.s)}</small></div>`).join('')}</div>`;
  }

  function strip(model){
    const c=model.consistency;
    const title=c.streak>1?`${c.streak} semanas seguidas.`:c.sessions30?'La constancia transforma.':'Empieza tu racha.';
    const sub=c.sessions30?`${c.sessions30} ${c.sessions30===1?'sesión':'sesiones'} en los últimos 30 días.`:'Misma disciplina, un mejor tú.';
    return `<div class="bp-strip">
      <span class="bp-strip-icon" aria-hidden="true">${ICON_BARS}</span>
      <div><b>${title}</b><span>${sub}</span></div>
      <button type="button" class="bp-strip-btn" data-gym-action="tab-history">Ver historial</button>
    </div>`;
  }

  function building(model){
    if(model.hasData||model.pending)return '';
    const line=model.hasAnySets
      ? 'Guarda alguna serie más de cada ejercicio y la silueta empezará a moverse sola.'
      : 'Guarda tus primeras series con peso y repeticiones: esas marcas serán tu punto de partida.';
    return `<div class="bp-building"><b>Aún estamos construyendo tu base</b><span>${line}</span></div>`;
  }

  /* ── Render ────────────────────────────────────────────────────────────── */
  window.renderBody=function(){
    const d=gymState.data;if(!d)return;
    if(!state.rows&&!state.loading)loadProgress();
    const model=buildModel();
    if(state.focus&&!model.groups[state.focus])state.focus=null;
    const last=(d.body||[])[0];
    const a=A();

    g$('gymContent').innerHTML=`<section class="gym-panel active bp-panel">
      <div class="bp-head">
        <div class="bp-head-copy">
          <h2>Tu progreso</h2>
          <p>La silueta crece con tus propias marcas. No te compara con nadie.</p>
        </div>
        ${badge(model)}
      </div>

      <div class="bp-board${state.focus?' is-focused':''}" data-focus="${state.focus||''}">
        <div class="bp-figure-col">
          <div class="bp-global"><b>${model.hasAnySets?`${Math.round(model.overallLevel)}<em>%</em>`:'<i>—</i>'}</b><span>progreso general</span></div>
          <div class="bp-figure-wrap">
            ${arc(model.overallLevel)}
            ${a?figure(model):''}
          </div>
          <div class="bp-motto">Un cuerpo más fuerte cada día</div>
        </div>
        <div class="bp-list-col">
          <div class="bp-list-head"><h3>Progreso muscular</h3><p>Tu esfuerzo, en resultados.</p></div>
          <div class="bp-zones">${a?a.ORDER.map(k=>zoneCard(model.groups[k],state.focus===k)).join(''):''}</div>
        </div>
      </div>

      ${readout(model)}
      ${stats(model)}
      ${strip(model)}
      ${building(model)}

      <div class="bp-note">
        ${ICON_BARS}
        <div><b>Calculado con tus pesos y series</b>
        Cada zona usa la mejora de tu fuerza estimada (e1RM) en los ejercicios que la trabajan y el volumen que le has dedicado. Es una visualización de tu progreso, no una medición de masa muscular.</div>
      </div>

      <details class="bp-weight">
        <summary><b>Peso corporal</b><span>${last?kg(last.weight_kg):'Opcional'} · mostrar</span></summary>
        <div class="gym-body-card">
          <div class="gym-section-head" style="margin:0"><div><h2>Peso corporal</h2><div class="bp-weight-hint">Separado de tus pesos de entrenamiento.</div></div></div>
          <div class="gym-body-input"><input id="gymBodyWeight" type="number" inputmode="decimal" min="20" max="400" step="0.1" placeholder="kg"><button class="gym-button signal" data-gym-action="log-body">Guardar</button></div>
          <div class="gym-body-list">${(d.body||[]).slice(0,8).map(r=>`<div class="gym-body-row"><div><b>${kg(r.weight_kg)}</b><span>${shortDate(r.measured_at)}${r.note?` · ${gEsc(r.note)}`:''}</span></div><button data-gym-action="delete-body" data-id="${gEsc(r.id)}" aria-label="Borrar">×</button></div>`).join('')||'<div class="bp-weight-hint" style="padding:14px 0">Sin registros todavía.</div>'}</div>
        </div>
      </details>
    </section>`;
  };

  /* ── Zone focus ────────────────────────────────────────────────────────── */
  document.addEventListener('click',e=>{
    const hit=e.target.closest?.('[data-bp-zone]');
    if(!hit)return;
    const content=g$('gymContent');
    if(!content||!content.contains(hit))return;
    e.preventDefault();e.stopPropagation();
    const key=hit.dataset.bpZone;
    state.focus=state.focus===key?null:key;
    if(gymState.tab==='body')window.renderBody?.();
  },true);

  /* ── Refresh hooks ─────────────────────────────────────────────────────── */
  const baseLogSet=window.logGymSet;
  if(typeof baseLogSet==='function')window.logGymSet=async function(id,button){
    const out=await baseLogSet(id,button);
    setTimeout(()=>loadProgress(true),250);
    return out;
  };
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&gymState.tab==='body')loadProgress(true);
  });
})();
