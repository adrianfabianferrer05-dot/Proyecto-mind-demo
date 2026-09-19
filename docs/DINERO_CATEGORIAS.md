# Dinero por categorías

Cómo un apunte de Cajamar acaba siendo "Alimentación: 195,50 €", y por qué está
hecho así.

## El recorrido de un movimiento

```
OP.TARJ.COMPRA COMERCIO 415007******5805 MERCADONA BARBASTRO 006297170
   │
   ├─ normalización  →  merchant_normalized = "Mercadona"   (la descripción original no se toca)
   ├─ clasificación  →  category = "Alimentación", source = "rule", confidence = 1.0
   ├─ persistencia   →  se guarda; no se recalcula al abrir la app
   └─ corrección     →  si la cambias, se recuerda para ese comercio
```

## Los cuatro niveles, y por qué en ese orden

| Orden | Fuente | Quién decide |
|---|---|---|
| 1 | `manual` | tú, sobre **ese** movimiento |
| 2 | `learned_rule` | tú, sobre **ese comercio**, la última vez |
| 3 | `rule` | las reglas deterministas de `categorize.js` |
| 4 | `ai` | el modelo, solo para lo que nadie más resuelve |
| 5 | (nada) | Sin clasificar |

El orden que pedía el encargo ponía las reglas deterministas por encima de las
aprendidas. Está al revés a propósito: si corriges "Crepería Dimas" a Ocio, tiene
que quedarse en Ocio, y la regla `creper → Comer fuera` existe y ganaría. Una regla
general no puede pisar a una persona que ya ha dicho lo contrario; si lo hiciera,
la memoria de correcciones sería un adorno.

Comprobado en producción: se borró la categoría de los cinco movimientos de
Crepería Dimas y se volvió a clasificar. Salieron los cinco como Ocio /
`learned_rule`, no como Comer fuera.

## El modelo clasifica comercios, no movimientos

401 movimientos son 121 comercios distintos. Las reglas resuelven 320 movimientos
(80 %); de los 81 que quedan salen 43 comercios, y esos 43 caben en **dos llamadas**
de 25. La respuesta se guarda como regla en `bank_category_rules`, así que el mismo
comercio no se vuelve a preguntar nunca — ni ahora ni cuando aparezca otra vez el
mes que viene.

Lo que se le manda: nombre limpio del comercio, importe medio, si entra o sale, y
cuántas veces aparece. Nada más. Ni descripción completa (lleva la máscara de la
tarjeta), ni IBAN, ni identificadores internos. Hay un test que lo vigila.

Si la confianza baja de 0,6, o si el propio modelo responde "Sin clasificar", no se
guarda nada. Quedan 25 movimientos sin clasificar (441,80 €) y es el resultado
correcto: son códigos opacos (`ZVYGL1FT`, `MMAN`) y nombres de persona sueltos.
Inventarles una categoría sería mentir en los totales.

## Reconciliación: cuándo se unen un gasto apuntado y uno del banco

Se unen solo si **no hay ninguna duda**:

- el importe coincide al céntimo,
- la fecha está dentro de ±3 días,
- hay **exactamente un** candidato por cada lado,
- y el movimiento **no** es un Bizum ni una retirada de cajero.

Lo último no es paranoia: hay un gasto apuntado de 18 € y un Bizum de 18 € a dos
días de distancia. Coinciden en el número y en nada más — ese Bizum pudo ser una
cena, un préstamo o devolverle algo a alguien. Unirlos automáticamente sería
inventarse un hecho. Un cajero, igual: lo que se hizo con ese dinero después no lo
sabe nadie.

Cuando se unen, el movimiento bancario es la verdad financiera y la captura aporta
el contexto: si la captura traía categoría, se la queda el movimiento con
`source = manual`. La captura se marca con `metadata.reconciled_bank_transaction`,
y un índice único impide que dos movimientos reclamen la misma captura.

De 8 gastos apuntados se unió 1 ("Cena 10" ↔ Federación Fiestas Monzón, −10 €). Los
otros 7 se quedaron sin unir, que es lo correcto: tres de 18,50 € el mismo día son
indistinguibles entre sí.

## Suscripciones

Un cargo del mismo comercio en tres meses distintos con un importe estable
(desviación < 35 %) se marca como **posible** suscripción. Posible, no confirmada:
es una inferencia, y hasta que la confirmes el estado es `possible`. Salieron 9 de
22 candidatos; los 13 descartados eran sitios a los que se va a menudo pero con
importes que bailan.

## Categorías

Viven en la tabla `money_categories`, no en el código. `categorize.js` solo aporta
la siembra inicial de 15; a partir de ahí se pueden añadir (`add_category`) o
renombrar (`rename_category`, que arrastra movimientos y reglas en una transacción)
sin desplegar nada.

## Frecuencia de sincronización

Estaba en 8 horas, que para una app que se abre varias veces al día significaba
abrirla y ver lo de ayer. Ahora son 20 minutos, y los decide el servidor, no el
cliente: la app llama sin forzar y `bank` responde con lo que tiene si es reciente.
El botón de actualizar sigue forzando. El techo real son tres consultas por hora
aunque abras la app cada minuto.

## Lo que no hace

- No adivina en qué se gastó el efectivo de un cajero.
- No reparte un Bizum entre categorías de consumo por su cuenta.
- No recalcula la clasificación al abrir la app: lo ya clasificado se queda.
- No llama al modelo si una regla resuelve el movimiento.
