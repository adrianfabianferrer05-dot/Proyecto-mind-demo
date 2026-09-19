# gym-plan: retirada

Auditada y retirada el 19 de septiembre de 2026. El código no se copia aquí: vive
en el historial, en el commit `b792923`, que es donde hay que mirar si algún día
hace falta.

## Qué hacía

Una Edge Function con dos cosas:

- `GET` → progreso por ejercicio (última serie, mejor e1RM estimado, peso previsto).
- `POST {action:"set_planned_weight"}` → guardar el peso previsto de un ejercicio.

## Por qué era código muerto

| Dónde se buscó | Resultado |
|---|---|
| Repositorio completo (js, html, json, ts) | 0 llamadas |
| `cron.job` | 0 |
| Funciones de `public` y `private` | 0 |
| Historial de `net.http_request_queue` | 0 |
| `gym_exercises.planned_weight_kg` con valor | 0 de 26 |
| `gym_exercises.working_weight_kg` con valor | 0 de 26 |

Su escritura la hace ya `gym` con `save_exercise`, que guarda `planned_weight_kg`
y `working_weight_kg` a la vez. Su lectura la cubre el payload de `gym`
(`exercises`, `recentSets`, `bests`) junto con `gym-progress`. No aportaba nada
que no estuviera cubierto, y nada de lo que hacía sirve para la asignación semanal
de entrenamientos, que va de días, no de pesos.

## Qué se ha hecho

- El código se ha quitado del repositorio y de `npm run typecheck`.
- El slug desplegado no se puede borrar con la API disponible (sólo despliega), así
  que se ha sustituido por un talón que responde `410 Gone`: sin conexión a la base
  de datos, sin autenticación que atacar y sin lógica. Desde ese despliegue no puede
  tocar ningún dato.
- Borrar el slug desde el panel de Supabase es un clic y no corre prisa.
