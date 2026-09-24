import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const today = read('today.js');
const css = read('today.css');
const migration = read('supabase/migrations/20260924043000_weekday_routine_morning_and_afternoon.sql');
const exactTimes = read('supabase/migrations/20260924044500_weekday_routine_exact_times.sql');

test('Hoy muestra la rutina estructurada completa y no depende de la nota reciente', () => {
  assert.match(today, /routine_profile === 'weekday_v1'/);
  assert.match(today, /Mi rutina/);
  assert.match(today, /Lunes a viernes/);
  assert.match(today, /Después del trabajo · flexible/);
  assert.match(today, /friday_extra/);
  assert.match(css, /\.weekday-routine/);
  assert.match(css, /\.routine-flex/);
});

test('la rutina tiene solo los dos avisos diarios pedidos', () => {
  assert.match(migration, /'morning_time', '06:00'/);
  assert.match(migration, /'summary_time'\)::time, time '15:20'/);
  assert.match(migration, /then 'Tu mañana' else 'Tu tarde'/);
  assert.match(migration, /Europe\/Madrid/);
  assert.match(migration, /jsonb_array_elements_text\(coalesce\(d\.metadata->'notify_weekdays'/);
  assert.doesNotMatch(migration, /'Tu trabajo'/);
});

test('el cron sustituye al aviso antiguo y deduplica cada momento por día', () => {
  assert.match(migration, /cron\.unschedule\('segunda-mente-afternoon-routine'\)/);
  assert.match(migration, /'segunda-mente-weekday-routine'/);
  assert.match(migration, /q\.title = p\.push_title/);
  assert.match(migration, /scheduled_at at time zone p\.tz/);
});

test('las horas explícitas de la rutina no se desplazan por silencio nocturno', () => {
  assert.match(exactTimes, /private\.enqueue_weekday_routine/);
  assert.match(exactTimes, /morning_time.*time '06:00'/s);
  assert.match(exactTimes, /afternoon_time.*time '15:20'/s);
  assert.match(exactTimes, /if inserted_status = 'queued'/);
  assert.match(exactTimes, /set scheduled_at = exact_at/);
  assert.match(exactTimes, /select private\.enqueue_weekday_routine\(\);/);
});
