/* La rutina laboral no es una agenda de alarmas: al terminar el trabajo debe salir
   un solo resumen flexible de la tarde. Esta prueba protege esa intención y la
   excepción del viernes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const perfil = read('supabase/migrations/20260923205432_weekday_routine_afternoon_summary.sql');
const cron = read('supabase/migrations/20260923205734_weekday_routine_inline_cron.sql');

test('la rutina laboral guarda las horas y la flexibilidad acordadas', () => {
  assert.match(perfil, /'summary_time','15:20'/);
  assert.match(perfil, /jsonb_build_array\(1,2,3,4,5\)/, 'solo lunes a viernes');
  assert.match(perfil, /'start','07:00','end','15:20'/);
  assert.match(perfil, /'Almuerzo','time','09:00'/);
  assert.match(perfil, /Si tienes energía: gimnasio/);
  assert.match(perfil, /Si estás cansado: siesta y después gimnasio/);
});

test('el viernes recuerda el segundo trabajo sin crear otra agenda rígida', () => {
  assert.match(perfil, /'Camarero','start','20:00','end','00:30'/);
  assert.match(perfil, /Esta noche también tienes camarero de 20:00 a ~00:30\./);
  assert.match(cron, /local_dow = 5/);
});

test('solo se encola un resumen por día', () => {
  assert.match(cron, /insert into public\.notification_queue\(title, body, target_url, scheduled_at, status, capture_id\)/i);
  assert.match(cron, /where not exists \(/i);
  assert.match(cron, /q\.title = 'Tu tarde'/);
  assert.match(cron, /::date = ready\.local_now::date/);
});

test('el programador usa Europe\/Madrid y no deja esquema auxiliar', () => {
  assert.match(perfil, /'timezone','Europe\/Madrid'/);
  assert.match(cron, /drop function if exists private\.enqueue_afternoon_routine_summary/);
  assert.match(cron, /drop column if exists dedupe_key/);
  assert.match(cron, /segunda-mente-afternoon-routine/);
});
