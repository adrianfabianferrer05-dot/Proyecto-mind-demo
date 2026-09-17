/* Load gym enhancements in order: planned weights, active-workout navigation, then muscle progress. */
(function(){
  const load=src=>new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=src;
    s.onload=resolve;
    s.onerror=()=>reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
  load('./gym-weights-core.js?v=1')
    .then(()=>load('./gym-nav.js?v=1'))
    .then(()=>load('./gym-body.js?v=1'))
    .catch(err=>console.error('[Segunda Mente Gym]',err));
})();
