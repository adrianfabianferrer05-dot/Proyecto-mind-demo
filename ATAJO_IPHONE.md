# Captura rápida — iPhone

Segunda Mente acepta una captura mediante esta ruta:

`/capturar.html?text=...`

## Atajo recomendado

1. En **Atajos**, crea un atajo llamado **Segunda Mente**.
2. Añade **Dictar texto**.
3. Añade **Codificar URL** al texto dictado.
4. Añade **URL** con `https://TU-DOMINIO/capturar.html?text=` seguido del texto codificado.
5. Añade **Abrir URL**.
6. Opcional: asígnalo al **botón Acción**, pantalla de inicio o Siri.

Ejemplos admitidos:
- `He pagado 16,40 € en Mercadona`
- `He gastado 52 € en gasolina`
- `Recuérdame llamar mañana al taller`
- `Idea: simplificar el onboarding`

La captura usa la misma clave local (`segunda_mente_v1`) que la PWA principal. Un gasto reconocido crea memoria + movimiento financiero; si ya existe un saldo local, lo actualiza. No lee Apple Wallet ni notificaciones privadas.