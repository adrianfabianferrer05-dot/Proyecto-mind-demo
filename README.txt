SEGUNDA MENTE — V1 MÓVIL

Objetivo
Una aplicación personal mobile-first para sacar cosas de la cabeza y convertirlas en memoria, contexto, dinero y acciones. No debe sentirse como un chatbot genérico.

IMPLEMENTADO EN ESTA RAMA
- Interfaz completamente nueva optimizada para iPhone.
- Animaciones y microinteracciones, respetando prefers-reduced-motion.
- Inicio con resumen y actividad reciente.
- Entrada universal por texto y voz cuando Web Speech está disponible.
- Fallback al dictado nativo del teclado de iPhone.
- Clasificación local inicial: finanzas, tareas, ideas y notas.
- Memoria persistente en localStorage para el prototipo.
- Área Dinero y simulación de movimientos para validar UX.
- Flujo visual de conexión bancaria.
- PWA instalable (manifest + service worker) y caché offline.

NO FINGIR COMO IMPLEMENTADO
- La API de ChatGPT todavía no está conectada.
- No existe sincronización cloud/multi-dispositivo todavía.
- No existe conexión bancaria real todavía.
- Apple Wallet y las notificaciones generales de iOS no son una fuente accesible directamente desde una PWA.

ARQUITECTURA SIGUIENTE
1. Backend seguro + autenticación.
2. API de ChatGPT para interpretar cada captura en lenguaje natural y devolver acciones estructuradas.
3. Memoria semántica con trazabilidad y capacidad de corregir lo entendido.
4. Open Banking / PSD2 para movimientos reales; tokens y secretos solo en backend.
5. Motor de automatizaciones: recordatorios, tareas, presupuestos y contexto personal.
6. Sincronización entre dispositivos y exportación/borrado de datos.

DESPLIEGUE
Proyecto estático sin build. Compatible con Vercel/Cloudflare Pages/GitHub Pages sirviendo la raíz de la rama.

Rama de trabajo: segunda-mente-v1
