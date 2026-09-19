import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const bank = await readFile(new URL('supabase/functions/bank/index.ts', root), 'utf8');
const callback = await readFile(new URL('supabase/functions/bank-callback/index.ts', root), 'utf8');
const today = await readFile(new URL('today.js', root), 'utf8');

test('la sincronizacion bancaria consume todas las paginas', () => {
  assert.match(bank, /do\s*\{/);
  assert.match(bank, /\}\s*while\(key\)/);
  assert.doesNotMatch(bank, /pages\s*<\s*3/);
  assert.match(bank, /continuation_key/);
  assert.match(bank, /strategy:\s*"default"/);
});

test('la sincronizacion no limita los movimientos a BOOK', () => {
  assert.doesNotMatch(bank, /transaction_status\s*:\s*["']BOOK["']/);
  assert.match(bank, /t\?\.booking_date\|\|t\?\.transaction_date\|\|t\?\.value_date/);
});

test('una sesion expirada se convierte en reconexion explicita', () => {
  assert.match(bank, /sync_error='reauth_required'/);
  assert.match(bank, /action==="balance_refresh_link"\|\|action==="reauthorize"/);
  assert.match(bank, /balances:true,transactions:true/);
});

test('la reconexion reemplaza la sesion del mismo enlace y conserva su cuenta', () => {
  assert.match(callback, /target_connection_id/);
  assert.match(callback, /set requisition_id=\$\{sessionId\},status='AUTHORIZED'/);
  assert.match(callback, /provider_account_id=\$\{providerId\}/);
});

test('la fila temporal de reconexion no reutiliza el session id unico', () => {
  assert.match(callback, /completed_session_id:sessionId/);
  assert.match(callback, /set status='REVOKED',provider_accounts=\$\{sql\.json\(completed\)\},revoked_at=now\(\)/);
  assert.doesNotMatch(callback, /set requisition_id=\$\{sessionId\},status='REVOKED'/);
});

test('una sesion renovada puede devolver cuentas como ids de texto', () => {
  assert.match(bank, /function accountUid\(a:any\)\{return typeof a==="string"\?a:/);
  assert.match(callback, /function uid\(a:any\)\{return typeof a==="string"\?a:/);
});

test('los gastos manuales posteriores al ultimo saldo se descuentan temporalmente', () => {
  assert.match(today, /pendingManualMoney/);
  assert.match(today, /d > mark/);
  assert.match(today, /effectiveBalance = baseBalance \+ pendingIn - pendingOut/);
  assert.match(today, /a\.available_balance != null \? a\.available_balance : a\.current_balance/);
  assert.match(today, /Saldo bancario estimado/);
});
