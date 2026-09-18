import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN="https://proyecto-mind-demo.vercel.app";
const DB_URL=Deno.env.get("SUPABASE_DB_URL")!;
const sql=postgres(DB_URL,{prepare:false,max:1});
const BASE="https://api.enablebanking.com";
const APP_ID_NAME="segunda_mente_enablebanking_app_id";
const KEY_NAME="segunda_mente_enablebanking_private_key";
const cors={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});

async function sha256Hex(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function auth(req:Request){const h=req.headers.get("authorization")||"";const token=h.toLowerCase().startsWith("bearer ")?h.slice(7).trim():"";if(!token||token.length<24)return null;const hash=await sha256Hex(token);const rows=await sql`select id,label from public.mind_device_sessions where token_hash=${hash} and revoked_at is null limit 1`;if(!rows.length)return null;await sql`update public.mind_device_sessions set last_seen_at=now() where id=${rows[0].id}`;return rows[0]}
async function audit(deviceId:string,stage:string,detail:string|null=null,httpStatus:number|null=null){try{await sql`insert into public.bank_setup_events(device_session_id,stage,detail,http_status) values(${deviceId}::uuid,${stage},${detail},${httpStatus})`}catch{}}
async function secret(name:string){const r=await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} and decrypted_secret is not null limit 1`;return r[0]?.decrypted_secret||null}
function b64u(data:Uint8Array|string){const bytes=typeof data==="string"?new TextEncoder().encode(data):data;let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}
function pemToDer(pem:string){const m=pem.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);if(!m)throw new Error("private_key_invalid");const bin=atob(m[1].replace(/\s/g,""));const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
async function jwt(){const appId=await secret(APP_ID_NAME),pem=await secret(KEY_NAME);if(!appId||!pem)throw new Error("bank_provider_not_configured");const key=await crypto.subtle.importKey("pkcs8",pemToDer(pem),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);const now=Math.floor(Date.now()/1000);const header=b64u(JSON.stringify({typ:"JWT",alg:"RS256",kid:appId}));const body=b64u(JSON.stringify({iss:"enablebanking.com",aud:"api.enablebanking.com",iat:now,exp:now+3600}));const input=`${header}.${body}`;const sig=new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(input)));return `${input}.${b64u(sig)}`}
async function eb(path:string){const token=await jwt();const r=await fetch(BASE+path,{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});const raw=await r.text();let out:any={};try{out=raw?JSON.parse(raw):{}}catch{}if(!r.ok){const detail=typeof out?.detail==="string"?out.detail:typeof out?.message==="string"?out.message:typeof out?.error==="string"?out.error:raw||("Enable Banking "+r.status);const e:any=new Error(String(detail).slice(0,300));e.status=r.status;throw e}return out}
function balancePick(out:any){const list=Array.isArray(out?.balances)?out.balances:[];const n=(x:any)=>{const v=Number(x?.balance_amount?.amount);return Number.isFinite(v)?v:null};const current=list.find((x:any)=>["CLAV","CLBD","ITBD","ITAV","XPCD"].includes(String(x?.balance_type)))||list[0];const available=list.find((x:any)=>["CLAV","ITAV","FWAV"].includes(String(x?.balance_type)))||current;return {current:n(current),available:n(available),currency:String(current?.balance_amount?.currency||available?.balance_amount?.currency||"EUR")}}
async function summary(id:string){const con=await sql`select id,provider,institution_id,institution_name,status,provider_accounts,consent_expires_at,last_synced_at,balance_synced_at,transactions_synced_at,sync_error,created_at from public.bank_connections where id=${id}::uuid limit 1`;if(!con.length)return null;const accounts=await sql`select id,display_name,iban_last4,currency,current_balance,available_balance,last_synced_at from public.bank_accounts where connection_id=${id}::uuid order by created_at`;const tx=await sql`select t.id,t.booked_at,t.amount,t.currency,t.merchant,t.description,a.display_name as account_name from public.bank_transactions t join public.bank_accounts a on a.id=t.bank_account_id where a.connection_id=${id}::uuid order by t.booked_at desc nulls last,t.created_at desc limit 60`;return {connection:con[0],accounts,transactions:tx}}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const origin=req.headers.get("origin");if(origin&&origin!==ORIGIN)return json({ok:false,error:"origin_not_allowed"},403);
  const device=await auth(req);if(!device)return json({ok:false,error:"unauthorized"},401);
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const conns=await sql`select * from public.bank_connections where device_session_id=${device.id}::uuid and provider='enablebanking' and status='AUTHORIZED' and revoked_at is null order by created_at desc limit 1`;
  if(!conns.length)return json({ok:false,error:"no_authorized_bank"},404);
  const conn=conns[0],accounts=await sql`select * from public.bank_accounts where connection_id=${conn.id}::uuid order by created_at`;
  let updated=0,rateLimited=false,lastError:string|null=null;
  for(const a of accounts){
    try{
      const out=await eb("/accounts/"+encodeURIComponent(a.provider_account_id)+"/balances");
      const bal=balancePick(out);
      await audit(device.id,"bank_balances_direct_ok","account="+String(a.provider_account_id).slice(0,8)+" count="+(Array.isArray(out?.balances)?out.balances.length:0));
      if(bal.current!=null||bal.available!=null){
        await sql`update public.bank_accounts set current_balance=${bal.current},available_balance=${bal.available},currency=${bal.currency.slice(0,8)},last_synced_at=now(),updated_at=now() where id=${a.id}`;
        updated++;
      }
    }catch(e){
      const status=(e as any)?.status||null,msg=e instanceof Error?e.message:String(e);lastError=msg;if(status===429)rateLimited=true;await audit(device.id,"bank_balances_direct_error",msg,status);
    }
  }
  if(updated>0){await sql`update public.bank_connections set balance_synced_at=now(),last_synced_at=now(),sync_error=null,updated_at=now() where id=${conn.id}`}
  else if(lastError){await sql`update public.bank_connections set sync_error=${lastError.slice(0,300)},updated_at=now() where id=${conn.id}`}
  const bank=await summary(conn.id);
  return json({ok:true,bank:{...bank,sync_partial:updated===0,balance_rate_limited:rateLimited,balance_error:lastError}});
});