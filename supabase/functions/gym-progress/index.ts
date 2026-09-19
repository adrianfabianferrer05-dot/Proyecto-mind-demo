/* Progreso por ejercicio: de donde partiste, hasta donde has llegado y cuanto has
   movido. Es la fuente del panel del cuerpo, asi que lo que sale de aqui decide que
   musculo se enciende y cuanto.

   Recuperado del despliegue: estaba en produccion sin codigo en el repositorio. Se
   copia tal cual estaba en el servidor, sin cambiar una linea. */
import "@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN="https://proyecto-mind-demo.vercel.app";
const sql=postgres(Deno.env.get("SUPABASE_DB_URL")!,{prepare:false,max:1});
const cors=()=>({
  "Access-Control-Allow-Origin":ORIGIN,
  "Access-Control-Allow-Headers":"authorization, content-type",
  "Access-Control-Allow-Methods":"GET, OPTIONS",
  "Vary":"Origin",
});
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors(),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
async function sha256Hex(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function auth(req:Request){
  const h=req.headers.get("authorization")||"",token=h.toLowerCase().startsWith("bearer ")?h.slice(7).trim():"";
  if(!token||token.length<24)return false;
  const hash=await sha256Hex(token);
  const rows=await sql`select id from public.mind_device_sessions where token_hash=${hash} and revoked_at is null limit 1`;
  if(!rows.length)return false;
  await sql`update public.mind_device_sessions set last_seen_at=now() where id=${rows[0].id}`;
  return true;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors()});
  const origin=req.headers.get("origin");
  if(origin&&origin!==ORIGIN)return json({ok:false,error:"origin_not_allowed"},403);
  if(req.method!=="GET")return json({ok:false,error:"method_not_allowed"},405);
  if(!await auth(req))return json({ok:false,error:"unauthorized"},401);
  try{
    const rows=await sql`
      with perf as (
        select gs.exercise_id, gs.completed_at,
          (gs.weight_kg*(1+(gs.reps::numeric/30)))::numeric as e1rm,
          (gs.weight_kg*gs.reps)::numeric as volume
        from public.gym_sets gs
        where gs.exercise_id is not null and not gs.is_warmup and gs.reps>0 and gs.weight_kg>0
      )
      select p.exercise_id,
        (array_agg(p.e1rm order by p.completed_at asc))[1]::numeric(10,2) as baseline_e1rm,
        max(p.e1rm)::numeric(10,2) as best_e1rm,
        min(p.completed_at) as first_at,
        max(p.completed_at) as last_at,
        count(*)::int as set_count,
        sum(p.volume)::numeric(12,2) as total_volume
      from perf p
      group by p.exercise_id
      order by max(p.completed_at) desc`;
    return json({ok:true,rows});
  }catch(err){console.error("gym-progress",err);return json({ok:false,error:"internal_error"},500)}
});
