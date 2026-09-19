import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const activation = await readFile(new URL('supabase/functions/ios-activate/index.ts', root), 'utf8');
const api = await readFile(new URL('ios/Shared/SecondMindAPI.swift', root), 'utf8');
const widgets = await readFile(new URL('ios/Widgets/SecondMindWidgets.swift', root), 'utf8');
const appEntitlements = await readFile(new URL('ios/App/SegundaMente.entitlements', root), 'utf8');
const widgetEntitlements = await readFile(new URL('ios/Widgets/SegundaMenteWidgets.entitlements', root), 'utf8');

test('la activacion nativa consume un codigo temporal una sola vez', () => {
  assert.match(activation, /push_activation_codes/);
  assert.match(activation, /used_at is null/);
  assert.match(activation, /expires_at > now\(\)/);
  assert.match(activation, /set used_at = now\(\)/);
  assert.match(activation, /mind_device_sessions/);
});

test('la app nativa no contiene credenciales privadas', () => {
  assert.doesNotMatch(api, /service_role/i);
  assert.doesNotMatch(api, /SUPABASE_DB_URL/);
  assert.doesNotMatch(api, /OPENAI_API_KEY/i);
  assert.match(api, /Bearer \\(token\)/);
});

test('los tres widgets existen y comparten el mismo App Group', () => {
  assert.match(widgets, /TodayWidget\(\)/);
  assert.match(widgets, /MoneyWidget\(\)/);
  assert.match(widgets, /GymWidget\(\)/);
  const group = 'group.com.adrianfabianferrer.segundamente';
  assert.ok(appEntitlements.includes(group));
  assert.ok(widgetEntitlements.includes(group));
});

test('los widgets abren la app por deep link y cachean el snapshot', () => {
  assert.match(widgets, /segundamente:\/\/open\?view=dinero/);
  assert.match(widgets, /segundamente:\/\/open\?view=gym/);
  assert.match(widgets, /SharedStore\.snapshot\(\)/);
  assert.match(widgets, /10 \* 60/);
});
