import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN="https://proyecto-mind-demo.vercel.app";
const CALLBACK=ORIGIN+"/banco-callback.html";
const DB_URL=Deno.env.get("SUPABASE_DB_URL")!;
const sql=postgres(DB_URL,{prepare:false,max:1});
const BASE="https://api.enablebanking.com";
const APP_ID_NAME="segunda_mente_enablebanking_app_id";
const KEY_NAME="segunda_mente_enablebanking_private_key";
const FRESH_MS=8*3600e3;
const TX_DAYS=45;
const MAX_PAGES=50;

const cors={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Vary":"Origin"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});

async function sha256Hex(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function auth(req:Request){const h=req.headers.get("authorization")||"";const token=h.toLowerCase().startsWith("bearer ")?h.slice(7).trim():"";if(!token||token.length<24)return null;const hash=await sha256Hex(token);const rows=await sql`select id,label from public.mind_device_sessions where token_hash=${hash} and revoked_at is null limit 1`;if(!rows.length)return null;await sql`update public.mind_device_sessions set last_seen_at=now() where id=${rows[0].id}`;return rows[0]}
async function audit(deviceId:string,stage:string,detail:string|null=null,httpStatus:number|null=null){try{await sql`insert into public.bank_setup_events(device_session_id,stage,detail,http_status) values(${deviceId}::uuid,${stage},${detail},${httpStatus})`}catch{}}
async function secret(name:string){const r=await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} and decrypted_secret is not null limit 1`;return r[0]?.decrypted_secret||null}
function b64u(data:Uint8Array|string){const bytes=typeof data==="string"?new TextEncoder().encode(data):data;let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}
function pemToDer(pem:string){const m=pem.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);if(!m)throw new Error("private_key_invalid");const bin=atob(m[1].replace(/\s/g,""));const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
async function jwt(){const appId=await secret(APP_ID_NAME),pem=await secret(KEY_NAME);if(!appId||!pem)throw new Error("bank_provider_not_configured");const key=await crypto.subtle.importKey("pkcs8",pemToDer(pem),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);const now=Math.floor(Date.now()/1000);const header=b64u(JSON.stringify({typ:"JWT",alg:"RS256",kid:appId}));const body=b64u(JSON.stringify({iss:"enablebanking.com",aud:"api.enablebanking.com",iat:now,exp:now+3600}));const input=`${header}.${body}`;const sig=new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(input)));return `${input}.${b64u(sig)}`}

async function eb(path:string,init:RequestInit={}){
  const token=await jwt();
  const r=await fetch(BASE+path,{...init,headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json",...(init.headers||{})}});
  const raw=await r.text();let out:any={};try{out=raw?JSON.parse(raw):{}}
  catch{}
  if(!r.ok){
    const detail=typeof out?.detail==="string"?out.detail:typeof out?.message==="string"?out.message:typeof out?.error==="string"?out.error:raw||("Enable Banking "+r.status);
    const e:any=new Error(String(detail).slice(0,300));e.status=r.status;e.providerCode=typeof out?.error==="string"?out.error:null;throw e;
  }
  return out;
}
function expired(e:any){return e?.providerCode==="EXPIRED_SESSION"||/session is expired|expired session/i.test(String(e?.message||""))}

async function latest(deviceId:string){const r=await sql`select * from public.bank_connections where device_session_id=${deviceId}::uuid and provider='enablebanking' and revoked_at is null order by (status='AUTHORIZED') desc,created_at desc limit 1`;return r[0]||null}
function accountUid(a:any){return typeof a==="string"?a:String(a?.uid||a?.account_uid||a?.id||"")}
function accountIban(a:any){return typeof a==="string"?"":String(a?.account_id?.iban||a?.iban||"")}
function balancePick(out:any){const list=Array.isArray(out?.balances)?out.balances:[];const n=(x:any)=>{const v=Number(x?.balance_amount?.amount);return Number.isFinite(v)?v:null};const booked=list.find((x:any)=>["CLBD","ITBD","XPCD"].includes(String(x?.balance_type)))||list[0];const available=list.find((x:any)=>["CLAV","ITAV","FWAV"].includes(String(x?.balance_type)))||booked;return {current:n(booked),available:n(available),currency:String(booked?.balance_amount?.currency||available?.balance_amount?.currency||"EUR")}}
function txAmount(t:any){const v=Number(t?.transaction_amount?.amount);if(!Number.isFinite(v))return null;return String(t?.credit_debit_indicator)==="DBIT"?-Math.abs(v):Math.abs(v)}
function txMerchant(t:any,amount:number){const party=amount<0?t?.creditor:t?.debtor;return String(party?.name||"").slice(0,180)||null}
function txDescription(t:any){const rem=Array.isArray(t?.remittance_information)?t.remittance_information.join(" · "):"";return String(rem||t?.note||t?.bank_transaction_code?.description||t?.reference_number||"Movimiento bancario").slice(0,500)}
async function txKey(accountId:string,t:any){const direct=t?.entry_reference||t?.transaction_id||t?.reference_number;if(direct)return String(direct).slice(0,240);return await sha256Hex([accountId,t?.booking_date||t?.transaction_date||"",t?.value_date||"",t?.transaction_amount?.amount||"",t?.credit_debit_indicator||"",txDescription(t)].join("|"))}

async function upsertAccount(conn:any,a:any,bal:any){
  const uid=accountUid(a);if(!uid)return null;
  const iban=accountIban(a),last4=iban?iban.slice(-4):null,currency=String(a?.currency||bal?.currency||"EUR").slice(0,8);
  const existing=await sql`select * from public.bank_accounts where connection_id=${conn.id}::uuid order by created_at`;
  let match=existing.find((x:any)=>String(x.provider_account_id)===uid)||null;
  if(!match&&last4)match=existing.find((x:any)=>String(x.iban_last4||"")===last4)||null;
  if(!match&&existing.length===1)match=existing[0];
  const display=String(a?.product||a?.name||match?.display_name||conn.institution_name||"Cuenta").slice(0,180);
  const owner=a?.name?String(a.name).slice(0,180):(match?.owner_name||null);
  if(match){
    await sql`update public.bank_accounts set provider_account_id=${uid},display_name=${display},iban_last4=coalesce(${last4},iban_last4),currency=${currency},owner_name=${owner},current_balance=coalesce(${bal?.current??null},current_balance),available_balance=coalesce(${bal?.available??null},available_balance),last_synced_at=case when ${bal?.current!=null||bal?.available!=null} then now() else last_synced_at end,updated_at=now() where id=${match.id}`;
    return match.id;
  }
  const rows=await sql`insert into public.bank_accounts(connection_id,provider_account_id,display_name,iban_last4,currency,owner_name,current_balance,available_balance,last_synced_at) values(${conn.id},${uid},${display},${last4},${currency},${owner},${bal?.current??null},${bal?.available??null},${bal?.current!=null||bal?.available!=null?new Date():null}) returning id`;
  return rows[0]?.id||null;
}

async function saveAccounts(conn:any,session:any,deviceId:string){
  let anyBalance=false,allOk=true;const accounts=Array.isArray(session?.accounts)?session.accounts:[];
  for(const a of accounts){
    const uid=accountUid(a);if(!uid)continue;let bal:any={current:null,available:null,currency:String(a?.currency||"EUR")};
    try{const balances=await eb("/accounts/"+encodeURIComponent(uid)+"/balances");bal=balancePick(balances);if(bal.current!=null||bal.available!=null)anyBalance=true;await audit(deviceId,"bank_balances_ok","account="+uid.slice(0,8)+" count="+(Array.isArray(balances?.balances)?balances.balances.length:0));}
    catch(e){allOk=false;await audit(deviceId,"bank_balances_error",e instanceof Error?e.message:String(e),(e as any)?.status||null);if(expired(e))throw e;}
    await upsertAccount(conn,a,bal);
  }
  if(anyBalance)await sql`update public.bank_connections set balance_synced_at=now(),updated_at=now() where id=${conn.id}`;
  return {ok:allOk&&anyBalance,anyBalance};
}

async function fetchTransactions(conn:any,deviceId:string){
  const accounts=await sql`select * from public.bank_accounts where connection_id=${conn.id}::uuid`;
  const dateFrom=new Date(Date.now()-TX_DAYS*86400000).toISOString().slice(0,10);
  let totalAll=0,completeAll=true;
  for(const a of accounts){
    let key:string|null=null,pages=0,total=0,complete=true;
    try{
      do{
        if(pages>=MAX_PAGES)throw new Error("too_many_transaction_pages");
        const qs=new URLSearchParams({date_from:dateFrom,strategy:"default"});if(key)qs.set("continuation_key",key);
        const out=await eb("/accounts/"+encodeURIComponent(a.provider_account_id)+"/transactions?"+qs.toString());
        const list=Array.isArray(out?.transactions)?out.transactions:[];
        for(const t of list){
          const amount=txAmount(t);if(amount===null)continue;
          const id=await txKey(a.provider_account_id,t),date=t?.booking_date||t?.transaction_date||t?.value_date||null,booked=date?new Date(String(date)+"T12:00:00Z"):null;
          await sql`insert into public.bank_transactions(bank_account_id,provider_transaction_id,booked_at,value_date,amount,currency,merchant,description,raw)
            values(${a.id},${id},${booked},${t?.value_date||null},${amount},${String(t?.transaction_amount?.currency||a.currency||"EUR").slice(0,8)},${txMerchant(t,amount)},${txDescription(t)},${sql.json({source:"enablebanking",status:t?.status||"OTHR",transaction_date:t?.transaction_date||null,merchant_category_code:t?.merchant_category_code||null})})
            on conflict(bank_account_id,provider_transaction_id) do update set booked_at=excluded.booked_at,value_date=excluded.value_date,amount=excluded.amount,currency=excluded.currency,merchant=excluded.merchant,description=excluded.description,raw=excluded.raw,updated_at=now()`;
          total++;
        }
        key=out?.continuation_key?String(out.continuation_key):null;pages++;
      }while(key);
    }catch(e){complete=false;completeAll=false;await audit(deviceId,"bank_transactions_error",e instanceof Error?e.message:String(e),(e as any)?.status||null);if(expired(e))throw e;}
    totalAll+=total;await audit(deviceId,complete?"bank_transactions_ok":"bank_transactions_partial","account="+String(a.provider_account_id).slice(0,8)+" count="+total+" pages="+pages);
  }
  if(completeAll)await sql`update public.bank_connections set transactions_synced_at=now(),updated_at=now() where id=${conn.id}`;
  return {ok:completeAll,count:totalAll};
}

async function summary(id:string){
  const con=await sql`select id,provider,institution_id,institution_name,status,provider_accounts,consent_expires_at,last_synced_at,balance_synced_at,transactions_synced_at,sync_error,created_at from public.bank_connections where id=${id}::uuid limit 1`;if(!con.length)return null;
  const accounts=await sql`select id,display_name,iban_last4,currency,current_balance,available_balance,last_synced_at from public.bank_accounts where connection_id=${id}::uuid order by created_at`;
  const tx=await sql`select t.id,t.booked_at,t.amount,t.currency,t.merchant,t.description,t.raw,a.display_name as account_name from public.bank_transactions t join public.bank_accounts a on a.id=t.bank_account_id where a.connection_id=${id}::uuid order by t.booked_at desc nulls last,t.created_at desc limit 80`;
  const needsReauth=String(con[0].sync_error||"")==="reauth_required"||/session is expired/i.test(String(con[0].sync_error||""));
  return {connection:con[0],accounts,transactions:tx,needs_reauth:needsReauth};
}

async function syncConnection(conn:any,deviceId:string,force=false){
  if(!conn?.requisition_id||conn.status!=="AUTHORIZED")return summary(conn.id);
  const now=Date.now(),balanceFresh=conn.balance_synced_at&&now-new Date(conn.balance_synced_at).getTime()<FRESH_MS,txFresh=conn.transactions_synced_at&&now-new Date(conn.transactions_synced_at).getTime()<FRESH_MS;
  if(!force&&balanceFresh&&txFresh)return summary(conn.id);
  await audit(deviceId,"bank_sync_start","connection="+conn.id);
  try{
    const session=await eb("/sessions/"+encodeURIComponent(conn.requisition_id));
    let accounts:any[]=Array.isArray(session?.accounts)?session.accounts:[];const accountsData=Array.isArray(session?.accounts_data)?session.accounts_data:[];if(!accounts.length&&accountsData.length)accounts=accountsData.map((x:any)=>({uid:x.uid,...x}));
    await audit(deviceId,"bank_session_ok","accounts="+accounts.length);
    await sql`update public.bank_connections set provider_accounts=${sql.json(accounts)},consent_expires_at=${session?.access?.valid_until?new Date(session.access.valid_until):conn.consent_expires_at},sync_error=null,updated_at=now() where id=${conn.id}`;
    const balances=balanceFresh&&!force?{ok:true,anyBalance:true}:await saveAccounts(conn,{accounts},deviceId);
    const tx=txFresh&&!force?{ok:true,count:0}:await fetchTransactions(conn,deviceId);
    const partial=!balances.ok||!tx.ok;
    await sql`update public.bank_connections set last_synced_at=case when ${!partial} then now() else last_synced_at end,sync_error=${partial?"partial_sync":null},updated_at=now() where id=${conn.id}`;
    await audit(deviceId,partial?"bank_sync_partial":"bank_sync_done",partial?"partial_sync":"tx="+tx.count);
    return {...(await summary(conn.id)),sync_partial:partial};
  }catch(e){
    const msg=e instanceof Error?e.message:String(e),status=(e as any)?.status||null;
    if(expired(e)){
      await sql`update public.bank_connections set sync_error='reauth_required',updated_at=now() where id=${conn.id}`;
      await audit(deviceId,"bank_reauth_required",msg,status);
      return {...(await summary(conn.id)),needs_reauth:true,sync_partial:true};
    }
    await sql`update public.bank_connections set sync_error=${msg.slice(0,300)},updated_at=now() where id=${conn.id}`;await audit(deviceId,"bank_sync_error",msg,status);throw e;
  }
}

async function institutionByName(name:string){const out=await eb("/aspsps?country=ES"),list=Array.isArray(out?.aspsps)?out.aspsps:[];return list.find((x:any)=>String(x.name)===name)||list.find((x:any)=>String(x.name).toLowerCase().includes(name.toLowerCase()))||null}
async function authLink(deviceId:string,institution:any,purpose:string,targetId:string|null=null){
  const state=crypto.randomUUID(),maxSec=Math.max(3600,Math.min(Number(institution.maximum_consent_validity)||90*86400,90*86400)),validUntil=new Date(Date.now()+maxSec*1000).toISOString();
  const authOut=await eb("/auth",{method:"POST",body:JSON.stringify({access:{valid_until:validUntil,balances:true,transactions:true},aspsp:{name:institution.name,country:"ES"},state,redirect_url:CALLBACK,psu_type:"personal",language:"es"})});
  const authorizationId=String(authOut.authorization_id||crypto.randomUUID()),payload:any={state,authorization_id:authorizationId,purpose,auth_url:authOut.url};if(targetId)payload.target_connection_id=targetId;
  const rows=await sql`insert into public.bank_connections(device_session_id,provider,institution_id,institution_name,requisition_id,status,provider_accounts,consent_expires_at) values(${deviceId},'enablebanking',${String(institution.name)},${String(institution.name)},${authorizationId},'PENDING_AUTHORIZATION',${sql.json(payload)},${new Date(validUntil)}) returning id`;
  return {connectionId:rows[0].id,link:authOut.url,status:"PENDING_AUTHORIZATION",purpose};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const origin=req.headers.get("origin");if(origin&&origin!==ORIGIN)return json({ok:false,error:"origin_not_allowed"},403);
  const device=await auth(req);if(!device)return json({ok:false,error:"unauthorized"},401);
  try{
    if(req.method==="GET"){const conn=await latest(device.id);return json({ok:true,configured:!!(await secret(APP_ID_NAME)),provider:"enablebanking",bank:conn?await summary(conn.id):null})}
    if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
    const body=await req.json().catch(()=>({})),action=String(body.action||"status");
    if(action==="institutions"){const out=await eb("/aspsps?country=ES"),list=Array.isArray(out?.aspsps)?out.aspsps:[];return json({ok:true,institutions:list.map((x:any)=>({name:x.name,country:x.country||"ES",logo:x.logo||null,maximum_consent_validity:x.maximum_consent_validity||null})).sort((a:any,b:any)=>String(a.name).localeCompare(String(b.name),"es"))})}
    if(action==="create_link"){
      const bankName=String(body.bankName||"").trim();if(!bankName)return json({ok:false,error:"institution_required"},400);const institution=await institutionByName(bankName);if(!institution)return json({ok:false,error:"institution_not_found"},404);return json({ok:true,...(await authLink(device.id,institution,"initial"))});
    }
    const conn=await latest(device.id);if(!conn)return json({ok:false,error:"no_bank_connection"},404);
    if(action==="balance_refresh_link"||action==="reauthorize"){
      if(conn.status!=="AUTHORIZED")return json({ok:false,error:"no_authorized_bank"},404);
      const existing=await sql`select id,provider_accounts,created_at from public.bank_connections where device_session_id=${device.id}::uuid and provider='enablebanking' and status='PENDING_AUTHORIZATION' and revoked_at is null and provider_accounts->>'purpose'='session_refresh' and provider_accounts->>'target_connection_id'=${String(conn.id)} and created_at>now()-interval '15 minutes' order by created_at desc limit 1`;
      if(existing.length&&existing[0].provider_accounts?.auth_url)return json({ok:true,connectionId:existing[0].id,link:existing[0].provider_accounts.auth_url,status:"PENDING_AUTHORIZATION",purpose:"session_refresh"});
      await sql`update public.bank_connections set status='REVOKED',revoked_at=now(),updated_at=now() where device_session_id=${device.id}::uuid and provider='enablebanking' and status='PENDING_AUTHORIZATION' and revoked_at is null`;
      const institution=await institutionByName(String(conn.institution_name||"Cajamar"));if(!institution)return json({ok:false,error:"institution_not_found"},404);
      const link=await authLink(device.id,institution,"session_refresh",String(conn.id));await audit(device.id,"bank_reauth_created","target="+conn.id);return json({ok:true,...link});
    }
    if(action==="status")return json({ok:true,bank:await summary(conn.id)});
    if(action==="balance"||action==="sync")return json({ok:true,bank:await syncConnection(conn,device.id,action==="balance"||body.force===true)});
    if(action==="disconnect"){if(conn.status==="AUTHORIZED"&&conn.requisition_id){try{await eb("/sessions/"+encodeURIComponent(conn.requisition_id),{method:"DELETE"})}catch{}}await sql`update public.bank_connections set revoked_at=now(),status='REVOKED',updated_at=now() where id=${conn.id}`;return json({ok:true})}
    return json({ok:false,error:"unknown_action"},400);
  }catch(e){const status=(e as any)?.status;console.error("bank",e instanceof Error?e.message:String(e));return json({ok:false,error:"bank_error",detail:e instanceof Error?e.message:"No pude conectar con el banco"},status===429?429:status===403?403:status===401?401:500)}
});