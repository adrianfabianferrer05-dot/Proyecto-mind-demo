import "@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ORIGIN = "https://proyecto-mind-demo.vercel.app";
const DB_URL = Deno.env.get("SUPABASE_DB_URL")!;
const sql = postgres(DB_URL, { prepare: false, max: 1 });
const KINDS = ["expense","income","task","idea","note","event","debt"] as const;

const cors = (_origin: string | null) => ({
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
});
const json = (data: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

async function sha256Hex(value:string){
  const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function auth(req:Request){
  const h=req.headers.get("authorization")||"";
  const token=h.toLowerCase().startsWith("bearer ")?h.slice(7).trim():"";
  if(!token||token.length<24)return null;
  const hash=await sha256Hex(token);
  const rows=await sql`select id,label from public.mind_device_sessions where token_hash=${hash} and revoked_at is null limit 1`;
  if(!rows.length)return null;
  await sql`update public.mind_device_sessions set last_seen_at=now() where id=${rows[0].id}`;
  return rows[0];
}

function amountFrom(raw:string, moneyContext:boolean, timeContext:boolean){
  const explicit=raw.match(/(?:€\s*)?(\d{1,7}(?:[.,]\d{1,2})?)\s*(?:€|euros?)\b/i);
  if(explicit){ const n=Number(explicit[1].replace(",",".")); return Number.isFinite(n)?n:null; }
  if(!moneyContext||timeContext)return null;
  const spoken=raw.match(/\b(\d{1,6})\s+(\d{2})\b/);
  if(spoken){ const n=Number(`${spoken[1]}.${spoken[2]}`); return Number.isFinite(n)?n:null; }
  const single=raw.match(/\b(\d{1,7})\b/);
  if(single){ const n=Number(single[1]); return Number.isFinite(n)?n:null; }
  return null;
}
function fallbackParse(text:string){
  const raw=text.trim(),t=raw.toLowerCase();
  const timeContext=/\b(a\s+las|hora(?:s)?|sobre\s+las)\s+\d{1,2}(?:[:\s.]\d{2})?\b/i.test(raw);
  const debtReceivable=/\b(me\s+deben?|me\s+tiene(?:n)?\s+que\s+pagar|por\s+cobrar|me\s+debe\s+dinero)\b/i.test(t);
  const debtPayable=/\b(le\s+debo|les\s+debo|debo\s+(?:a|al|a la)|por\s+pagar|tengo\s+que\s+pagar\s+a)\b/i.test(t);
  const event=/\b(he\s+quedado|hemos\s+quedado|quedamos|quedo\s+con|evento|reuni[oó]n|cita|cumple(?:a[nñ]os)?|reserva|viaje|vuelo)\b/i.test(t);
  const task=/\b(recuerda|recordar|mañana|llamar|hacer|tarea|pendiente|tengo\s+que|comprar|enviar|pedir|renovar)\b/i.test(t);
  const income=/\b(cobrad|ingres|n[oó]mina|sueldo|me\s+han\s+pagado|he\s+recibido)\w*/i.test(t);
  const expense=/\b(gast|pag(?:u[eé]|ado|ar)?|compr[eé]|cena|comida|gasolina|supermerc|mercadona|alquiler|factura)\w*/i.test(t);
  const moneyContext=debtReceivable||debtPayable||income||expense||/\b(dinero|euros?)\b/i.test(t)||/[€]/.test(raw);
  const amount=amountFrom(raw,moneyContext,timeContext);
  let kind="note",category:string|null=null,debtDirection:string|null=null;
  if(debtReceivable||debtPayable){kind="debt";debtDirection=debtReceivable?"receivable":"payable";category=debtReceivable?"Por cobrar":"Por pagar";}
  else if(/\b(idea|se me ocurre|podr[ií]a|proyecto)\b/i.test(t))kind="idea";
  else if(event)kind="event";
  else if(task)kind="task";
  else if(income)kind="income";
  else if(expense||amount!==null)kind="expense";
  return {kind,title:raw.length>96?raw.slice(0,93)+"…":raw,amount,currency:"EUR",category,occurredAt:null,dueAt:null,clarificationNeeded:false,clarificationQuestion:null,confidence:.7,debtDirection};
}
async function vaultSecret(name:string){
  const rows=await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} limit 1`;
  return rows[0]?.decrypted_secret||null;
}
function responseText(out:any){
  if(typeof out?.output_text==="string")return out.output_text;
  for(const item of out?.output||[])for(const part of item?.content||[])if(part?.type==="output_text"&&typeof part?.text==="string")return part.text;
  return null;
}
async function interpret(text:string){
  const key=await vaultSecret("segunda_mente_openai_api_key");
  if(!key)return null;
  const schema={type:"object",additionalProperties:false,properties:{
    kind:{type:"string",enum:[...KINDS]},title:{type:"string"},amount:{anyOf:[{type:"number"},{type:"null"}]},currency:{anyOf:[{type:"string"},{type:"null"}]},category:{anyOf:[{type:"string"},{type:"null"}]},occurredAt:{anyOf:[{type:"string"},{type:"null"}]},dueAt:{anyOf:[{type:"string"},{type:"null"}]},clarificationNeeded:{type:"boolean"},clarificationQuestion:{anyOf:[{type:"string"},{type:"null"}]},confidence:{type:"number",minimum:0,maximum:1},debtDirection:{anyOf:[{type:"string",enum:["receivable","payable"]},{type:"null"}]}
  },required:["kind","title","amount","currency","category","occurredAt","dueAt","clarificationNeeded","clarificationQuestion","confidence","debtDirection"]};
  const now=new Date().toISOString();
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({
    model:"gpt-5.6-luna",store:false,reasoning:{effort:"none"},
    input:[{role:"system",content:`Eres el intérprete privado de Segunda Mente. Convierte una frase natural en UN registro estructurado. Zona horaria Europe/Madrid. Ahora: ${now}. Tipos: expense gasto real; income ingreso real; task acción pendiente; idea idea; note recuerdo/contexto; event cita/reunión/plan con fecha; debt dinero pendiente por cobrar o pagar. “me deben 70€” es debt/receivable, nunca expense. “le debo 40 a Juan” es debt/payable. Distingue dinero de horas: “18 50 cena” puede ser 18,50 € por el contexto; “llamar a las 18 50” es una hora y NO dinero. dueAt es el momento explícito en el que debería avisarse; no inventes una hora si el usuario no la dijo. occurredAt es cuándo ocurrió algo ya pasado, solo si está claro. No inventes datos. Si falta algo indispensable para actuar, pide una sola aclaración breve en español.`},{role:"user",content:text}],
    text:{format:{type:"json_schema",name:"mind_capture",strict:true,schema}}
  })});
  if(!r.ok){console.error("openai",r.status,await r.text());return null;}
  const txt=responseText(await r.json());if(!txt)return null;
  try{return JSON.parse(txt)}catch{return null}
}

async function listCaptures(includeArchived:boolean,limit:number){
  const cols=sql`id,raw_text,kind,amount,currency,category,title,occurred_at,due_at,source,metadata,processed,completed_at,archived_at,created_at,updated_at`;
  if(includeArchived)return await sql`select ${cols} from public.mind_captures order by created_at desc limit ${limit}`;
  return await sql`select ${cols} from public.mind_captures where archived_at is null order by created_at desc limit ${limit}`;
}
async function scheduleReminder(capture:any){
  if(!capture?.due_at)return;
  const due=new Date(capture.due_at);
  if(!Number.isFinite(due.getTime())||due.getTime()<=Date.now()+30000)return;
  const body=String(capture.title||capture.raw_text||"Tienes algo pendiente.").slice(0,220);
  await sql`insert into public.notification_queue(title,body,target_url,scheduled_at,status,capture_id) values('Segunda Mente',${body},'/',${due},'queued',${capture.id})`;
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
  if(origin&&origin!==ORIGIN)return json({ok:false,error:"origin_not_allowed"},403,origin);
  const device=await auth(req);if(!device)return json({ok:false,error:"unauthorized"},401,origin);
  try{
    if(req.method==="GET"){
      const u=new URL(req.url),limit=Math.min(250,Math.max(1,Number(u.searchParams.get("limit")||140))),captures=await listCaptures(u.searchParams.get("archived")==="1",limit),aiEnabled=!!(await vaultSecret("segunda_mente_openai_api_key"));
      return json({ok:true,captures,aiEnabled,device:{label:device.label}},200,origin);
    }
    if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405,origin);
    const body=await req.json().catch(()=>({})),action=String(body.action||"capture");
    if(action==="complete"){
      const id=String(body.id||""),completed=body.completed!==false;
      const rows=completed?await sql`update public.mind_captures set completed_at=now() where id=${id}::uuid and kind='task' returning id,completed_at,updated_at`:await sql`update public.mind_captures set completed_at=null where id=${id}::uuid and kind='task' returning id,completed_at,updated_at`;
      if(completed)await sql`update public.notification_queue set status='cancelled',updated_at=now() where capture_id=${id}::uuid and status='queued'`;
      return json({ok:true,capture:rows[0]||null},200,origin);
    }
    if(action==="archive"){
      const id=String(body.id||""),archived=body.archived!==false;
      const rows=archived?await sql`update public.mind_captures set archived_at=now() where id=${id}::uuid returning id,archived_at,updated_at`:await sql`update public.mind_captures set archived_at=null where id=${id}::uuid returning id,archived_at,updated_at`;
      if(archived)await sql`update public.notification_queue set status='cancelled',updated_at=now() where capture_id=${id}::uuid and status='queued'`;
      return json({ok:true,capture:rows[0]||null},200,origin);
    }
    if(action!=="capture")return json({ok:false,error:"unknown_action"},400,origin);
    const raw=String(body.text||"").trim().slice(0,4000);if(!raw)return json({ok:false,error:"text_required"},400,origin);
    const ai=await interpret(raw),parsed=ai||fallbackParse(raw);
    if(!KINDS.includes(parsed.kind as any))parsed.kind="note";
    const occurred=parsed.occurredAt&&Number.isFinite(new Date(parsed.occurredAt).getTime())?new Date(parsed.occurredAt):null;
    const due=parsed.dueAt&&Number.isFinite(new Date(parsed.dueAt).getTime())?new Date(parsed.dueAt):null;
    const metadata={interpreter:ai?"openai":"rules",confidence:parsed.confidence??null,clarification_needed:!!parsed.clarificationNeeded,clarification_question:parsed.clarificationQuestion??null,debt_direction:parsed.debtDirection??null};
    const rows=await sql`insert into public.mind_captures(raw_text,kind,amount,currency,category,title,occurred_at,due_at,source,metadata,processed) values(${raw},${parsed.kind},${parsed.amount??null},${parsed.currency||"EUR"},${parsed.category??null},${parsed.title||raw.slice(0,120)},${occurred},${due},'web_app',${sql.json(metadata)},${!!ai}) returning id,raw_text,kind,amount,currency,category,title,occurred_at,due_at,source,metadata,processed,completed_at,archived_at,created_at,updated_at`;
    const capture=rows[0];
    await scheduleReminder(capture);
    return json({ok:true,capture,clarification:parsed.clarificationNeeded?parsed.clarificationQuestion:null,ai:!!ai},201,origin);
  }catch(err){console.error("mind",err);const detail=err instanceof Error?err.message:String(err);return json({ok:false,error:"internal_error",detail:detail.slice(0,180)},500,origin)}
});
