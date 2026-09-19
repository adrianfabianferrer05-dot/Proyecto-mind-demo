# Segunda Mente · iOS + WidgetKit

Esta carpeta añade una capa nativa para iPhone sin duplicar la lógica de Segunda Mente.

## Qué incluye

- app SwiftUI nativa que abre la PWA existente dentro de `WKWebView`;
- inyección segura de la sesión del dispositivo en `localStorage` para reutilizar la misma app web;
- activación de un solo uso mediante `ios-activate` y los mismos códigos temporales que ya usa la PWA;
- App Group compartido entre app y extensión;
- widget **Hoy** (pequeño y mediano);
- widget **Dinero** (pequeño);
- widget **Gym** (pequeño);
- deep links `segundamente://open?view=...`;
- refresco de datos usando los endpoints existentes `mind`, `bank`, `money` y `gym`;
- caché compartida para que varios widgets no hagan varias sincronizaciones del banco a la vez;
- CI macOS que genera el proyecto con XcodeGen y compila app + WidgetKit sin firma.

## Arquitectura

`SegundaMente` guarda la sesión nativa en el App Group `group.com.adrianfabianferrer.segundamente`. La extensión WidgetKit usa esa misma sesión para leer los endpoints existentes. No hay una segunda base de datos ni una segunda lógica de dinero/gym/tareas.

Los widgets vuelven a pedir datos cuando la caché tiene más de 10 minutos. La API del banco mantiene además su propio límite de frescura, así que múltiples aperturas no implican múltiples consultas reales a Cajamar.

## Seguridad

- ninguna clave privada está dentro del proyecto iOS;
- no hay `service_role`, credenciales de Cajamar ni clave de OpenAI en Swift;
- `ios-activate` acepta únicamente un código temporal no usado y no caducado;
- el código y la creación de la sesión ocurren dentro de una transacción;
- el token nativo es aleatorio de 256 bits y el servidor solo guarda su SHA-256.

## Generar el proyecto

```bash
cd ios
brew install xcodegen
xcodegen generate
open SegundaMente.xcodeproj
```

## Lo único que requiere la cuenta Apple

El código se puede compilar sin firma en CI. Para instalarlo en un iPhone hay que hacer las acciones que Apple no permite delegar:

1. iniciar sesión en Xcode con el Apple ID del propietario;
2. seleccionar el Team en los dos targets;
3. habilitar el App Group `group.com.adrianfabianferrer.segundamente` para la app y el widget;
4. ejecutar en el iPhone o distribuir por TestFlight;
5. introducir una vez el código temporal que genere Segunda Mente.

Después de eso los widgets se añaden desde la pantalla de inicio como cualquier widget de iOS.
