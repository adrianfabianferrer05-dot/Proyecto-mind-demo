import "@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import webpush from "npm:web-push@3.6.7";

const ORIGIN="https://proyecto-mind-demo.vercel.app";
const DB_URL=Deno.env.get("SUPABASE_DB_URL")!;
const sql=postgres(DB_URL,{prepare:false,max:1});

function cors(_o:string|null){return{"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Vary":"Origin"}}
function json(d:unknown,s=200,o:string|null=null){return new Response(JSON.stringify(d),{status:s,headers:{...cors(o),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
async function hash(v:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("")}
function eq(a:string,b:string){const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0}
function newToken(){const x=crypto.getRandomValues(new Uint8Array(32));let s="";for(const b of x)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
async function secrets(){const r=await sql`select name,decrypted_secret from vault.decrypted_secrets where name in ('segunda_mente_vapid_private','segunda_mente_vapid_public','segunda_mente_push_send_token')`;const o:Record<string,string>={};for(const x of r)o[x.name]=x.decrypted_secret;if(!o.segunda_mente_vapid_private||!o.segunda_mente_vapid_public||!o.segunda_mente_push_send_token)throw new Error("push secrets missing");return o}
function valid(s:any){return !!(s&&typeof s.endpoint==="string"&&s.endpoint.startsWith("https://")&&s.keys&&typeof s.keys.p256dh==="string"&&typeof s.keys.auth==="string")}
async function deliver(sub:any,payload:any,pub:string,priv:string){webpush.setVapidDetails(ORIGIN,pub,priv);return await webpush.sendNotification(sub,JSON.stringify(payload),{TTL:300,urgency:"normal"})}
async function issueDeviceSession(){const deviceToken=newToken(),dh=await hash(deviceToken);await sql`insert into public.mind_device_sessions(token_hash,label,last_seen_at) values(${dh},'iPhone',now())`;return deviceToken}
async function knownSubscription(sub:any){if(!valid(sub))return false;const rows=await sql`select id from public.push_subscriptions where endpoint=${sub.endpoint} and active=true and subscription->'keys'->>'p256dh'=${sub.keys.p256dh} and subscription->'keys'->>'auth'=${sub.keys.auth} limit 1`;return rows.length>0}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
  if(origin&&origin!==ORIGIN)return json({ok:false,error:"origin_not_allowed"},403,origin);
  try{
    const sec=await secrets();
    if(req.method==="GET")return json({ok:true,publicKey:sec.segunda_mente_vapid_public},200,origin);
    if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405,origin);
    const body=await req.json().catch(()=>({})),action=String(body.action||"");

    if(action==="recover"){
      const sub=body.subscription;
      if(!valid(sub)||!(await knownSubscription(sub)))return json({ok:false,error:"subscription_not_recognized"},401,origin);
      const deviceToken=await issueDeviceSession();
      await sql`update public.push_subscriptions set user_agent=${req.headers.get("user-agent")||null},updated_at=now() where endpoint=${sub.endpoint}`;
      return json({ok:true,deviceToken,recovered:true},200,origin);
    }

    if(action==="subscribe"){
      const code=String(body.code||"").trim(),sub=body.subscription;
      if(!code||!valid(sub))return json({ok:false,error:"invalid_request"},400,origin);
      const ch=await hash(code),codes=await sql`select code_hash from public.push_activation_codes where code_hash=${ch} and used_at is null and expires_at>now() limit 1`;
      if(!codes.length)return json({ok:false,error:"invalid_or_expired_code"},401,origin);
      const ua=req.headers.get("user-agent")||null;
      await sql`insert into public.push_subscriptions(endpoint,subscription,user_agent,active,failure_count,last_error,updated_at) values(${sub.endpoint},${sql.json(sub)},${ua},true,0,null,now()) on conflict(endpoint) do update set subscription=excluded.subscription,user_agent=excluded.user_agent,active=true,failure_count=0,last_error=null,updated_at=now()`;
      const deviceToken=await issueDeviceSession();
      await sql`update public.push_activation_codes set used_at=now() where code_hash=${ch}`;
      let testPush=false,pushError:string|null=null;
      try{await deliver(sub,{title:"Segunda Mente",body:"Ya puedo avisarte.",url:"/"},sec.segunda_mente_vapid_public,sec.segunda_mente_vapid_private);testPush=true;await sql`update public.push_subscriptions set last_success_at=now(),last_error=null,failure_count=0,updated_at=now() where endpoint=${sub.endpoint}`}
      catch(e){pushError=(e instanceof Error?e.message:String(e)).slice(0,180);await sql`update public.push_subscriptions set failure_count=failure_count+1,last_error=${pushError},updated_at=now() where endpoint=${sub.endpoint}`}
      await sql`insert into public.notification_log(kind,title,body,target_count,success_count,failure_count,metadata) values('web_push_test','Segunda Mente','Ya puedo avisarte.',1,${testPush?1:0},${testPush?0:1},${sql.json({endpoint:sub.endpoint.slice(0,80),device_session:true})})`;
      return json({ok:true,testPush,pushError,deviceToken},200,origin);
    }

    if(action==="send"){
      const ah=req.headers.get("authorization")||"",provided=ah.toLowerCase().startsWith("bearer ")?ah.slice(7):String(body.token||"");
      if(!provided||!eq(provided,sec.segunda_mente_push_send_token))return json({ok:false,error:"unauthorized"},401,origin);
      const title=String(body.title||"Segunda Mente").slice(0,80),message=String(body.body||"Tienes algo pendiente.").slice(0,220),url=typeof body.url==="string"&&body.url.startsWith("/")?body.url:"/",rows=await sql`select endpoint,subscription from public.push_subscriptions where active=true order by updated_at desc limit 20`;
      let success=0,failure=0;
      for(const row of rows){
        try{await deliver(row.subscription,{title,body:message,url},sec.segunda_mente_vapid_public,sec.segunda_mente_vapid_private);success++;await sql`update public.push_subscriptions set last_success_at=now(),failure_count=0,last_error=null,updated_at=now() where endpoint=${row.endpoint}`}
        catch(e:any){failure++;const status=Number(e?.statusCode||0),msg=(e instanceof Error?e.message:String(e)).slice(0,500);await sql`update public.push_subscriptions set failure_count=failure_count+1,last_error=${msg},active=case when ${status} in (404,410) then false else active end,updated_at=now() where endpoint=${row.endpoint}`}
      }
      await sql`insert into public.notification_log(kind,title,body,target_count,success_count,failure_count,metadata) values('web_push',${title},${message},${rows.length},${success},${failure},${sql.json({url})})`;
      return json({ok:true,targets:rows.length,success,failure},200,origin);
    }
    return json({ok:false,error:"unknown_action"},400,origin);
  }catch(e){console.error("push",e);return json({ok:false,error:"internal_error",detail:(e instanceof Error?e.message:String(e)).slice(0,180)},500,origin)}
});
