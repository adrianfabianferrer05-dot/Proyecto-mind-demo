import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN="https://proyecto-mind-demo.vercel.app";
const DB_URL=Deno.env.get("SUPABASE_DB_URL")!;
const sql=postgres(DB_URL,{prepare:false,max:1});
const APP_ID_NAME="segunda_mente_enablebanking_app_id";
const KEY_NAME="segunda_mente_enablebanking_private_key";
const BASE="https://api.enablebanking.com";

const cors={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Vary":"Origin"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
async function sha256Hex(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function auth(req:Request){const h=req.headers.get("authorization")||"";const token=h.toLowerCase().startsWith("bearer ")?h.slice(7).trim():"";if(!token||token.length<24)return null;const hash=await sha256Hex(token);const rows=await sql`select id,label from public.mind_device_sessions where token_hash=${hash} and revoked_at is null limit 1`;if(!rows.length)return null;await sql`update public.mind_device_sessions set last_seen_at=now() where id=${rows[0].id}`;return rows[0]}
async function secret(name:string){const r=await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} and decrypted_secret is not null limit 1`;return r[0]?.decrypted_secret||null}
async function hasSecret(name:string){return !!(await secret(name))}
async function storeSecret(name:string,value:string,description:string){const r=await sql`select id from vault.decrypted_secrets where name=${name} limit 1`;if(r.length)await sql`select vault.update_secret(${r[0].id}::uuid,${value},${name},${description})`;else await sql`select vault.create_secret(${value},${name},${description})`}
function b64u(data:Uint8Array|string){const bytes=typeof data==="string"?new TextEncoder().encode(data):data;let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}
function pemToDer(pem:string){const m=pem.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);if(!m)throw new Error("El archivo no parece una private key PKCS#8 válida.");const b64=m[1].replace(/\s/g,"");const bin=atob(b64);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
async function jwt(appId:string,pem:string){const key=await crypto.subtle.importKey("pkcs8",pemToDer(pem),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);const now=Math.floor(Date.now()/1000);const header=b64u(JSON.stringify({typ:"JWT",alg:"RS256",kid:appId}));const body=b64u(JSON.stringify({iss:"enablebanking.com",aud:"api.enablebanking.com",iat:now,exp:now+3600}));const input=`${header}.${body}`;const sig=new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(input)));return `${input}.${b64u(sig)}`}
async function validate(appId:string,pem:string){const token=await jwt(appId,pem);const r=await fetch(BASE+"/aspsps?country=ES",{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});const out=await r.json().catch(()=>({}));if(!r.ok){const detail=String(out?.detail||out?.message||out?.error||("Enable Banking rechazó la configuración ("+r.status+")")).slice(0,220);throw new Error(r.status===403?"La aplicación de Enable Banking sigue Inactive. Actívala enlazando tu cuenta y vuelve a intentarlo.":detail)}const list=Array.isArray(out?.aspsps)?out.aspsps:[];return {count:list.length,cajamar:list.filter((x:any)=>/cajamar/i.test(String(x?.name||""))).map((x:any)=>({name:x.name,country:x.country||"ES"}))}}
Deno.serve(async(req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const origin=req.headers.get("origin");if(origin&&origin!==ORIGIN)return json({ok:false,error:"origin_not_allowed"},403);
  const device=await auth(req);if(!device)return json({ok:false,error:"unauthorized"},401);
  try{
    if(req.method==="GET")return json({ok:true,enabled:(await hasSecret(APP_ID_NAME))&&(await hasSecret(KEY_NAME)),provider:"enablebanking"});
    if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
    const body=await req.json().catch(()=>({})),action=String(body.action||"set");
    if(action!=="set")return json({ok:false,error:"unknown_action"},400);
    const appId=String(body.appId||"").trim(),privateKey=String(body.privateKey||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId))return json({ok:false,error:"invalid_app_id",detail:"Revisa el Application ID de Enable Banking."},400);
    if(privateKey.length<800||privateKey.length>12000||!privateKey.includes("PRIVATE KEY"))return json({ok:false,error:"invalid_private_key",detail:"Selecciona el archivo .pem que descargó Enable Banking."},400);
    const check=await validate(appId,privateKey);
    await storeSecret(APP_ID_NAME,appId,"Enable Banking application ID for Segunda Mente");
    await storeSecret(KEY_NAME,privateKey,"Enable Banking private RSA key for Segunda Mente");
    return json({ok:true,enabled:true,provider:"enablebanking",aspsps:check.count,cajamar:check.cajamar});
  }catch(e){console.error("bank-config",e instanceof Error?e.message:String(e));return json({ok:false,error:"enablebanking_rejected",detail:e instanceof Error?e.message:"No pude validar Enable Banking"},400)}
}));