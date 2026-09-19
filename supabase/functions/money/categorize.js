/* De "OP.TARJ.COMPRA COMERCIO 415007******5805 MERCADONA BARBASTRO 006297170"
   a "Mercadona · Alimentación".

   Aquí no se llama a nadie ni se toca la base: entra un movimiento, sale una
   categoría o nada. Eso es lo que permite probarlo con `node --test` y lo que hace
   que el mismo código valga en el backend y en los tests.

   El orden importa y es deliberado. Primero el tipo de movimiento (un Bizum es un
   Bizum aunque el nombre del destinatario parezca un restaurante), después el
   comercio. Y cuando no hay certeza no se inventa: se devuelve null y que decida
   otro nivel. Un movimiento mal clasificado con confianza es peor que uno sin
   clasificar, porque el primero miente en los totales y el segundo solo pide ayuda. */

/* Las categorías base. La lista viva está en la tabla `money_categories`, que se
   siembra con esto: aquí solo vive el arranque y lo que necesitan los tests. */
export const CATEGORIAS = [
  'Alimentación',
  'Comer fuera',
  'Ocio',
  'Transporte',
  'Compras',
  'Suscripciones',
  'Hogar',
  'Salud',
  'Gimnasio',
  'Viajes',
  'Transferencias / Bizum',
  'Efectivo',
  'Ingresos',
  'Otros',
  'Sin clasificar',
];
export const SIN_CLASIFICAR = 'Sin clasificar';

/* Ruido que el banco mete delante y detrás del nombre real del comercio. */
const PREFIJO_TARJETA = /^(?:DEVOL\.)?OP\.TARJ\.COMPRA\s+COMERCIO\s+[\d*]{6,}\s*/i;
const FECHA_SUELTA = /^\d{1,2}(?:ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC|JAN|APR|AUG|DEC)\s+/i;
const ID_FINAL = /\s+\d{6,}$/;
const CIUDAD_FINAL = /\s+-\s+[^-]{2,30}$/;

/* Pasarelas de pago: lo que importa es lo que va detrás, no la pasarela.
   "SumUp *Gomilandia - La Pobla de V" es Gomilandia, no SumUp. */
const PASARELAS = /^(?:sumup|klarna|whop|paypal|izettle|stripe|square|glovo\*|revolut)\s*\*?\s*/i;

/* Marcas que se escriben de veinte formas distintas y siempre son la misma. */
const MARCAS = [
  [/mercadona/i, 'Mercadona'],
  [/netflix/i, 'Netflix'],
  [/disney\s*(plus|\+)|disney\s*mine/i, 'Disney+'],
  [/spotify/i, 'Spotify'],
  [/apple\.com|itunes\.com/i, 'Apple'],
  [/google\s*\*?\s*google\s*one|google\s*one/i, 'Google One'],
  [/openai|chatgpt/i, 'OpenAI'],
  [/anthropic|claude\.ai/i, 'Anthropic'],
  [/zalando|zala\s?ndo/i, 'Zalando'],
  [/pullandbear|pull\s*&\s*bear/i, 'Pull&Bear'],
  [/zara\.com|^zara\b/i, 'Zara'],
  [/booking\.com/i, 'Booking'],
  [/mcdonald/i, "McDonald's"],
  [/vodafone/i, 'Vodafone'],
  [/movistar|telefonica/i, 'Movistar'],
  [/\borange\b/i, 'Orange'],
  [/sequra/i, 'SeQura'],
  [/\bpepper\b/i, 'Pepper'],
  [/carfax/i, 'Carfax'],
  [/lidl/i, 'Lidl'],
  [/carrefour/i, 'Carrefour'],
  [/\bdia\s*\d/i, 'Dia'],
  [/simply\s*mercado|hipersimply/i, 'Simply'],
  [/decathlon/i, 'Decathlon'],
  [/amazon/i, 'Amazon'],
  [/repsol/i, 'Repsol'],
  [/cepsa/i, 'Cepsa'],
];

/* De un texto en MAYÚSCULAS DE BANCO a algo que se lee. No toca las marcas que ya
   vienen bien escritas ni las siglas cortas. */
const ENLACES = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'al', 'un', 'una', 'por', 'con']);
function bonito(texto) {
  return texto
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => {
      /* "EL SABOR DE MI TIERRA" no se lee como "EL Sabor DE MI Tierra". Las
         palabras de enlace se quedan en minúscula salvo que abran el nombre. */
      if (i > 0 && ENLACES.has(p)) return p;
      if (/\d/.test(p)) return p.toUpperCase();
      if (p.length <= 2) return p.charAt(0).toUpperCase() + p.slice(1);
      /* "E.S." y "S.L." se quedan como están: son siglas, no palabras. */
      if (/^(?:[a-záéíóúñ]\.){1,4}[a-záéíóúñ]?$/i.test(p)) return p.toUpperCase();
      /* "SUP.ALTOARAG.BARBASTRO" viene pegado con puntos; se separa para poder
         leerlo, que es justo lo que se le pide a un nombre bonito. */
      if (p.includes('.')) {
        return p
          .split('.')
          .filter(Boolean)
          .map((x) => (x.length <= 2 ? x.toUpperCase() : x.charAt(0).toUpperCase() + x.slice(1)))
          .join('. ');
      }
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(' ')
    .trim();
}

/* El tipo de movimiento, leído del prefijo que pone el banco. Es lo primero que se
   mira porque manda sobre el nombre: un Bizum a alguien que se llama "Pizzeria" no
   es una cena, es un Bizum. */
export function tipoMovimiento(descripcion) {
  const d = String(descripcion || '');
  if (/^bizum\s+enviado/i.test(d)) return 'bizum_enviado';
  if (/^bizum\s+recibido/i.test(d)) return 'bizum_recibido';
  if (/^bizum/i.test(d)) return 'bizum';
  if (/reintegro\s+cajero|retirada\s+(de\s+)?efectivo|disposici[oó]n\s+cajero/i.test(d)) return 'cajero';
  if (/ingreso\s+efectivo/i.test(d)) return 'ingreso_efectivo';
  if (/^n[oó]mina/i.test(d)) return 'nomina';
  if (/transferencia|traspaso/i.test(d)) return 'transferencia';
  if (/^devol\./i.test(d)) return 'devolucion';
  if (/^recibo\b/i.test(d)) return 'recibo';
  if (/^op\.tarj/i.test(d)) return 'tarjeta';
  return 'otro';
}

/* El nombre limpio del comercio. La descripción original no se toca nunca: esto va
   a una columna aparte precisamente para poder rehacerlo si mejora. */
export function normalizarComercio(descripcion, comercio = null) {
  const crudo = String(comercio || descripcion || '').trim();
  if (!crudo) return null;

  const tipo = tipoMovimiento(descripcion);
  if (tipo === 'bizum_enviado' || tipo === 'bizum_recibido' || tipo === 'bizum') {
    /* "BIZUM ENVIADO : 122871718113 MOHAMED LAMINE A. 760918191548264" → la persona. */
    const m = crudo.match(/bizum\s+(?:enviado|recibido)\s*:?\s*\d*\s*(.+?)\s*\d{9,}\s*$/i)
      || crudo.match(/bizum\s+(?:enviado|recibido)\s*:?\s*\d*\s*(.+)$/i);
    const quien = m ? m[1].trim() : '';
    return quien ? `Bizum · ${bonito(quien)}` : 'Bizum';
  }
  if (tipo === 'cajero') return 'Cajero';
  if (tipo === 'ingreso_efectivo') return 'Ingreso en efectivo';
  if (tipo === 'nomina') {
    const m = crudo.match(/n[oó]mina[s]?\s+(?:nominas?\s+)?(.+)$/i);
    return m ? `Nómina · ${bonito(m[1])}` : 'Nómina';
  }

  let t = crudo
    .replace(PREFIJO_TARJETA, '')
    .replace(/^recibo\s+/i, '')
    .replace(/^s\/ord\.transferencia\s+/i, '')
    .replace(ID_FINAL, '')
    .replace(FECHA_SUELTA, '')
    .replace(PASARELAS, '')
    .replace(/\s+/g, ' ')
    .trim();

  /* "SeQura - BARCELONA" → "SeQura". Solo si lo de delante ya dice algo: no vale
     quedarse sin nombre por quitar la ciudad. */
  const sinCiudad = t.replace(CIUDAD_FINAL, '').trim();
  if (sinCiudad.length >= 3) t = sinCiudad;

  t = t.replace(/[\s.,;:\-*]+$/, '').trim();
  if (!t) return null;

  for (const [re, nombre] of MARCAS) if (re.test(t)) return nombre;
  return bonito(t);
}

/* Las reglas deterministas. Cada una es un par patrón → categoría, y se recorren en
   orden: lo específico antes que lo general. Los `\b` no son decorativos: sin ellos
   "BAR" casa con "BARBASTRO" y media ciudad se convierte en cañas. */
const REGLAS = [
  // Suscripciones digitales: muy reconocibles, van primero.
  [/netflix|spotify|disney\s*(\+|plus|mine)|hbo\s*max|prime\s*video|apple\.com\/bill|itunes|icloud|google\s*one|youtube\s*premium|openai|chatgpt|anthropic|claude\.ai|adobe|microsoft\s*365|dropbox|canva|patreon|duolingo/i, 'Suscripciones'],

  // Gasolineras y transporte.
  [/repsol|cepsa|\bgalp\b|\bshell\b|petroprix|ballenoil|plenoil|gasolinera|benzinera|carburant|estacion\s+de\s+servicio|(?:^|\s)e\.\s?s\.?(?=\s|,|$)/i, 'Transporte'],
  [/\btaxi\b|\buber\b|cabify|bolt\.eu|\brenfe\b|\balsa\b|avanza\s*bus|autobus|parking|aparcamiento|\bpeaje\b|autopista|\bitv\b|carfax|mutua.*automovil|seguro.*coche|\btalleres?\b|neumatic/i, 'Transporte'],

  // Comer fuera antes que alimentación: "pizzeria" no es un supermercado.
  [/\bkebab\b|\bd[oö]ner\b|pizza|pizzer|hamburgues|\bburger\b|mcdonald|\bkfc\b|telepizza|domino|\bsushi\b|\bwok\b|\btapas\b|braser|asador|\bgrill\b|creper|xurrer|churrer|heladeria|\bgelat|cafeter|\bcafé\b|\bcafe\b|restaurant|\brte\.?\b|\bbar\b|\bbares\b|cerveceria|taberna|\bmeson\b|\bpub\b|vending|\bmenu\s+del\s+dia\b/i, 'Comer fuera'],

  // Supermercados y comida para casa.
  [/mercadona|\blidl\b|carrefour|\baldi\b|\bdia\s*\d|consum|eroski|alcampo|\bsimply\b|supermerc|supermarket|\bsuper\b|\bhiper\b|alimentac|\balim\b|coaliment|altoarag|fruteria|carnicer|pescader|panader|\bpan\b|mister\s*pan|chucher|\becobox\b|\b7days\b|ultramarinos|charcuter/i, 'Alimentación'],

  // Salud.
  [/farmacia|parafarmacia|\bclinica\b|dentista|\bdental\b|\boptic|hospital|\bmedic|fisioterap|podolog|analisis\s+clinic|\bveterinar/i, 'Salud'],

  // Gimnasio.
  [/\bgym\b|gimnasio|fitness|crossfit|basic-?fit|altafit|synergym|musculac|\bpilates\b/i, 'Gimnasio'],

  // Viajes.
  [/booking\.com|airbnb|\bhotel\b|\bhostal\b|\bhospeda|ryanair|vueling|iberia\.com|easyjet|\bcamping\b|\bparador\b|expedia|trivago|\bairport\b|aeropuerto/i, 'Viajes'],

  // Hogar y servicios de casa.
  [/leroy\s*merlin|bricomart|\bikea\b|ferreter|endesa|iberdrola|naturgy|\bholaluz\b|\bagua\b|vodafone|movistar|telefonica|\borange\b|\byoigo\b|\bdigi\b|masmovil|telecon|locutorio|\btelefonia\b|seguro\s+hogar|comunidad\s+de\s+propietarios|\balquiler\b/i, 'Hogar'],

  // Ocio.
  [/\bcine\b|cinema|teatro|discotec|atraccion|\bferia\b|fiestas|\bpiscina|bolera|karting|\bmuseo\b|concierto|entradas|ticketmaster|megajuegos|scalextric|gomilandia|\bjuguet|\bocio\b|parque\s+de\s+atracciones/i, 'Ocio'],

  // Compras.
  [/\bzara\b|pull\s*&?\s*bear|bershka|stradivarius|\bmango\b|\bh\s*&\s*m\b|zalando|\bshein\b|primark|decathlon|sprinter|\bjd\s*sports\b|mediamarkt|worten|\bfnac\b|\bamazon\b|aliexpress|\bsequra\b|\bklarna\b|\bpepper\b|floristeria|relojeria|joyeria|perfumeria|\bnovedades\b|\bbazar\b/i, 'Compras'],
];

/* Nivel 1: reglas deterministas. Devuelve null cuando no lo tiene claro — que es
   la mitad del trabajo. */
export function clasificarPorRegla({ description = '', merchant = null, amount = 0, normalized = null } = {}) {
  const tipo = tipoMovimiento(description);
  const importe = Number(amount) || 0;

  /* El tipo de movimiento manda sobre el comercio. */
  if (tipo === 'bizum_enviado' || tipo === 'bizum_recibido' || tipo === 'bizum')
    return { category: 'Transferencias / Bizum', source: 'rule', confidence: 1, reason: 'Bizum' };
  if (tipo === 'cajero' || tipo === 'ingreso_efectivo')
    return { category: 'Efectivo', source: 'rule', confidence: 1, reason: 'Movimiento de cajero' };
  if (tipo === 'nomina')
    return { category: 'Ingresos', source: 'rule', confidence: 1, reason: 'Nómina' };
  if (tipo === 'transferencia')
    return { category: 'Transferencias / Bizum', source: 'rule', confidence: 1, reason: 'Transferencia' };

  const texto = [normalized || '', merchant || '', String(description || '').replace(PREFIJO_TARJETA, '')].join(' ');
  for (const [re, categoria] of REGLAS) {
    if (re.test(texto)) return { category: categoria, source: 'rule', confidence: 1, reason: 'Comercio conocido' };
  }

  /* Un ingreso suelto que no es nómina ni Bizum: al menos se sabe que entra dinero.
     No se afina más porque no hay con qué. */
  if (importe > 0 && tipo !== 'devolucion')
    return { category: 'Ingresos', source: 'rule', confidence: 0.6, reason: 'Entrada de dinero sin origen conocido' };

  return null;
}

/* La clave con la que se recuerda una corrección. Dos movimientos del mismo sitio
   tienen que producir la misma clave aunque el banco les ponga ids distintos. */
export function claveComercio(normalized) {
  return String(normalized || '')
    .toLowerCase()
    .normalize('NFD')
    /* Quita los diacríticos ya separados por NFD: "Nómina" y "Nomina" tienen que
       dar la misma clave o una corrección no se reconocería a sí misma. */
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9· ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
