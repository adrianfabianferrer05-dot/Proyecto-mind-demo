-- La preferencia "gym" se creo por simetria, pero ningun entreno encola avisos:
-- solo lo hacen las capturas con fecha. Un interruptor que no apaga nada es peor
-- que no tenerlo, asi que se retira la columna en vez de enseñarla en la app.
alter table public.notification_preferences drop column if exists gym;
