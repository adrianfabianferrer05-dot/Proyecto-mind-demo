/* Gym → Cuerpo: the anatomy itself.

   One front-view athletic figure drawn on a 260×600 grid with the spine at x=130.
   Only the LEFT half is authored; the right half is the same path data mirrored with
   matrix(-1 0 0 1 260 0). That guarantees a perfectly symmetric body and halves the
   geometry. Every part that crosses the centre line (head, neck, torso) closes flat
   against x=130, so the two halves fuse into one shape with no visible seam — which
   is also why the body outline is painted UNDER the fill, never over it.

   SHELL  — the dark body: head, neck, torso, arms, hands, legs, feet.
   DETAIL — hairline creases on the shell itself (knuckles, toes, kneecap, clavicle).
   MUSCLES[group]
       mass  : filled muscle bellies, inset from the shell so dark gaps separate them
       def   : separation strokes that only surface once the zone is well developed
       mid   : strokes on the centre line, drawn once instead of mirrored
       thumb : viewBox that crops this same figure into the zone's list thumbnail

   Exposed as window.GYM_ANATOMY so gym-body.js stays about data and rendering. */
(function(){
  /* Mirrored about x=129.7 rather than x=130, so the right half overlaps the left by
     a hair. Meeting on an exact edge antialiases into a visible seam, and leaving a
     gap would expose the outline stroke that runs under the fill. */
  const MIRROR='matrix(-1 0 0 1 259.4 0)';

  const SHELL=[
    /* head */
    'M130 12C114 12 103 24 103 42 103 54 106 64 112 71 116 76 122 80 130 80Z',
    /* neck */
    'M130 72H118C118 82 117 93 113 104H130Z',
    /* torso: trapezius diagonal → deltoid cap → armpit → lat → waist → hip → groin */
    'M130 92 120 94C114 102 106 112 94 121 78 130 59 139 53 152 48 165 49 178 55 187 63 195 73 197 81 203 89 212 93 230 95 246 96 258 93 266 92 274 91 284 88 292 89 302 93 310 105 314 119 312 125 311 128 311 130 310Z',
    /* upper arm */
    'M60 148C48 170 41 196 41 218 41 234 44 248 49 256 55 263 66 262 70 254 75 242 76 226 76 208 76 186 78 164 80 148 74 138 64 138 60 148Z',
    /* forearm */
    'M49 250C39 266 34 288 34 308 34 326 37 342 41 352 45 359 57 359 60 352 63 342 65 326 65 308 66 288 68 266 69 250 65 240 53 240 49 250Z',
    /* hand */
    'M45 344C39 352 36 364 36 374 36 383 40 389 46 389 52 389 58 387 62 381 66 374 67 360 64 351 61 344 52 341 45 344Z',
    /* leg: hip → quad sweep → knee → calf → shin → ankle */
    'M88 288C80 310 78 338 82 362 86 386 92 404 96 420 99 432 94 442 94 458 94 476 100 494 104 510L104 518H121C121 506 120 494 120 482 119 468 118 468 119 456 120 440 119 430 119 420 119 404 121 386 123 366 125 342 127 314 125 292Z',
    /* foot */
    'M106 512H120C121 522 122 529 124 535 126 542 122 547 114 547H99C93 547 91 542 94 537 100 529 104 520 106 512Z'
  ];

  /* Creases that give the dark shell its own read even with no progress logged. */
  const DETAIL=[
    'M44 352C43 364 43 376 45 385','M53 348C53 362 53 374 54 383','M61 350C61 360 61 370 61 378',
    'M107 526C108 532 109 538 110 543','M114 522C116 528 117 535 118 540',
    'M99 418C105 422 114 423 121 420',
    'M112 71C116 77 122 81 130 82','M118 104C114 112 106 119 95 126'
  ];

  const MUSCLES={
    shoulders:{
      /* deltoid: lateral head plus the anterior head that tucks toward the chest */
      mass:['M84 124C69 130 57 142 53 157 49 171 53 182 62 187 72 192 81 185 84 173 87 155 89 136 84 124Z',
            'M94 134C88 142 85 154 86 166 87 176 90 182 95 184 98 175 98 154 96 140Z'],
      def:['M68 134C61 148 58 164 61 180','M80 128C76 145 75 164 78 182'],
      mid:[],
      thumb:'60 85 140 140'
    },
    chest:{
      mass:['M128 130C117 124 102 129 95 140 87 152 87 166 92 178 98 190 110 196 124 194 127 193 128 191 128 187Z'],
      def:['M96 143C105 157 115 167 126 172','M91 171C101 186 112 193 126 192','M104 133C108 142 114 149 122 153'],
      mid:['M130 127V195'],
      thumb:'65 95 130 130'
    },
    back:{
      /* what the back shows from the front: the trapezius ridge and the lat wing */
      mass:['M126 100C124 108 118 115 108 120 100 124 93 128 89 132 96 136 105 133 113 128 121 122 125 113 126 106Z',
            'M79 192C92 193 102 202 105 216 107 232 104 252 100 268 97 272 93 268 88 258 83 244 78 226 76 206 75 200 76 194 79 192Z'],
      def:['M96 206C94 224 95 246 98 264'],
      mid:[],
      thumb:'55 105 150 150'
    },
    core:{
      /* three rectus rows, the lower V and the oblique flank */
      mass:['M109 198H122A5 5 0 0 1 127 203V214A5 5 0 0 1 122 219H109A5 5 0 0 1 104 214V203A5 5 0 0 1 109 198Z',
            'M110 223H122A5 5 0 0 1 127 228V239A5 5 0 0 1 122 244H110A5 5 0 0 1 105 239V228A5 5 0 0 1 110 223Z',
            'M112 248H122A5 5 0 0 1 127 253V263A5 5 0 0 1 122 268H112A5 5 0 0 1 107 263V253A5 5 0 0 1 112 248Z',
            'M114 273C118 285 122 293 128 298V273Z',
            'M102 228C96 238 93 252 93 266 93 276 96 284 101 288 103 274 103 248 102 228Z'],
      def:[],
      mid:['M130 197V300'],
      thumb:'70 185 120 120'
    },
    arms:{
      /* biceps, the triceps edge behind it, and the forearm mass */
      mass:['M70 174C61 186 57 202 57 218 57 232 61 243 68 245 74 244 76 232 76 217 75 199 74 186 70 174Z',
            'M54 180C47 194 44 210 45 224 46 234 48 242 52 245 54 236 52 218 52 202 53 190 54 184 54 180Z',
            'M58 258C47 272 41 292 41 312 41 330 44 342 48 350 53 354 59 349 61 341 63 327 64 309 64 291 65 274 63 262 60 256Z'],
      def:['M68 190C65 206 65 224 68 240','M52 272C48 290 47 310 49 328'],
      mid:[],
      thumb:'30 140 200 200'
    },
    legs:{
      /* one quadriceps belly and one calf belly per side; the heads are separated by
         definition strokes instead of by gaps, so the leg never reads as loose tubes */
      mass:['M122 308C108 310 97 322 93 341 89 360 92 379 100 393 106 399 114 397 118 388 120 375 122 344 122 308Z',
            'M119 428C110 430 102 438 98 452 94 468 96 486 102 498 108 504 115 500 118 490 120 470 120 448 119 428Z'],
      def:['M107 316C100 338 98 362 102 388','M119 364C112 371 109 384 111 396','M108 436C104 456 104 478 108 494'],
      mid:[],
      thumb:'55 325 150 150'
    }
  };

  const ORDER=['chest','back','shoulders','arms','core','legs'];

  /* Emits the left half and its mirror, so callers never think about symmetry.
     The mirror lives on a wrapping <g>, never on the paths themselves: the muscle
     paths carry a CSS transform for their growth scale, and a CSS transform would
     override a transform attribute on the same element. */
  function both(paths,cls){
    if(!paths||!paths.length)return '';
    const inner=paths.map(d=>`<path${cls?` class="${cls}"`:''} d="${d}"/>`).join('');
    return `<g>${inner}</g><g transform="${MIRROR}">${inner}</g>`;
  }
  /* Flat version for <clipPath>, which only accepts shape elements, no groups. */
  function flat(paths){
    return (paths||[]).map(d=>`<path d="${d}"/><path d="${d}" transform="${MIRROR}"/>`).join('');
  }
  /* Centre-line strokes: drawn once, because mirroring them would double the line. */
  function once(paths,cls){
    return (paths||[]).map(d=>`<path${cls?` class="${cls}"`:''} d="${d}"/>`).join('');
  }

  window.GYM_ANATOMY={MIRROR,SHELL,DETAIL,MUSCLES,ORDER,both,flat,once};
})();
