/* Editor estructural de rutina.
   Mueve/reordena días y ejercicios conservando los IDs de ejercicio, por lo que
   el historial de series, marcas y PRs sigue apuntando al mismo ejercicio.
   Mientras hay una sesión abierta no se cambia la estructura: gym.js construye el
   entrenamiento activo desde la rutina viva y mutarla a mitad de sesión sería
   sorprendente y podría ocultar ejercicios ya empezados. */
import "@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN="https://proyecto-mind-demo.vercel.app";
const sql=postgres(Deno.env.get("SUPABASE_DB_URL")!,{prepare:false,max:1});
const cors=(_origin:string|null)=>({
  "Access-Control-Allow-Origin":ORIGIN,
  "Access-Control-Allow-Headers":"authorization, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Vary":"Origin",
});
const json=(data:unknown,status=200,origin:string|null=null)=>new Response(JSON.stringify(data),{status,headers:{...cors(origin),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
async function sha256Hex(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function auth(req:Request){
  const h=req.headers.get("authorization")||"",token=h.toLowerCase().startsWith("bearer ")?h.slice(7).trim():"";
  if(!token||token.length<24)return null;
  const hash=await sha256Hex(token);
  const rows=await sql`select id from public.mind_device_sessions where token_hash=${hash} and revoked_at is null limit 1`;
  if(!rows.length)return null;
  await sql`update public.mind_device_sessions set last_seen_at=now() where id=${rows[0].id}`;
  return rows[0];
}
const text=(v:unknown,max=80)=>String(v??"").trim().slice(0,max);
const ids=(v:unknown)=>Array.isArray(v)?v.map(x=>text(x,60)).filter(Boolean):[];

async function routineId(){const r=await sql`select id from public.gym_routines where is_active=true order by created_at limit 1`;return r[0]?.id||null}
async function locked(){const r=await sql`select id from public.gym_sessions where finished_at is null limit 1`;return !!r.length}
async function normalizeDay(dayId:string){
  const rows=await sql`select id from public.gym_exercises where day_id=${dayId}::uuid order by position,created_at,id`;
  for(let i=0;i<rows.length;i++)await sql`update public.gym_exercises set position=${i},updated_at=now() where id=${rows[i].id}`;
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
  if(origin&&origin!==ORIGIN)return json({ok:false,error:"origin_not_allowed"},403,origin);
  if(!(await auth(req)))return json({ok:false,error:"unauthorized"},401,origin);
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405,origin);
  try{
    const body=await req.json().catch(()=>({})),action=String(body.action||"");
    const routine=await routineId();if(!routine)return json({ok:false,error:"routine_not_found"},404,origin);
    if(await locked())return json({ok:false,error:"active_session_locked"},409,origin);

    if(action==="move_exercise"){
      const exerciseId=text(body.exerciseId,60),targetDayId=text(body.targetDayId,60);
      if(!exerciseId||!targetDayId)return json({ok:false,error:"exercise_and_day_required"},400,origin);
      const row=await sql`select e.id,e.day_id from public.gym_exercises e join public.gym_days d on d.id=e.day_id where e.id=${exerciseId}::uuid and d.routine_id=${routine} limit 1`;
      const target=await sql`select id from public.gym_days where id=${targetDayId}::uuid and routine_id=${routine} limit 1`;
      if(!row.length)return json({ok:false,error:"exercise_not_found"},404,origin);
      if(!target.length)return json({ok:false,error:"day_not_found"},404,origin);
      const sourceDay=String(row[0].day_id);
      if(sourceDay!==targetDayId){
        const p=await sql`select coalesce(max(position),-1)+1 as p from public.gym_exercises where day_id=${targetDayId}::uuid`;
        await sql`update public.gym_exercises set day_id=${targetDayId}::uuid,position=${Number(p[0]?.p||0)},updated_at=now() where id=${exerciseId}::uuid`;
        await normalizeDay(sourceDay);await normalizeDay(targetDayId);
      }
    }else if(action==="reorder_exercises"){
      const dayId=text(body.dayId,60),ordered=ids(body.ids);
      const day=await sql`select id from public.gym_days where id=${dayId}::uuid and routine_id=${routine} limit 1`;if(!day.length)return json({ok:false,error:"day_not_found"},404,origin);
      const current=await sql`select id from public.gym_exercises where day_id=${dayId}::uuid order by position,created_at,id`;
      const have=current.map((r:any)=>String(r.id)).sort(),want=[...ordered].sort();
      if(have.length!==want.length||new Set(ordered).size!==ordered.length||have.some((x:any,i:number)=>x!==want[i]))return json({ok:false,error:"invalid_exercise_order"},400,origin);
      for(let i=0;i<ordered.length;i++)await sql`update public.gym_exercises set position=${i},updated_at=now() where id=${ordered[i]}::uuid and day_id=${dayId}::uuid`;
    }else if(action==="reorder_days"){
      const ordered=ids(body.ids),current=await sql`select id from public.gym_days where routine_id=${routine} order by position,created_at,id`;
      const have=current.map((r:any)=>String(r.id)).sort(),want=[...ordered].sort();
      if(have.length!==want.length||new Set(ordered).size!==ordered.length||have.some((x:any,i:number)=>x!==want[i]))return json({ok:false,error:"invalid_day_order"},400,origin);
      for(let i=0;i<ordered.length;i++)await sql`update public.gym_days set position=${i},updated_at=now() where id=${ordered[i]}::uuid and routine_id=${routine}`;
    }else return json({ok:false,error:"unknown_action"},400,origin);
    return json({ok:true},200,origin);
  }catch(err){console.error("gym-layout",err);const detail=err instanceof Error?err.message:String(err);return json({ok:false,error:"internal_error",detail:detail.slice(0,180)},500,origin)}
});
