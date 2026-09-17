export const MEMORY_MODEL = "gte-small";

export function memoryText(c:any){
  const p=[c.title||c.raw_text,c.raw_text&&c.raw_text!==c.title?`Original: ${c.raw_text}`:null,`Tipo: ${c.kind||"note"}`];
  if(c.category)p.push(`Categoría: ${c.category}`);
  if(c.amount!=null)p.push(`Importe: ${c.amount} ${c.currency||"EUR"}`);
  if(c.due_at)p.push(`Fecha: ${new Date(c.due_at).toISOString()}`);
  if(c.metadata?.last_correction)p.push(`Corrección confirmada: ${c.metadata.last_correction}`);
  return p.filter(Boolean).join(". ").slice(0,1800);
}

export function vectorLiteral(v:number[]){
  return "["+v.map(n=>Number(n).toFixed(7)).join(",")+"]";
}

export function shouldUseAI(raw:string,local:any){
  const complex=raw.length>120||/\b(si|cuando|después|despues|antes|cada|todos los|todas las|excepto|hasta que|a menos que|y luego|pero|mientras)\b/i.test(raw);
  const simpleMoney=local.amount!=null&&["expense","income","debt"].includes(local.kind)&&raw.length<90;
  const simpleTimed=["task","event"].includes(local.kind)&&!!local.dueAt&&raw.length<110;
  return complex||!(simpleMoney||simpleTimed);
}
