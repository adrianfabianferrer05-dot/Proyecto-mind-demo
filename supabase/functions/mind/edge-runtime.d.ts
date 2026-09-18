/* Lo que el runtime de Supabase Edge aporta como global y de lo que dependemos.
   Las declaraciones de `@supabase/functions-js` no llegan a aplicarse al hacer
   `deno check` desde fuera del runtime, asi que declaramos aqui la superficie
   exacta que usamos. Si algun dia usamos mas, se anade aqui y el typecheck lo
   sigue cubriendo, en lugar de apagar la comprobacion entera. */
declare namespace Supabase {
  namespace ai {
    class Session {
      constructor(model: string);
      run(input: string, opts?: { mean_pool?: boolean; normalize?: boolean }): Promise<unknown>;
    }
  }
}
