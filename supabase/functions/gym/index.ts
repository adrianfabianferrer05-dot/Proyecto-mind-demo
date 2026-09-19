/* Gym: rutina, dias, ejercicios, sesiones, series y peso corporal. Todo el modulo de
   entrenamiento pasa por aqui.

   Recuperado del despliegue: estaba en produccion sin una linea de codigo en el
   repositorio. Se copia tal cual esta en el servidor, sin cambiar nada, para que
   exista, se pueda leer y se pueda comprobar con `npm run typecheck`. La copia no se
   ha vuelto a desplegar: lo que corre en produccion sigue siendo la version 2. */
import "@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN="https://proyecto-mind-demo.vercel.app";
const sql=postgres(Deno.env.get("SUPABASE_DB_URL")!,{prepare:false,max:1});
const cors=(_origin:string|null)=>({
  "Access-Control-Allow-Origin":ORIGIN,
  "Access-Control-Allow-Headers":"authorization, content-type",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
  "Vary":"Origin",
});
const json=(data:unknown,status=200,origin:string|null=null)=>new Response(JSON.stringify(data),{status,headers:{...cors(origin),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});

async function sha256Hex(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function auth(req:Request){
  const h=req.headers.get("authorization")||"",token=h.toLowerCase().startsWith("bearer ")?h.slice(7).trim():"";
  if(!token||token.length<24)return null;
  const hash=await sha256Hex(token);
  const rows=await sql`select id,label from public.mind_device_sessions where token_hash=${hash} and revoked_at is null limit 1`;
  if(!rows.length)return null;
  await sql`update public.mind_device_sessions set last_seen_at=now() where id=${rows[0].id}`;
  return rows[0];
}
const text=(v:unknown,max=120)=>String(v??"").trim().replace(/\s+/g," ").slice(0,max);
const num=(v:unknown,fallback:number|null=null)=>{if(v===null||v===undefined||v==='')return fallback;const n=Number(v);return Number.isFinite(n)?n:fallback};
const bool=(v:unknown)=>v===true||v==="true";

async function ensureRoutine(){
  let r=await sql`select id,name,is_active,created_at,updated_at from public.gym_routines where is_active=true order by created_at limit 1`;
  if(!r.length)r=await sql`insert into public.gym_routines(name,is_active) values('Mi rutina',true) returning id,name,is_active,created_at,updated_at`;
  return r[0];
}
async function payload(){
  const routine=await ensureRoutine();
  const days=await sql`select id,routine_id,name,position,notes,created_at,updated_at from public.gym_days where routine_id=${routine.id} order by position,name`;
  const dayIds=days.map((d:any)=>d.id);
  const exercises=dayIds.length?await sql`select id,day_id,name,position,target_sets,rep_min,rep_max,rest_seconds,increment_kg,notes,planned_weight_kg,working_weight_kg,created_at,updated_at from public.gym_exercises where day_id in ${sql(dayIds)} order by day_id,position,name`:[];
  const activeRows=await sql`select id,day_id,day_name_snapshot,started_at,finished_at,bodyweight_kg,notes from public.gym_sessions where finished_at is null order by started_at desc limit 1`;
  const activeSession=activeRows[0]||null;
  const activeSets=activeSession?await sql`select id,session_id,exercise_id,exercise_name_snapshot,set_number,weight_kg,reps,rpe,is_warmup,completed_at from public.gym_sets where session_id=${activeSession.id} order by completed_at,set_number`:[];
  const history=await sql`
    select s.id,s.day_id,s.day_name_snapshot,s.started_at,s.finished_at,s.bodyweight_kg,s.notes,
      count(gs.id)::int as set_count,
      coalesce(sum(case when not gs.is_warmup then gs.weight_kg*gs.reps else 0 end),0)::numeric as volume_kg
    from public.gym_sessions s left join public.gym_sets gs on gs.session_id=s.id
    where s.finished_at is not null
    group by s.id order by s.started_at desc limit 24`;
  const recentSets=await sql`
    select distinct on (gs.exercise_id) gs.exercise_id,gs.exercise_name_snapshot,gs.weight_kg,gs.reps,gs.rpe,gs.completed_at
    from public.gym_sets gs join public.gym_sessions s on s.id=gs.session_id
    where gs.exercise_id is not null and s.finished_at is not null and not gs.is_warmup
    order by gs.exercise_id,gs.completed_at desc`;
  const bests=await sql`
    select exercise_id,max(weight_kg*(1+(reps::numeric/30)))::numeric(10,2) as best_e1rm,max(weight_kg)::numeric(10,2) as max_weight
    from public.gym_sets where exercise_id is not null and not is_warmup and reps>0 group by exercise_id`;
  const body=await sql`select id,measured_at,weight_kg,note from public.gym_body_log order by measured_at desc limit 30`;
  const statsRows=await sql`
    select
      count(*) filter(where finished_at is not null and started_at>=date_trunc('month',now()))::int as sessions_month,
      count(*) filter(where finished_at is not null and started_at>=now()-interval '30 days')::int as sessions_30d
    from public.gym_sessions`;
  return {routine,days,exercises,activeSession,activeSets,history,recentSets,bests,body,stats:statsRows[0]||{sessions_month:0,sessions_30d:0}};
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
  if(origin&&origin!==ORIGIN)return json({ok:false,error:"origin_not_allowed"},403,origin);
  const device=await auth(req);if(!device)return json({ok:false,error:"unauthorized"},401,origin);
  try{
    if(req.method==="GET")return json({ok:true,...await payload()},200,origin);
    if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405,origin);
    const body=await req.json().catch(()=>({})),action=String(body.action||"");
    const routine=await ensureRoutine();

    if(action==="rename_routine"){
      const name=text(body.name,60);if(!name)return json({ok:false,error:"name_required"},400,origin);
      await sql`update public.gym_routines set name=${name},updated_at=now() where id=${routine.id}`;
    }else if(action==="save_day"){
      const name=text(body.name,70),notes=text(body.notes,800)||null;if(!name)return json({ok:false,error:"name_required"},400,origin);
      const id=text(body.id,60);
      if(id){await sql`update public.gym_days set name=${name},notes=${notes},updated_at=now() where id=${id}::uuid and routine_id=${routine.id}`}
      else{const p=await sql`select coalesce(max(position),-1)+1 as p from public.gym_days where routine_id=${routine.id}`;await sql`insert into public.gym_days(routine_id,name,position,notes) values(${routine.id},${name},${Number(p[0]?.p||0)},${notes})`}
    }else if(action==="delete_day"){
      const id=text(body.id,60);if(!id)return json({ok:false,error:"id_required"},400,origin);
      const open=await sql`select 1 from public.gym_sessions where day_id=${id}::uuid and finished_at is null limit 1`;if(open.length)return json({ok:false,error:"day_has_active_session"},409,origin);
      await sql`delete from public.gym_days where id=${id}::uuid and routine_id=${routine.id}`;
    }else if(action==="duplicate_day"){
      const id=text(body.id,60),src=await sql`select * from public.gym_days where id=${id}::uuid and routine_id=${routine.id} limit 1`;if(!src.length)return json({ok:false,error:"day_not_found"},404,origin);
      const p=await sql`select coalesce(max(position),-1)+1 as p from public.gym_days where routine_id=${routine.id}`;
      const nd=await sql`insert into public.gym_days(routine_id,name,position,notes) values(${routine.id},${`${src[0].name} copia`.slice(0,70)},${Number(p[0]?.p||0)},${src[0].notes}) returning id`;
      const ex=await sql`select * from public.gym_exercises where day_id=${id}::uuid order by position`;
      for(const e of ex)await sql`insert into public.gym_exercises(day_id,name,position,target_sets,rep_min,rep_max,rest_seconds,increment_kg,notes,planned_weight_kg,working_weight_kg) values(${nd[0].id},${e.name},${e.position},${e.target_sets},${e.rep_min},${e.rep_max},${e.rest_seconds},${e.increment_kg},${e.notes},${e.planned_weight_kg??null},${e.working_weight_kg??e.planned_weight_kg??null})`;
    }else if(action==="save_exercise"){
      const dayId=text(body.dayId,60),name=text(body.name,90);if(!dayId||!name)return json({ok:false,error:"day_and_name_required"},400,origin);
      const day=await sql`select id from public.gym_days where id=${dayId}::uuid and routine_id=${routine.id} limit 1`;if(!day.length)return json({ok:false,error:"day_not_found"},404,origin);
      const targetSets=Math.min(12,Math.max(1,Math.round(num(body.targetSets,3)!))),repMin=Math.min(100,Math.max(1,Math.round(num(body.repMin,6)!))),repMax=Math.min(100,Math.max(repMin,Math.round(num(body.repMax,12)!))),restSeconds=Math.min(1200,Math.max(0,Math.round(num(body.restSeconds,120)!))),incrementKg=Math.min(100,Math.max(.25,num(body.incrementKg,2.5)!)),notes=text(body.notes,800)||null,id=text(body.id,60);
      const plannedRaw=num(body.plannedWeightKg??body.workingWeightKg,null),plannedWeightKg=plannedRaw===null?null:Math.min(1000,Math.max(0,plannedRaw));
      if(id)await sql`update public.gym_exercises set name=${name},target_sets=${targetSets},rep_min=${repMin},rep_max=${repMax},rest_seconds=${restSeconds},increment_kg=${incrementKg},notes=${notes},planned_weight_kg=${plannedWeightKg},working_weight_kg=${plannedWeightKg},updated_at=now() where id=${id}::uuid and day_id=${dayId}::uuid`;
      else{const p=await sql`select coalesce(max(position),-1)+1 as p from public.gym_exercises where day_id=${dayId}::uuid`;await sql`insert into public.gym_exercises(day_id,name,position,target_sets,rep_min,rep_max,rest_seconds,increment_kg,notes,planned_weight_kg,working_weight_kg) values(${dayId}::uuid,${name},${Number(p[0]?.p||0)},${targetSets},${repMin},${repMax},${restSeconds},${incrementKg},${notes},${plannedWeightKg},${plannedWeightKg})`}
    }else if(action==="delete_exercise"){
      const id=text(body.id,60);if(!id)return json({ok:false,error:"id_required"},400,origin);
      await sql`delete from public.gym_exercises e using public.gym_days d where e.id=${id}::uuid and e.day_id=d.id and d.routine_id=${routine.id}`;
    }else if(action==="reorder_exercises"){
      const ids=Array.isArray(body.ids)?body.ids.map((x:any)=>text(x,60)).filter(Boolean).slice(0,80):[];
      for(let i=0;i<ids.length;i++)await sql`update public.gym_exercises set position=${i},updated_at=now() where id=${ids[i]}::uuid and day_id in (select id from public.gym_days where routine_id=${routine.id})`;
    }else if(action==="start_session"){
      const open=await sql`select id from public.gym_sessions where finished_at is null order by started_at desc limit 1`;if(open.length)return json({ok:true,activeSessionId:open[0].id,...await payload()},200,origin);
      const dayId=text(body.dayId,60),day=await sql`select id,name from public.gym_days where id=${dayId}::uuid and routine_id=${routine.id} limit 1`;if(!day.length)return json({ok:false,error:"day_not_found"},404,origin);
      const bw=num(body.bodyweightKg,null),rows=await sql`insert into public.gym_sessions(day_id,day_name_snapshot,bodyweight_kg) values(${dayId}::uuid,${day[0].name},${bw}) returning id`;
      return json({ok:true,activeSessionId:rows[0].id,...await payload()},201,origin);
    }else if(action==="log_set"){
      const sessionId=text(body.sessionId,60),exerciseId=text(body.exerciseId,60),session=await sql`select id from public.gym_sessions where id=${sessionId}::uuid and finished_at is null limit 1`;if(!session.length)return json({ok:false,error:"session_not_open"},409,origin);
      const exercise=await sql`select e.id,e.name from public.gym_exercises e join public.gym_days d on d.id=e.day_id where e.id=${exerciseId}::uuid and d.routine_id=${routine.id} limit 1`;if(!exercise.length)return json({ok:false,error:"exercise_not_found"},404,origin);
      const weight=Math.max(0,num(body.weightKg,0)!),reps=Math.min(200,Math.max(0,Math.round(num(body.reps,0)!))),rpeRaw=num(body.rpe,null),rpe=rpeRaw===null?null:Math.min(10,Math.max(1,rpeRaw)),warmup=bool(body.isWarmup);
      const n=await sql`select coalesce(max(set_number),0)+1 as n from public.gym_sets where session_id=${sessionId}::uuid and exercise_id=${exerciseId}::uuid`;
      const prev=await sql`select max(weight_kg*(1+(reps::numeric/30))) as best from public.gym_sets where exercise_id=${exerciseId}::uuid and not is_warmup and reps>0`;
      const estimate=weight*(1+reps/30),isPr=!warmup&&weight>0&&reps>0&&estimate>Number(prev[0]?.best||0)+.01;
      const rows=await sql`insert into public.gym_sets(session_id,exercise_id,exercise_name_snapshot,set_number,weight_kg,reps,rpe,is_warmup) values(${sessionId}::uuid,${exerciseId}::uuid,${exercise[0].name},${Number(n[0]?.n||1)},${weight},${reps},${rpe},${warmup}) returning *`;
      return json({ok:true,set:rows[0],isPr,...await payload()},201,origin);
    }else if(action==="update_set"){
      const id=text(body.id,60),weight=Math.max(0,num(body.weightKg,0)!),reps=Math.min(200,Math.max(0,Math.round(num(body.reps,0)!))),rpeRaw=num(body.rpe,null),rpe=rpeRaw===null?null:Math.min(10,Math.max(1,rpeRaw)),warmup=bool(body.isWarmup);
      await sql`update public.gym_sets gs set weight_kg=${weight},reps=${reps},rpe=${rpe},is_warmup=${warmup} where gs.id=${id}::uuid and exists(select 1 from public.gym_sessions s where s.id=gs.session_id and s.finished_at is null)`;
    }else if(action==="delete_set"){
      const id=text(body.id,60);await sql`delete from public.gym_sets gs where gs.id=${id}::uuid and exists(select 1 from public.gym_sessions s where s.id=gs.session_id and s.finished_at is null)`;
    }else if(action==="finish_session"){
      const id=text(body.sessionId,60),notes=text(body.notes,1000)||null;await sql`update public.gym_sessions set finished_at=now(),notes=${notes},updated_at=now() where id=${id}::uuid and finished_at is null`;
    }else if(action==="cancel_session"){
      const id=text(body.sessionId,60);await sql`delete from public.gym_sessions where id=${id}::uuid and finished_at is null`;
    }else if(action==="log_bodyweight"){
      const weight=num(body.weightKg,null);if(weight===null||weight<20||weight>400)return json({ok:false,error:"invalid_weight"},400,origin);await sql`insert into public.gym_body_log(weight_kg,note) values(${weight},${text(body.note,300)||null})`;
    }else if(action==="delete_bodyweight"){
      const id=text(body.id,60);await sql`delete from public.gym_body_log where id=${id}::uuid`;
    }else return json({ok:false,error:"unknown_action"},400,origin);

    return json({ok:true,...await payload()},200,origin);
  }catch(err){console.error("gym",err);const detail=err instanceof Error?err.message:String(err);return json({ok:false,error:"internal_error",detail:detail.slice(0,180)},500,origin)}
});
