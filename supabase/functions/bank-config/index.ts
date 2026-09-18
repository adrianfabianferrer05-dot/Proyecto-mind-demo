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
function normalizePem(input:string){
  let pem=String(input||"").replace(/^\uFEFF/,"").trim();
  if((pem.startsWith('"')&&pem.endsWith('"'))||(pem.startsWith("'")&&pem.endsWith("'"))){
    try{pem=JSON.parse(pem)}catch{}
  }
  pem=String(pem).replace(/\\r\\n/g,"\n").replace(/\\n/g,"\n").replace(/\r\n/g,"\n").trim();
  return pem;
}
function derLen(n:number){if(n<128)return new Uint8Array([n]);const a=[];while(n){a.unshift(n&255);n>>>=8}return new Uint8Array([0x80|a.length,...a])}
function concat(...parts:Uint8Array[]){const n=parts.reduce((s,p)=>s+p.length,0),out=new Uint8Array(n);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}
function seq(...parts:Uint8Array[]){const body=concat(...parts);return concat(new Uint8Array([0x30]),derLen(body.length),body)}
function octet(body:Uint8Array){return concat(new Uint8Array([0x04]),derLen(body.length),body)}
function pkcs1ToPkcs8(pkcs1:Uint8Array){
  const version=new Uint8Array([0x02,0x01,0x00]);
  const rsaAlg=new Uint8Array([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00]);
  return seq(version,rsaAlg,octet(pkcs1));
}
function decodeB64(b64:string){const bin=atob(b64.replace(/\s/g,""));const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
function pemToDer(raw:string){
  const pem=normalizePem(raw);
  const p8=pem.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
  if(p8)return decodeB64(p8[1]);
  const p1=pem.match(/-----BEGIN RSA PRIVATE KEY-----([\s\S]+?)-----END RSA PRIVATE KEY-----/);
  if(p1)return pkcs1ToPkcs8(decodeB64(p1[1]));
  throw new Error("El archivo no contiene una clave PEM válida (PRIVATE KEY o RSA PRIVATE KEY).");
}
async function jwt(appId:string,pem:string){const key=await crypto.subtle.importKey("pkcs8",pemToDer(pem),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);const now=Math.floor(Date.now()/1000);const header=b64u(JSON.stringify({typ:"JWT",alg:"RS256",kid:appId}));const body=b64u(JSON.stringify({iss:"enablebanking.com",aud:"api.enablebanking.com",iat:now,exp:now+3600}));const input=`${header}.${body}`;const sig=new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(input)));return `${input}.${b64u(sig)}`}
async function validate(appId:string,pem:string){
  let token="";
  try{token=await jwt(appId,pem)}catch(e){throw new Error("No pude leer/firmar con la private key: "+(e instanceof Error?e.message:String(e)))}
  let r:Response;
  try{r=await fetch(BASE+"/application",{headers:{Authorization:"Bearer "+token,Accept:"application/json"}})}
  catch(e){throw new Error("No pude contactar con Enable Banking: "+(e instanceof Error?e.message:String(e)))}
  const out=await r.json().catch(()=>({}));
  if(!r.ok){
    const detail=String(out?.detail||out?.message||out?.error||("HTTP "+r.status)).slice(0,220);
    if(r.status===403)throw new Error("Enable Banking devuelve 403. La app puede seguir Inactive o la cuenta vinculada no ha activado el acceso.");
    if(r.status===401)throw new Error("Enable Banking no acepta esta pareja Application ID + private key.");
    throw new Error("Enable Banking rechazó la validación ("+r.status+"): "+detail);
  }
  if(out?.kid&&String(out.kid).toLowerCase()!==appId.toLowerCase())throw new Error("La private key no corresponde a este Application ID.");
  if(out?.active===false)throw new Error("La aplicación de Enable Banking aparece Inactive. Actívala con Link accounts y vuelve aquí.");
  return {application:{name:out?.name||"Segunda Mente",active:out?.active!==false,environment:out?.environment||"PRODUCTION"}};
}
Deno.serve(async(req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const origin=req.headers.get("origin");if(origin&&origin!==ORIGIN)return json({ok:false,error:"origin_not_allowed"},403);
  const device=await auth(req);if(!device)return json({ok:false,error:"unauthorized"},401);
  try{
    if(req.method==="GET")return json({ok:true,enabled:(await hasSecret(APP_ID_NAME))&&(await hasSecret(KEY_NAME)),provider:"enablebanking"});
    if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
    const body=await req.json().catch(()=>({})),action=String(body.action||"set");
    if(action!=="set")return json({ok:false,error:"unknown_action"},400);
    const appId=String(body.appId||"").trim(),privateKey=normalizePem(String(body.privateKey||""));
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId))return json({ok:false,error:"invalid_app_id",detail:"Revisa el Application ID de Enable Banking."},400);
    if(privateKey.length<500||privateKey.length>20000||!privateKey.includes("PRIVATE KEY"))return json({ok:false,error:"invalid_private_key",detail:"El archivo seleccionado no parece contener la private key de Enable Banking."},400);
    // Guarda primero la configuración cifrada. La validación remota se hará al cargar
    // la lista de bancos; esto evita bloquear el alta por un error transitorio del proveedor.
    pemToDer(privateKey);
    await storeSecret(APP_ID_NAME,appId,"Enable Banking application ID for Segunda Mente");
    await storeSecret(KEY_NAME,privateKey,"Enable Banking private RSA key for Segunda Mente");
    return json({ok:true,enabled:true,provider:"enablebanking",stored:true});
  }catch(e){console.error("bank-config",e instanceof Error?e.message:String(e));return json({ok:false,error:"enablebanking_rejected",detail:e instanceof Error?e.message:"No pude validar Enable Banking"},400)}
}));