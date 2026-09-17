import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN="https://proyecto-mind-demo.vercel.app";
const DB_URL=Deno.env.get("SUPABASE_DB_URL")!;
const sql=postgres(DB_URL,{prepare:false,max:1});
const ID_NAME="segunda_mente_gocardless_secret_id";
const KEY_NAME="segunda_mente_gocardless_secret_key";
const REFRESH_NAME="segunda_mente_gocardless_refresh_token";

const cors={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Vary":"Origin"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
async function sha256Hex(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function auth(req:Request){const h=req.headers.get("authorization")||"";const token=h.toLowerCase().startsWith("bearer ")?h.slice(7).trim():"";if(!token||token.length<24)return null;const hash=await sha256Hex(token);const rows=await sql`select id,label from public.mind_device_sessions where token_hash=${hash} and revoked_at is null limit 1`;if(!rows.length)return null;await sql`update public.mind_device_sessions set last_seen_at=now() where id=${rows[0].id}`;return rows[0]}
async function hasSecret(name:string){const r=await sql`select id from vault.decrypted_secrets where name=${name} and decrypted_secret is not null and length(decrypted_secret)>0 limit 1`;return !!r.length}
async function storeSecret(name:string,value:string,description:string){const r=await sql`select id from vault.decrypted_secrets where name=${name} limit 1`;if(r.length){await sql`select vault.update_secret(${r[0].id}::uuid,${value},${name},${description})`}else{await sql`select vault.create_secret(${value},${name},${description})`}}
async function validate(secretId:string,secretKey:string){
  const r=await fetch("https://bankaccountdata.gocardless.com/api/v2/token/new/",{method:"POST",headers:{"accept":"application/json","Content-Type":"application/json"},body:JSON.stringify({secret_id:secretId,secret_key:secretKey})});
  const out=await r.json().catch(()=>({}));
  if(!r.ok)return {ok:false,status:r.status,message:String(out?.detail||out?.summary||"GoCardless rechazó esas credenciales.").slice(0,240)};
  return {ok:true,refresh:String(out.refresh||"")};
}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const origin=req.headers.get("origin");if(origin&&origin!==ORIGIN)return json({ok:false,error:"origin_not_allowed"},403);
  const device=await auth(req);if(!device)return json({ok:false,error:"unauthorized"},401);
  try{
    if(req.method==="GET")return json({ok:true,enabled:(await hasSecret(ID_NAME))&&(await hasSecret(KEY_NAME))});
    if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
    const body=await req.json().catch(()=>({}));if(String(body.action||"set")!=="set")return json({ok:false,error:"unknown_action"},400);
    const secretId=String(body.secretId||"").trim(),secretKey=String(body.secretKey||"").trim();
    if(secretId.length<8||secretId.length>256||secretKey.length<8||secretKey.length>512||/\s/.test(secretId)||/\s/.test(secretKey))return json({ok:false,error:"invalid_credentials",detail:"Revisa Secret ID y Secret Key."},400);
    const check=await validate(secretId,secretKey);if(!check.ok)return json({ok:false,error:"gocardless_rejected",detail:check.message},check.status===429?429:400);
    await storeSecret(ID_NAME,secretId,"GoCardless Bank Account Data Secret ID for Segunda Mente");
    await storeSecret(KEY_NAME,secretKey,"GoCardless Bank Account Data Secret Key for Segunda Mente");
    if(check.refresh)await storeSecret(REFRESH_NAME,check.refresh,"GoCardless Bank Account Data refresh token for Segunda Mente");
    return json({ok:true,enabled:true});
  }catch(e){console.error("bank-config",e instanceof Error?e.message:String(e));return json({ok:false,error:"internal_error"},500)}
});