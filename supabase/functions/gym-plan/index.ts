/* NOTA (recuperado del despliegue, no lo llama nadie).

   Esta funcion estaba desplegada en produccion sin codigo en el repositorio: si se
   perdia, se perdia entera. Se recupera tal cual esta en el servidor, sin tocar una
   linea, para que exista y se pueda revisar.

   El cliente actual NO la usa: el peso de trabajo se guarda con `save_exercise` en
   la funcion `gym`. O se borra del proyecto, o se vuelve a conectar; mientras siga
   desplegada es un endpoint vivo que nadie mira. */
import "@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN="https://proyecto-mind-demo.vercel.app";
const sql=postgres(Deno.env.get("SUPABASE_DB_URL")!,{prepare:false,max:1});
const cors={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Vary":"Origin"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
async function sha256Hex(v:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function auth(req:Request){const h=req.headers.get("authorization")||"",token=h.toLowerCase().startsWith("bearer ")?h.slice(7).trim():"";if(!token||token.length<24)return null;const hash=await sha256Hex(token);const rows=await sql`select id from public.mind_device_sessions where token_hash=${hash} and revoked_at is null limit 1`;if(!rows.length)return null;await sql`update public.mind_device_sessions set last_seen_at=now() where id=${rows[0].id}`;return rows[0]}
const n=(v:unknown)=>{if(v===null||v===undefined||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null};

async function progress(){
  const rows=await sql`
    select e.id as exercise_id,e.day_id,e.name,e.position,e.target_sets,e.rep_min,e.rep_max,e.increment_kg,e.planned_weight_kg,
      lastset.weight_kg as last_weight_kg,lastset.reps as last_reps,lastset.completed_at as last_completed_at,
      best.max_weight,best.best_e1rm
    from public.gym_exercises e
    join public.gym_days d on d.id=e.day_id
    join public.gym_routines r on r.id=d.routine_id and r.is_active=true
    left join lateral (
      select gs.weight_kg,gs.reps,gs.completed_at from public.gym_sets gs
      join public.gym_sessions s on s.id=gs.session_id
      where gs.exercise_id=e.id and s.finished_at is not null and not gs.is_warmup
      order by gs.completed_at desc limit 1
    ) lastset on true
    left join lateral (
      select max(gs.weight_kg)::numeric(10,2) as max_weight,max(gs.weight_kg*(1+(gs.reps::numeric/30)))::numeric(10,2) as best_e1rm
      from public.gym_sets gs where gs.exercise_id=e.id and not gs.is_warmup and gs.reps>0
    ) best on true
    order by d.position,e.position,e.name`;
  return rows;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const origin=req.headers.get("origin");if(origin&&origin!==ORIGIN)return json({ok:false,error:"origin_not_allowed"},403);
  if(!await auth(req))return json({ok:false,error:"unauthorized"},401);
  try{
    if(req.method==="GET")return json({ok:true,progress:await progress()});
    if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
    const body=await req.json().catch(()=>({}));
    if(String(body.action||"")!=="set_planned_weight")return json({ok:false,error:"unknown_action"},400);
    const id=String(body.exerciseId||"");if(!id)return json({ok:false,error:"exercise_required"},400);
    const weight=n(body.plannedWeightKg);if(weight!==null&&(weight<0||weight>1000))return json({ok:false,error:"invalid_weight"},400);
    const rows=await sql`
      update public.gym_exercises e set planned_weight_kg=${weight}
      where e.id=${id}::uuid and exists(
        select 1 from public.gym_days d join public.gym_routines r on r.id=d.routine_id
        where d.id=e.day_id and r.is_active=true
      ) returning e.id,e.planned_weight_kg`;
    if(!rows.length)return json({ok:false,error:"exercise_not_found"},404);
    return json({ok:true,exercise:rows[0],progress:await progress()});
  }catch(err){console.error("gym-plan",err);return json({ok:false,error:"internal_error",detail:(err instanceof Error?err.message:String(err)).slice(0,180)},500)}
});
