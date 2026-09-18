import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN="https://proyecto-mind-demo.vercel.app";
const DB_URL=Deno.env.get("SUPABASE_DB_URL")!;
const sql=postgres(DB_URL,{prepare:false,max:1});
const BASE="https://api.enablebanking.com";
const APP_ID_NAME="segunda_mente_enablebanking_app_id";
const KEY_NAME="segunda_mente_enablebanking_private_key";

const cors={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
async function secret(name:string){const r=await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} and decrypted_secret is not null limit 1`;return r[0]?.decrypted_secret||null}
function b64u(data:Uint8Array|string){const bytes=typeof data==="string"?new TextEncoder().encode(data):data;let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}
function decodePem(pem:string){const m=String(pem).match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);if(!m)throw new Error("private_key_invalid");const bin=atob(m[1].replace(/\s/g,""));const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
async function jwt(){const appId=await secret(APP_ID_NAME),pem=await secret(KEY_NAME);if(!appId||!pem)throw new Error("bank_provider_not_configured");const key=await crypto.subtle.importKey("pkcs8",decodePem(pem),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);const now=Math.floor(Date.now()/1000);const header=b64u(JSON.stringify({typ:"JWT",alg:"RS256",kid:appId}));const body=b64u(JSON.stringify({iss:"enablebanking.com",aud:"api.enablebanking.com",iat:now,exp:now+3600}));const input=`${header}.${body}`;const sig=new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(input)));return `${input}.${b64u(sig)}`}
async function eb(path:string,init:RequestInit={}){const token=await jwt();const r=await fetch(BASE+path,{...init,headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json",...(init.headers||{})}});const out=await r.json().catch(()=>({}));if(!r.ok)throw new Error(String(out?.detail||out?.message||out?.error||("Enable Banking "+r.status)).slice(0,260));return out}

Deno.serve(async (req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const origin=req.headers.get("origin");if(origin&&origin!==ORIGIN)return json({ok:false,error:"origin_not_allowed"},403);
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  try{
    const body=await req.json().catch(()=>({}));
    const code=String(body.code||"").trim(),state=String(body.state||"").trim();
    if(!code)return json({ok:false,error:"missing_code",detail:"Enable Banking no devolvió el código de autorización."},400);

    let rows:any[]=[];
    if(state){
      rows=await sql`select * from public.bank_connections where provider='enablebanking' and status='PENDING_AUTHORIZATION' and revoked_at is null and provider_accounts->>'state'=${state} order by created_at desc limit 1`;
    }else{
      rows=await sql`select * from public.bank_connections where provider='enablebanking' and status='PENDING_AUTHORIZATION' and revoked_at is null and created_at > now()-interval '30 minutes' order by created_at desc limit 2`;
      if(rows.length!==1)return json({ok:false,error:"missing_state",detail:"No puedo identificar de forma segura qué autorización terminar."},400);
    }
    if(!rows.length)return json({ok:false,error:"pending_connection_not_found",detail:"No encuentro una autorización bancaria pendiente que coincida."},404);
    const conn=rows[0];

    const session=await eb("/sessions",{method:"POST",body:JSON.stringify({code})});
    const sessionId=String(session.session_id||"");
    if(!sessionId)return json({ok:false,error:"missing_session_id",detail:"Enable Banking no devolvió session_id."},502);
    const accounts=Array.isArray(session.accounts)?session.accounts:[];
    await sql`update public.bank_connections set requisition_id=${sessionId},status='AUTHORIZED',provider_accounts=${sql.json(accounts)},consent_expires_at=${session?.access?.valid_until?new Date(session.access.valid_until):conn.consent_expires_at},updated_at=now() where id=${conn.id}`;

    for(const a of accounts){
      const uid=String(a?.uid||"");if(!uid)continue;
      const iban=String(a?.account_id?.iban||"");
      const currency=String(a?.currency||"EUR").slice(0,8);
      const display=String(a?.name||a?.details||a?.product||conn.institution_name||"Cuenta").slice(0,180);
      await sql`insert into public.bank_accounts(connection_id,provider_account_id,display_name,iban_last4,currency,owner_name,last_synced_at) values(${conn.id},${uid},${display},${iban?iban.slice(-4):null},${currency},${a?.name?String(a.name).slice(0,180):null},now()) on conflict(connection_id,provider_account_id) do update set display_name=excluded.display_name,iban_last4=excluded.iban_last4,currency=excluded.currency,owner_name=excluded.owner_name,last_synced_at=now(),updated_at=now()`;
    }

    return json({ok:true,status:"AUTHORIZED",institution:conn.institution_name,accounts:accounts.length});
  }catch(e){
    console.error("bank-callback",e instanceof Error?e.message:String(e));
    return json({ok:false,error:"bank_callback_failed",detail:e instanceof Error?e.message:"No pude terminar la autorización."},400);
  }
});