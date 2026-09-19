/* Regenera `supabase/schema.fingerprint.txt` a partir de las migraciones del
   repositorio, levantando un Postgres vacio igual que hace la comprobacion.

   Se usa cuando un cambio de esquema es intencionado: primero la migracion, luego
   esto, y el fichero resultante entra en el commit junto a ella. Asi la huella
   nunca se actualiza "para que pase el test" sin que alguien haya escrito antes la
   migracion que la justifica. */
process.env.SM_FINGERPRINT_WRITE = '1';
await import('./schema-check.mjs');
