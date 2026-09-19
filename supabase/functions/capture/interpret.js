/* Intérprete local de Segunda Mente: convierte una frase en un registro estructurado
   sin depender de ningún modelo. Es el respaldo cuando no hay clave de OpenAI y el
   primer paso que decide si hace falta llamar al modelo siquiera.

   Vive aquí, junto a la función que lo posee, en JavaScript puro, porque lo usan
   tres entornos distintos: la Edge Function `mind` (Deno), el endpoint del Atajo
   de iPhone (Node en Vercel) y los tests (Node). Antes había tres copias
   divergentes y el Atajo se quedaba con la peor. Una sola copia física, una sola
   verdad, y se despliega junto a su función sin rutas que escapen del paquete.

   Todo lo de aquí es puro y determinista: mismas entradas, mismas salidas. Por eso
   se puede testear. `now` es inyectable para que las fechas no dependan del reloj
   de quien ejecute los tests. */

const TZ = "Europe/Madrid";
export const KINDS = ["expense","income","task","idea","note","event","debt"];

export function madridYMD(date=new Date()){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const get=(type)=>Number(p.find(x=>x.type===type)?.value);
  return {y:get("year"),m:get("month"),d:get("day")};
}
function offsetMinutes(utcGuess){
  const p=new Intl.DateTimeFormat("en-US",{timeZone:TZ,timeZoneName:"shortOffset",hour:"2-digit"}).formatToParts(new Date(utcGuess));
  const z=p.find(x=>x.type==="timeZoneName")?.value||"GMT";
  const m=z.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if(!m)return 0;
  const n=Number(m[2])*60+Number(m[3]||0);
  return m[1]==="-"?-n:n;
}
function madridDate(y,m,d,h,min){
  const guess=Date.UTC(y,m-1,d,h,min);
  let off=offsetMinutes(guess),utc=guess-off*60000;
  const off2=offsetMinutes(utc);if(off2!==off)utc=guess-off2*60000;
  return new Date(utc);
}
function shiftYMD(ymd,days){
  const x=new Date(Date.UTC(ymd.y,ymd.m-1,ymd.d+days));
  return {y:x.getUTCFullYear(),m:x.getUTCMonth()+1,d:x.getUTCDate()};
}
export function extractDueAt(raw,now=new Date()){
  const t=raw.toLowerCase();
  const tm=raw.match(/\b(?:a\s+las|sobre\s+las|a\s+la)\s+([01]?\d|2[0-3])(?:[:.\s]([0-5]\d))?\b/i);
  if(!tm)return null;
  const h=Number(tm[1]),min=Number(tm[2]||0),base=madridYMD(now);let target=base,matched=false;
  if(/\bpasado\s+mañana\b/i.test(t)){target=shiftYMD(base,2);matched=true}
  else if(/\bmañana\b/i.test(t)){target=shiftYMD(base,1);matched=true}
  else if(/\bhoy\b/i.test(t)){matched=true}
  if(!matched){
    const slash=t.match(/\b([0-3]?\d)[\/-]([01]?\d)(?:[\/-](\d{2,4}))?\b/);
    const named=t.match(/\b([0-3]?\d)\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/i);
    const months={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12};
    if(slash){let y=slash[3]?Number(slash[3]):base.y;if(y<100)y+=2000;target={y,m:Number(slash[2]),d:Number(slash[1])};matched=true}
    else if(named){target={y:named[3]?Number(named[3]):base.y,m:months[named[2].toLowerCase()],d:Number(named[1])};matched=true}
  }
  if(!matched){
    const wm=t.match(/\b(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/i);
    if(wm){
      const key=wm[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
      const days={domingo:0,lunes:1,martes:2,miercoles:3,jueves:4,viernes:5,sabado:6};
      const want=days[key],today=new Date(Date.UTC(base.y,base.m-1,base.d)).getUTCDay();let delta=(want-today+7)%7;
      const sameCandidate=madridDate(base.y,base.m,base.d,h,min);if(delta===0&&sameCandidate.getTime()<=now.getTime()+60000)delta=7;
      target=shiftYMD(base,delta);matched=true;
    }
  }
  let due=madridDate(target.y,target.m,target.d,h,min);
  if(!matched&&due.getTime()<=now.getTime()+60000){target=shiftYMD(base,1);due=madridDate(target.y,target.m,target.d,h,min)}
  return due.toISOString();
}
/* Normaliza un numero escrito como lo escribe una persona en España.
   "1.234,56" son mil doscientos treinta y cuatro con cincuenta y seis, no 234,56:
   el punto es separador de miles. Tambien se acepta el formato ingles "1,234.56".
   Regla: si hay dos separadores distintos, manda el ultimo como decimal; si solo
   hay uno y va seguido de exactamente tres digitos con parte entera corta, es
   separador de miles. */
export function normalizeAmount(token){
  const t=String(token||"").trim();
  if(!/^\d[\d.,]*$/.test(t))return null;
  const lastDot=t.lastIndexOf("."),lastComma=t.lastIndexOf(",");
  let clean;
  if(lastDot>=0&&lastComma>=0){
    const dec=Math.max(lastDot,lastComma);
    clean=t.slice(0,dec).replace(/[.,]/g,"")+"."+t.slice(dec+1).replace(/[.,]/g,"");
  }else if(lastDot>=0||lastComma>=0){
    const sep=lastDot>=0?".":",",at=Math.max(lastDot,lastComma);
    const head=t.slice(0,at),tail=t.slice(at+1);
    const groups=t.split(sep);
    const thousands=tail.length===3&&head.length<=3&&groups.length>=2&&groups.slice(1).every(g=>g.length===3);
    clean=thousands?t.replace(/[.,]/g,""):head.replace(/[.,]/g,"")+"."+tail.replace(/[.,]/g,"");
  }else clean=t;
  const n=Number(clean);
  return Number.isFinite(n)?n:null;
}

export function amountFrom(raw,moneyContext,timeContext){
  /* Un numero pegado a € o a "euros" es dinero pase lo que pase. */
  const tagged=raw.match(/(?:€\s*)?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d{1,9}(?:[.,]\d{1,2})?)\s*(?:€|euros?)/i);
  if(tagged){const n=normalizeAmount(tagged[1]);if(n!==null)return n;}
  if(!moneyContext||timeContext)return null;
  const grouped=raw.match(/\b(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?)\b/);
  if(grouped){const n=normalizeAmount(grouped[1]);if(n!==null)return n;}
  const decimal=raw.match(/\b(\d{1,7}[.,]\d{1,2})\b/);
  if(decimal){const n=normalizeAmount(decimal[1]);if(n!==null)return n;}
  /* "veinte cincuenta" dictado sale como "20 50": dos numeros seguidos son
     euros y centimos, pero solo cuando ya sabemos que se habla de dinero. */
  const spoken=raw.match(/\b(\d{1,6})\s+(\d{2})\b/);
  if(spoken){const n=Number(`${spoken[1]}.${spoken[2]}`);if(Number.isFinite(n))return n;}
  const single=raw.match(/\b(\d{1,9})\b/);
  if(single){const n=Number(single[1]);if(Number.isFinite(n))return n;}
  return null;
}

export function fallbackParse(text,now=new Date()){
  const raw=text.trim(),t=raw.toLowerCase();
  const timeContext=/\b(a\s+las|a\s+la|hora(?:s)?|sobre\s+las)\s+\d{1,2}(?:[:\s.]\d{2})?\b/i.test(raw);
  const debtReceivable=/\b(me\s+deben?|me\s+tiene(?:n)?\s+que\s+pagar|por\s+cobrar|me\s+debe\s+dinero)\b/i.test(t);
  const debtPayable=/\b(le\s+debo|les\s+debo|debo\s+(?:a|al|a la)|por\s+pagar|tengo\s+que\s+pagar\s+a)\b/i.test(t);
  const event=/\b(he\s+quedado|hemos\s+quedado|quedamos|quedo\s+con|evento|reuni[oó]n|cita|cumple(?:a[nñ]os)?|reserva|viaje|vuelo)\b/i.test(t);
  const task=/\b(recuerda|recu[eé]rdame|recordar|tarea|pendiente|tengo\s+que|hay\s+que|llamar|hacer|comprar|enviar|pedir|renovar|mañana|pasado\s+mañana)\b/i.test(t);
  const income=/\b(cobrad|ingres|n[oó]mina|sueldo|me\s+han\s+pagado|he\s+recibido)\w*/i.test(t);
  const expense=/\b(gast|pag(?:u[eé]|ado|ar)?|compr[eé]|cena|comida|gasolina|supermerc|mercadona|restaurante|caf[eé]|parking|peaje|alquiler|factura)\w*/i.test(t);
  const moneyContext=debtReceivable||debtPayable||income||expense||/\b(dinero|euros?)\b/i.test(t)||/[€]/.test(raw);
  const amount=amountFrom(raw,moneyContext,timeContext);
  const dueAt=(task||event)?extractDueAt(raw,now):null;
  let kind="note",category=null,debtDirection=null;
  if(debtReceivable||debtPayable){kind="debt";debtDirection=debtReceivable?"receivable":"payable";category=debtReceivable?"Por cobrar":"Por pagar";}
  else if(/\b(idea|se me ocurre|podr[ií]a|proyecto|inventar)\b/i.test(t))kind="idea";
  else if(event)kind="event";
  else if(task)kind="task";
  else if(income)kind="income";
  else if(expense||amount!==null)kind="expense";
  return {kind,title:raw.length>96?raw.slice(0,93)+"…":raw,amount,currency:"EUR",category,occurredAt:null,dueAt,clarificationNeeded:false,clarificationQuestion:null,confidence:dueAt?.length?0.78:0.7,debtDirection};
}
