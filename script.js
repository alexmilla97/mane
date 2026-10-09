// ╔═══════════════════════════════════════════════════════════════╗
// ║               GESTOR DE TORNEOS — script.js                  ║
// ╠═══════════════════════════════════════════════════════════════╣
// ║  Índice de secciones:                                         ║
// ║                                                               ║
// ║   1. FIREBASE — Configuración e inicialización                ║
// ║   2. AUTENTICACIÓN Y ADMIN                                    ║
// ║      2.1  Vista de administrador                              ║
// ║      2.2  Publicar torneo                                     ║
// ║      2.3  Login / Logout                                      ║
// ║   3. VISTA PÚBLICA                                            ║
// ║   4. UTILIDADES                                               ║
// ║      4.1  Parámetros de URL                                   ║
// ║      4.2  Helpers DOM                                         ║
// ║      4.3  Helpers Firestore                                   ║
// ║   5. MODO DISPOSITIVO (iPad / pantalla externa)               ║
// ║   6. ESTADO GLOBAL Y SESIÓN                                   ║
// ║      6.1  Variables globales                                  ║
// ║      6.2  Identificador de sesión                             ║
// ║      6.3  Persistencia de torneos                             ║
// ║   7. COLA GLOBAL Y DISPOSITIVOS                               ║
// ║      7.1  Persistencia de cola                                ║
// ║      7.2  Envío a dispositivos                                ║
// ║      7.3  Estado de cola para UI                              ║
// ║      7.4  Añadir / quitar de la cola                         ║
// ║      7.5  Botón de cola en el panel de marcadores            ║
// ║   8. PANTALLA DE CONFIGURACIÓN (Setup)                        ║
// ║   9. FASE DE GRUPOS                                           ║
// ║  10. EMPAREJAMIENTOS Y CUADRO ELIMINATORIO                    ║
// ║      10.1 Panel de puntuación del bracket                     ║
// ║  11. PANTALLA DE VISUALIZACIÓN                                ║
// ║      11.1 Pantalla completa                                   ║
// ║  12. INICIALIZACIÓN                                           ║
// ║      12.1 Exponer funciones al HTML                           ║
// ║      12.2 Auth reactivo                                       ║
// ║  13. GENERACIÓN DE PDF (Pegatinas)                            ║
// ╚═══════════════════════════════════════════════════════════════╝

// ═══════════════════════════════════════════════════════
// 1. FIREBASE — Configuración e inicialización
// ═══════════════════════════════════════════════════════
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection, getDocs, deleteDoc, serverTimestamp, addDoc, runTransaction, arrayUnion, arrayRemove, updateDoc, deleteField }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth, signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyC8nmmUQou1hQWF0Br9Y329nTL2ryrWacc",
  authDomain: "torneo-786bf.firebaseapp.com",
  projectId: "torneo-786bf",
  storageBucket: "torneo-786bf.firebasestorage.app",
  messagingSenderId: "377393317767",
  appId: "1:377393317767:web:a11fcfb4c8153e62b83522"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);

// Persistencia permanente — la sesión sobrevive a F5, cierres de pestaña, reinicios del navegador
// Solo se cierra con el botón "Cerrar sesión"
await setPersistence(auth, browserLocalPersistence);


// ═══════════════════════════════════════════════════════
// 2. AUTENTICACIÓN Y ADMIN
// ═══════════════════════════════════════════════════════
// ── 2.1 Vista de administrador ─────────────────────────
let isAdmin = false;


function showAdminView(){
  $('public-view').classList.remove('active');
  $('admin-btn').style.display = 'none';
  $('admin-header').style.display = 'flex';

  // Listener de presencia de dispositivos
  if(unsubscribeDevices){ unsubscribeDevices(); unsubscribeDevices=null; }
  unsubscribeDevices = onSnapshot(collection(db,'devices'), snap=>{
    snap.docChanges().forEach(change=>{
      const d = change.doc.data();
      const clientId = d?.clientId || change.doc.id;

      if(change.type==='removed'){
        connectedDevices = connectedDevices.filter(x=>x.clientId!==clientId);
        updateDeviceUI(); return;
      }
      if(!d||d.blocked||!d.clientId) return;

      const existing = connectedDevices.find(x=>x.clientId===clientId);
      // Normalizar currentMatch: payload en Firestore usa 'sessionId', local usa 'sid'
      const rawCm = d.currentMatch||null;
      const normCm = rawCm && rawCm.sessionId && !rawCm.sid ? {...rawCm, sid:rawCm.sessionId} : rawCm;
      if(existing){
        existing.lastSeen = Date.now();
        existing.name = d.name||existing.name;
        if(d.busy && !existing.busy){
          existing.busy = true;
          existing.currentMatch = normCm;
        } else if(!d.busy && existing.busy){
          // Si despachamos un partido a este dispositivo hace menos de 10s, el busy:false
          // es una escritura tardía de ipadSave del partido anterior — ignorarla para evitar
          // que buildAndSaveQueue publique un estado incorrecto en la cola pública.
          if(existing.dispatchedAt && Date.now() - existing.dispatchedAt < 10000){
            // noop: escritura obsoleta, el dispositivo ya tiene el partido nuevo
          } else {
            existing.busy = false;
            existing.currentMatch = null;
            setTimeout(async ()=>{
              await dispatchNextFromQueue();
              if(sessionId && (groupData.groups || state.rounds)){ await buildAndSaveQueue(); updateDeviceUI(); }
            }, 2000);
          }
        }
        // Dispositivo acaba de señalar ready:true — despachar si está libre
        if(d.ready && !existing.ready && !d.busy){
          existing.ready = true;
          setTimeout(async ()=>{
            await dispatchNextFromQueue();
            if(sessionId && (groupData.groups || state.rounds)){ await buildAndSaveQueue(); updateDeviceUI(); }
            // También actualizar cola de otros torneos con dispositivos activos
            const activeSids = [...new Set(connectedDevices.filter(x=>x.busy&&x.currentMatch?.sid).map(x=>x.currentMatch.sid))];
            for(const sid of activeSids) if(sid!==sessionId) await buildAndSaveQueueForSid(sid);
          }, 300);
        }
        existing.ready = !!d.ready;
      } else {
        // Dispositivo nuevo
        if(change.type==='modified'){
          const ts = d.lastSeen?.toMillis?.() || 0;
          if(Date.now()-ts > 120000) return;
        }
        connectedDevices.push({
          clientId:d.clientId, name:d.name, lastSeen:Date.now(),
          busy:!!d.busy, currentMatch:normCm
        });
        $('connect-overlay')?.classList.remove('open');
        toast(`📱 ${d.name} conectado`);
        // Solo despachar cuando el dispositivo confirma ready:true
        if(!d.busy && d.ready){
          setTimeout(async ()=>{
            await dispatchNextFromQueue();
            if(sessionId && (groupData.groups || state.rounds)){ await buildAndSaveQueue(); updateDeviceUI(); }
          }, 500);
        }
      }
      updateDeviceUI();
    });
  });

  // Listener de cola global — siempre sincroniza globalQueue local con Firestore
  if(unsubscribeQueue){ unsubscribeQueue(); unsubscribeQueue=null; }
  unsubscribeQueue = onSnapshot(QUEUE_REF(), snap=>{
    if(!snap.exists()) return;
    globalQueue = snap.data().queue||[];
    if(sessionId && (groupData.groups || state.rounds)){
      if(groupData.groups) renderGroups();
      if(state.rounds) renderBracket();
      updateDeviceUI();
      const otherSids = [...new Set(globalQueue.filter(q=>q.sid!==sessionId).map(q=>q.sid))];
      otherSids.forEach(sid=>buildAndSaveQueueForSid(sid).catch(()=>{}));
    }
  });

  const last = localStorage.getItem('torneoPro_lastSession');
  if(last){
    $('setup-screen').style.display = 'none';
    loadTournament(last);
  } else {
    $('setup-screen').style.display = 'none';
  }
  checkPublishState();
}

// ── 2.2 Publicar torneo ────────────────────────────────
let isPublished = false;

async function checkPublishState(){
  try {
    const snap = await getDoc(doc(db, 'config', 'publishedTorneos'));
    const data = snap.data();
    const ids = data?.sessionIds || [];
    isPublished = sessionId ? ids.includes(sessionId) : false;
    updatePublishBtn();
  } catch(e){}
}

function updatePublishBtn(){
  const btns = [$('publish-btn'), $('publish-btn-bracket')].filter(Boolean);
  btns.forEach(btn => {
    // Mostrar solo si hay torneo activo
    if(!sessionId){
      btn.style.display = 'none';
      btn.classList.remove('published');
      return;
    }
    btn.style.display = 'inline-flex';
    if(isPublished){
      btn.classList.add('published');
      btn.textContent = '✓ Publicado';
    } else {
      btn.classList.remove('published');
      btn.textContent = '📡 Publicar';
    }
  });
}

window.togglePublish = async () => {
  if(!sessionId){ toast('⚠️ Crea o carga un torneo primero'); return; }
  const btns = [$('publish-btn'), $('publish-btn-bracket')].filter(Boolean);
  btns.forEach(b => b.disabled = true);
  try {
    // arrayUnion/arrayRemove son atómicos: dos pestañas de admin publicando a la vez
    // ya no se pisan (antes se leía la lista, se modificaba y se reescribía entera).
    const publish = !isPublished;
    await setDoc(doc(db, 'config', 'publishedTorneos'), {
      sessionIds: publish ? arrayUnion(sessionId) : arrayRemove(sessionId),
      updatedAt: serverTimestamp()
    }, { merge: true });
    isPublished = publish;
    toast(publish ? '📡 Torneo publicado — ya visible para todos' : '🔒 Torneo ocultado al público');
    updatePublishBtn();
  } catch(e){
    toast('⚠️ Error al cambiar estado de publicación');
  } finally {
    btns.forEach(b => b.disabled = false);
  }
};

function showPublicView(){
  $('admin-header').style.display = 'none';
  ['setup-screen','group-screen','tournament-screen','pairing-screen'].forEach(id=>{
    const el=$(id); if(el) el.style.display='none';
  });
  $('public-view').classList.add('active');
  $('admin-btn').style.display = 'block';
  subscribePublicView();
}

// ── 2.3 Login / Logout ─────────────────────────────────
window.openLoginModal  = () => { $('login-error').textContent=''; $('login-modal').classList.add('open'); $('login-email').focus(); };
window.closeLoginModal = () => $('login-modal').classList.remove('open');
window.adminLogout = async () => {
  isAdmin = false; // marcar antes del signOut para que onAuthStateChanged lo procese
  await signOut(auth);
  await signInAnonymously(auth);
  sessionId=null; groupData={}; state={};
  ['group-screen','tournament-screen','pairing-screen'].forEach(id=>$(id).style.display='none');
  $('admin-header').style.display = 'none';
  $('setup-screen').style.display = 'none';
  showPublicView();
  toast('👋 Sesión cerrada');
};
window.doLogin = async () => {
  const email    = $('login-email').value.trim();
  const password = $('login-password').value;
  const btn      = $('login-btn');
  const errEl    = $('login-error');
  if(!email || !password){ errEl.textContent='Introduce email y contraseña.'; return; }
  btn.disabled=true; btn.textContent='Entrando…'; errEl.textContent='';
  try {
    await signInWithEmailAndPassword(auth, email, password);
    closeLoginModal();
    $('login-password').value='';
  } catch(e){
    const msgs = { 'auth/wrong-password':'Contraseña incorrecta.', 'auth/user-not-found':'Email no encontrado.', 'auth/invalid-credential':'Email o contraseña incorrectos.', 'auth/too-many-requests':'Demasiados intentos. Espera un momento.' };
    errEl.textContent = msgs[e.code] || 'Error al iniciar sesión.';
  } finally {
    btn.disabled=false; btn.textContent='Entrar';
  }
};

// Enter en password para hacer login
document.addEventListener('DOMContentLoaded', () => {
  $('login-password')?.addEventListener('keydown', e => { if(e.key==='Enter') window.doLogin(); });
  $('login-email')?.addEventListener('keydown', e => { if(e.key==='Enter') $('login-password').focus(); });
});

// ═══════════════════════════════════════════════════════
// 3. VISTA PÚBLICA
// ═══════════════════════════════════════════════════════
let pubUnsub = null;
let pubTorneosData = {}; // sid -> tData

function subscribePublicView(){
  if(pubUnsub) pubUnsub();
  const pubQueues = {}; // sid -> items[]

  function renderCombinedQueue(){
    const body = $('pub-combined-queue-body'); if(!body) return;
    const queueMap = {};
    // Solo incluir torneos que están publicados Y existen en Firestore
    Object.entries(pubQueues).forEach(([sid, {items, title}]) => {
      if(!pubTorneosData[sid]) return; // torneo eliminado o no cargado aún
      queueMap[sid] = items.map(it => ({ ...it, torneoName: title }));
    });
    const hasActive = Object.values(queueMap).some(items =>
      items.some(it => it.status==='live' || it.status==='queued')
    );
    $('pub-combined-queue').style.display = hasActive ? 'flex' : 'none';
    renderMergedQueue(queueMap, body);
  }

  // Mapa de unsubs activos por torneo { sid: { torneoUnsub, queueUnsub } }
  const activeSubs = {};

  pubUnsub = onSnapshot(doc(db, 'config', 'publishedTorneos'), snap => {
    const data = snap.data();
    const ids = (data?.sessionIds || []).filter(Boolean);

    // Cancelar suscripciones de torneos que ya no están publicados
    Object.keys(activeSubs).forEach(sid => {
      if(!ids.includes(sid)){
        try { activeSubs[sid].torneoUnsub?.(); activeSubs[sid].queueUnsub?.(); } catch(e){}
        delete activeSubs[sid];
        delete pubTorneosData[sid];
        delete pubQueues[sid];
      }
    });

    if(!ids.length){
      $('pub-torneos-list').innerHTML = '';
      $('pub-combined-queue').style.display = 'none';
      $('pub-no-torneo').style.display = 'block';
      $('pub-hero-sub').textContent = 'No hay ningún torneo activo en este momento.';
      renderCombinedQueue();
      return;
    }

    $('pub-no-torneo').style.display = 'none';
    $('pub-hero-sub').textContent = 'Selecciona un torneo para seguirlo en directo.';

    // Suscribirse solo a torneos nuevos (no repetir los que ya tienen sub activa)
    ids.forEach(sid => {
      if(activeSubs[sid]) return; // ya suscrito

      const torneoUnsub = onSnapshot(tourneyRef(sid), tSnap => {
        if(!activeSubs[sid]) return; // ya cancelado
        const tData = tSnap.data();
        if(!tData){
          // Torneo eliminado — limpiar datos
          delete pubTorneosData[sid];
          delete pubQueues[sid];
          renderAllPublicCards(Object.keys(activeSubs));
          renderCombinedQueue();
          return;
        }
        pubTorneosData[sid] = tData;
        renderAllPublicCards(Object.keys(activeSubs));
      });

      const queueUnsub = onSnapshot(queueRef(sid), qSnap => {
        if(!activeSubs[sid]) return; // ya cancelado
        const qData = qSnap.data();
        pubQueues[sid] = parseQueueData(qSnap.data());
        renderCombinedQueue();
      });

      activeSubs[sid] = { torneoUnsub, queueUnsub };
    });

    renderAllPublicCards(ids);
    renderCombinedQueue();
  });
}

function renderAllPublicCards(ids){
  const list = $('pub-torneos-list'); list.innerHTML = '';
  ids.forEach(sid => {
    const tData = pubTorneosData[sid];
    if(!tData) return;
    list.appendChild(buildPublicCard(sid, tData));
  });
}

function buildPublicCard(sid, tData){
  const gd = parseGroupData(tData), st = parseState(tData);
  if(!gd?.title) return document.createElement('div');
  const card = document.createElement('div'); card.className = 'pub-torneo-card';

  // Badges
  const phaseBadges = [];
  if(gd.groups) phaseBadges.push(`<div class="pub-phase-badge groups">Fase de Grupos</div>`);
  if(st?.rounds) phaseBadges.push(`<div class="pub-phase-badge knockout">Eliminatoria</div>`);

  // Stats
  const allM = gd.groups?.flatMap(g=>g.matches) || [];
  const played = allM.filter(m=>m.played).length;
  const statsHtml =
    `<span class="pub-card-stat">👥 ${gd.groups?.length||0} grupos</span>`+
    `<span class="pub-card-stat">🎮 ${played}/${allM.length} partidos</span>`+
    (st?.rounds ? `<span class="pub-card-stat">🏅 Cuadro: ${st.rounds.flat().filter(m=>m.winner).length}/${st.totalMatches||0}</span>` : '');

  const bracketBtn = st?.rounds
    ? `<button class="pub-action-btn bracket" onclick="openBracketOverlay('${sid}')">🏅 Cuadro</button>`
    : '';

  card.innerHTML =
    `<div class="pub-card-header">
      <div class="pub-card-title">${esc(gd.title)}</div>
      <div class="pub-live-badge">● En directo</div>
    </div>
    <div class="pub-phase-badges">${phaseBadges.join('')}</div>
    <div class="pub-card-stats">${statsHtml}</div>
    <div class="pub-card-actions">
      <button class="pub-action-btn standings" onclick="showPubPanel('${sid}','standings')">📊 Clasificación</button>
      ${bracketBtn}
    </div>`;
  return card;
}

window.openBracketOverlay = (sid) => {
  const overlay = $('bracket-overlay');
  const frame = $('bracket-overlay-frame');
  overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
  // Solicitar pantalla completa (sobre todo útil en móvil)
  const requestFs = overlay.requestFullscreen || overlay.webkitRequestFullscreen || overlay.webkitEnterFullscreen;
  if(requestFs){
    try { requestFs.call(overlay).catch(()=>{}); } catch(e){}
  }
  applyBracketOverlaySize();
  frame.onload = () => {
    applyBracketOverlaySize();
    try {
      const doc = frame.contentDocument;
      if(doc){
        const style = doc.createElement('style');
        style.textContent = `#pub-bracket-svg, .bracket-svg { display: none !important; }`;
        doc.head.appendChild(style);
      }
    } catch(e){}
    // Disparar resize inicial varias veces para que fitScale ajuste bien
    const tryResize = () => {
      try { frame.contentWindow?.dispatchEvent(new Event('resize')); } catch(e){}
    };
    setTimeout(tryResize, 200);
    setTimeout(tryResize, 600);
    setTimeout(tryResize, 1500);
    // Después del render inicial, bloquear resize events para permitir zoom sin reescalar
    setTimeout(()=>{
      try {
        const w = frame.contentWindow;
        if(!w) return;
        // Sobreescribir dispatchEvent para ignorar resize events posteriores
        // (el zoom dispara resize, pero no queremos que fitScale se ejecute)
        const origDispatch = w.dispatchEvent.bind(w);
        w.dispatchEvent = function(ev){
          if(ev && ev.type === 'resize') return true; // ignorar
          return origDispatch(ev);
        };
        // También bloquear resize events nativos del navegador
        w.addEventListener('resize', function(e){
          e.stopImmediatePropagation();
        }, true);
      } catch(e){}
    }, 2500);
  };
  frame.src = `${location.pathname}?mode=bracket&session=${sid}`;
  window.addEventListener('resize', applyBracketOverlaySize);
};

window.closeBracketOverlay = () => {
  const overlay = $('bracket-overlay');
  const frame = $('bracket-overlay-frame');
  // Salir de pantalla completa si está activa
  const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
  if(exitFs && (document.fullscreenElement || document.webkitFullscreenElement)){
    try { exitFs.call(document).catch(()=>{}); } catch(e){}
  }
  overlay.style.display = 'none';
  frame.src = 'about:blank';
  document.body.style.overflow = '';
  window.removeEventListener('resize', applyBracketOverlaySize);
};

function applyBracketOverlaySize(){
  const wrap = $('bracket-overlay-wrap');
  const frame = $('bracket-overlay-frame');
  if(!wrap || !frame) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if(vh > vw){
    // Portrait: el wrap rota 90° y sus dimensiones son el viewport intercambiado
    // El iframe dentro del wrap tiene dimensiones landscape naturales
    wrap.style.width  = vh + 'px';
    wrap.style.height = vw + 'px';
    wrap.style.transform = `rotate(90deg) translateY(-${vw}px)`;
    wrap.style.transformOrigin = 'top left';
  } else {
    // Landscape: sin rotación
    wrap.style.width  = vw + 'px';
    wrap.style.height = vh + 'px';
    wrap.style.transform = 'none';
    wrap.style.transformOrigin = '';
  }
  // Forzar recálculo del layout dentro del iframe (líneas del bracket)
  try {
    const tryResize = () => {
      if(frame.contentWindow) frame.contentWindow.dispatchEvent(new Event('resize'));
    };
    setTimeout(tryResize, 300);
    setTimeout(tryResize, 800);
    setTimeout(tryResize, 1500);
  } catch(e){}
}

window.showPubPanel = (sid, tab) => {
  const panel = $('pub-inline-panel');
  panel.style.display = 'flex';
  panel.dataset.tab = tab;
  panel.dataset.sid = sid;
  const titles = { queue:'📋 Siguientes Partidos', standings:'📊 Clasificación', upper:'🏆 Cuadro de Ganadores', lower:'💀 Cuadro de Perdedores' };
  $('pub-inline-title').textContent = titles[tab] || '';
  renderPubPanelContent(sid, tab);
  panel.scrollIntoView({ behavior:'smooth', block:'nearest' });
};

window.closePubPanel = () => {
  $('pub-inline-panel').style.display = 'none';
};

function renderPubPanelContent(sid, tab){
  const cont = $('pub-inline-content'); cont.innerHTML = '';
  const tData = pubTorneosData[sid];
  if(!tData) return;
  if(tab === 'standings'){
    const gd = parseGroupData(tData);
    if(!gd) return;
    const body = document.createElement('div'); body.className='dv-groups'; body.style.cssText='padding:1.2rem;overflow-y:auto;';
    cont.appendChild(body);
    renderPublicStandings(gd, body, isAdmin);
  } else if(tab === 'upper' || tab === 'lower'){
    const st = parseState(tData);
    if(!st?.rounds) return;
    const wrap = document.createElement('div'); wrap.style.cssText='overflow-x:auto;overflow-y:auto;padding:1rem;min-height:300px;';
    cont.appendChild(wrap);
    const savedState = state;
    state = st;
    try {
      if(tab === 'upper'){
        renderPubUpperMobile(wrap, st);
      } else {
        renderPubLowerMobile(wrap, st);
      }
    } catch(e){ console.error('pub bracket render error',e); }
    state = savedState;
  }
}

// Renderizar upper bracket en móvil — lista vertical por rondas
function renderPubUpperMobile(wrap, st){
  const {rounds, gf} = st;
  rounds.forEach((round, ri)=>{
    const label = roundLabel(rounds.length, ri);
    const sec = document.createElement('div');
    sec.style.cssText = 'margin-bottom:1.2rem;';
    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-family:"Barlow Condensed",sans-serif;font-size:0.85rem;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;color:var(--gold);padding:0.4rem 0.6rem;border-bottom:1px solid var(--border);margin-bottom:0.6rem;';
    hdr.textContent = ri === rounds.length - 1 ? 'Final Upper' : label;
    sec.appendChild(hdr);
    const matches = document.createElement('div');
    matches.style.cssText = 'display:flex;flex-direction:column;gap:0.5rem;';
    round.forEach((m, mi)=>{
      if(m.t1?.name === 'BYE' || m.t2?.name === 'BYE') return;
      matches.appendChild(buildMobileMatchCard(m, mi));
    });
    sec.appendChild(matches);
    wrap.appendChild(sec);
  });
  // Gran Final
  if(gf?.t1 && gf?.t2){
    const sec = document.createElement('div');
    sec.style.cssText = 'margin-top:1.2rem;padding-top:1.2rem;border-top:2px solid var(--gold);';
    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-family:"Barlow Condensed",sans-serif;font-size:1rem;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;color:var(--gold);padding:0.4rem 0.6rem;margin-bottom:0.6rem;text-align:center;';
    hdr.textContent = '🏆 Gran Final';
    sec.appendChild(hdr);
    sec.appendChild(buildMobileMatchCard(gf, 0));
    wrap.appendChild(sec);
  }
}

// Renderizar lower bracket en móvil — lista vertical por rondas
function renderPubLowerMobile(wrap, st){
  const lRounds = st.lRounds || [];
  if(!lRounds.length){
    wrap.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">Sin cuadro de perdedores</div>';
    return;
  }
  lRounds.forEach((round, lr)=>{
    const isDropIn = round[0]?.type === 'drop-in';
    const uRound = isDropIn ? (round[0]?.fromUpperRound ?? 0) : null;
    const label = isDropIn ? `Perdedores R${uRound + 1}` : `Lower R${lr + 1}`;
    const sec = document.createElement('div');
    sec.style.cssText = 'margin-bottom:1.2rem;';
    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-family:"Barlow Condensed",sans-serif;font-size:0.85rem;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;color:var(--text-muted);padding:0.4rem 0.6rem;border-bottom:1px solid var(--border);margin-bottom:0.6rem;';
    hdr.textContent = label;
    sec.appendChild(hdr);
    const matches = document.createElement('div');
    matches.style.cssText = 'display:flex;flex-direction:column;gap:0.5rem;';
    round.forEach((m, mi)=>{
      if(m.t1?.name === 'BYE' || m.t2?.name === 'BYE') return;
      matches.appendChild(buildMobileMatchCard(m, mi));
    });
    sec.appendChild(matches);
    wrap.appendChild(sec);
  });
}

// Tarjeta de partido compacta para móvil
function buildMobileMatchCard(m, mi){
  const card = document.createElement('div');
  card.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden;';
  [m.t1, m.t2].forEach(team=>{
    const row = document.createElement('div');
    const isWin = m.winner && team && m.winner.name === team.name;
    const isLos = m.winner && team && m.winner.name !== team.name;
    row.style.cssText = `display:flex;justify-content:space-between;align-items:center;padding:0.55rem 0.8rem;font-size:0.9rem;${isWin?'background:rgba(46,204,113,0.12);color:var(--win);font-weight:700;':''}${isLos?'opacity:0.55;':''}`;
    const name = document.createElement('span');
    name.textContent = team ? team.name : 'Por decidir';
    if(!team) name.style.fontStyle = 'italic';
    row.appendChild(name);
    if(isWin){ const check = document.createElement('span'); check.textContent = '✓'; check.style.cssText='color:var(--win);font-weight:800;'; row.appendChild(check); }
    card.appendChild(row);
  });
  // Separador entre los dos equipos
  card.children[0].style.borderBottom = '1px solid var(--border)';
  return card;
}

function renderMergedQueue(queueMap, body){
  const allItems = Object.values(queueMap).flatMap(items =>
    (items || []).filter(it => it.status === 'live' || it.status === 'queued')
  );
  // Live primero, luego por orden de asignación (assignedAt)
  allItems.sort((a,b) => {
    if(a.status !== b.status) return a.status === 'live' ? -1 : 1;
    return (a.assignedAt||0) - (b.assignedAt||0);
  });
  if(!allItems.length){ body.innerHTML='<div class="qv-empty">Sin partidos asignados</div>'; return; }
  body.innerHTML='';
  let queueIdx = 0;
  allItems.forEach(it => {
    const isLive = it.status === 'live';
    if(!isLive) queueIdx++;
    const div = document.createElement('div'); div.className='qv-item '+(isLive?'live':'queued');
    div.innerHTML =
      `<div class="qv-indicator"><div class="qv-dot ${it.status}"></div><div class="qv-pos-num ${it.status}">${isLive?'En juego':'#'+queueIdx}</div></div>`+
      `<div>`+
        `<div class="qv-teams">${esc(it.t1)}<span class="vs">vs</span>${esc(it.t2)}</div>`+
        `<div class="qv-group">${esc(it.group)}${it.torneoName ? ` · <span style="opacity:0.6">${esc(it.torneoName)}</span>` : ''}</div>`+
      `</div>`+
      (it.devName?`<div class="qv-device"><div class="qv-device-name ${it.status}">${esc(it.devName)}</div><div class="qv-device-lbl">${isLive?'dispositivo':'siguiente en'}</div></div>`:'');
    body.appendChild(div);
  });
}

function renderPublicStandings(data, body, sideBy=false){
  if(!data?.groups) return;
  if(!body) body = $('pub-standings-body');
  body.innerHTML='';
  function buildCard(g, width){
    const st=calcStandings(g).filter(s=>s.team.name!=='BYE');
    const rows=st.map((s,rank)=>{
      const gd=s.GF-s.GA;
      return `<tr${rank===0?' class="dv-row-first"':''}><td><span class="dv-rank${rank===0?' top':''}">${rank+1}</span></td><td class="td-name">${esc(s.team.name)}</td><td>${s.P>0?s.P:'—'}</td><td class="${gd>0?'dv-dg-pos':gd<0?'dv-dg-neg':''}">${s.P>0?(gd>0?'+'+gd:gd):'—'}</td><td><span class="dv-pts">${s.P>0?s.Pts:'—'}</span></td></tr>`;
    }).join('');
    const card=document.createElement('div'); card.className='dv-group-card';
    card.style.cssText=`flex:1 1 ${width};min-width:0;flex-shrink:0;`;
    card.innerHTML=`<div class="dv-group-name">${esc(g.name)}</div><div class="dv-table-wrap"><table class="dv-table"><thead><tr><th style="width:2em">#</th><th class="th-name">Equipo</th><th>PJ</th><th>DG</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    return card;
  }
  const n = data.groups.length;
  if(n === 2 && sideBy){
    // Admin con 2 grupos: lado a lado
    body.classList.add('row-layout');
    data.groups.forEach(g => body.appendChild(buildCard(g, '0')));
  } else {
    // Web pública o más de 2 grupos: apilados verticalmente
    body.classList.remove('row-layout');
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:0.8rem;width:100%;';
    data.groups.forEach(g => col.appendChild(buildCard(g, '100%')));
    body.appendChild(col);
  }
}

window.switchPubTab = (tab) => {
  document.querySelectorAll('.pub-tab').forEach((t,i)=>t.classList.toggle('active', i===(tab==='queue'?0:1)));
  $('pub-panel-queue').classList.toggle('active', tab==='queue');
  $('pub-panel-standings').classList.toggle('active', tab==='standings');
};

// ═══════════════════════════════════════════════════════
// 4. UTILIDADES
// ═══════════════════════════════════════════════════════
// ── 4.1 Parámetros de URL ──────────────────────────────
const params       = new URLSearchParams(location.search);
const IS_DEVICE    = params.has('device');
const IS_DISPLAY   = params.get('mode') === 'display';
const IS_BRACKET   = params.get('mode') === 'bracket';
const IS_QUEUE     = params.get('mode') === 'queue';
const IS_DESIGN    = IS_BRACKET && params.get('design') === '1'; // editor del diseño del cuadro público
const DEVICE_NAME  = IS_DEVICE ? decodeURIComponent(params.get('device') || 'Dispositivo') : null;
const DEVICE_ID    = IS_DEVICE ? params.get('id') : null;
const SESSION_ID   = params.get('session');  // torneo activo

// ── 4.2 Helpers DOM ────────────────────────────────────
const $ = window.$ = id => document.getElementById(id);
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2400); }
// Escapa texto antes de meterlo en innerHTML. Los nombres de jugadores, torneos y
// dispositivos vienen de Firestore / URL y no son de fiar (evita XSS y nombres rotos con < o &).
function esc(v){
  return String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

// ── 4.3 Helpers Firestore ──────────────────────────────
const tourneyRef  = sid => doc(db, 'torneos', sid);
const queueRef    = sid => doc(db, 'torneos', sid, 'meta', 'queue');

async function saveState(sid, groupData, state){
  // Serializar como JSON strings — Firestore no soporta arrays anidados
  const stateJson = JSON.stringify(state);
  const groupDataJson = JSON.stringify(groupData);
  await setDoc(tourneyRef(sid), { groupDataJson, stateJson, updatedAt: serverTimestamp() });
}

function parseGroupData(data){
  if(data.groupDataJson){
    try { return JSON.parse(data.groupDataJson); } catch(e){ return {}; }
  }
  return data.groupData || {}; // compatibilidad con documentos antiguos
}

function parseState(data){
  if(data.stateJson){
    try { return JSON.parse(data.stateJson); } catch(e){ return {}; }
  }
  // Compatibilidad con documentos guardados antes de la migración
  const rawState = data.state || {};
  return {
    ...rawState,
    lRounds: (() => { try { return typeof rawState.lRounds === 'string' ? JSON.parse(rawState.lRounds) : (rawState.lRounds || null); } catch(e){ return null; } })(),
    gf: (() => { try { return typeof rawState.gf === 'string' ? JSON.parse(rawState.gf) : (rawState.gf || null); } catch(e){ return null; } })(),
  };
}
async function saveQueueMeta(sid, items, title){
  await setDoc(queueRef(sid), { itemsJson: JSON.stringify(items), title, updatedAt: serverTimestamp() });
}

function parseQueueData(qData){
  if(!qData) return { items:[], title:'' };
  const items = qData.itemsJson ? (() => { try { return JSON.parse(qData.itemsJson); } catch(e){ return []; } })() : (qData.items||[]);
  return { items, title: qData.title||'' };
}
async function sendToDevice(sid, deviceId, payload){
  await addDoc(collection(db, 'devices', deviceId, 'inbox'), { ...payload, ts: serverTimestamp() });
}

// ═══════════════════════════════════════════════════════
// 5. MODO DISPOSITIVO (iPad / pantalla externa)
// ═══════════════════════════════════════════════════════
if(IS_DEVICE && DEVICE_ID){
  // Solo autenticar si no hay sesión activa — no sobreescribir sesión de admin
  if(!auth.currentUser) await signInAnonymously(auth);
  document.querySelector('header').style.display = 'none';
  ['setup-screen','group-screen','tournament-screen','queue-screen','display-screen']
    .forEach(id => { const el=$(id); if(el) el.style.display='none'; });
  $('ipad-screen').classList.add('active');
  $('ipad-hdr-name').textContent = DEVICE_NAME;

  const dot = $('ipad-ntfy-dot'), st = $('ipad-status-text');
  st.textContent = 'Conectando…';

  let curMatch = null, sc = {s1:0,s2:0}, timerInt = null, startTs = null, running = false, idleReloadTimer = null;

  // Inbox listener — procesa partidos entrantes
  function subscribeInbox(){
    let readySignaled = false;
    onSnapshot(collection(db,'devices',DEVICE_ID,'inbox'), snap => {
      if(!readySignaled){
        readySignaled = true;
        setDoc(doc(db,'devices',DEVICE_ID), { ready: true }, { merge: true })
          .then(()=>{ st.textContent = 'Conectado'; })
          .catch(()=>{});
      }
      snap.docChanges().forEach(async change => {
        if(change.type !== 'added') return;
        const data = change.doc.data();
        const m = data.match;
        if(!m || m.type !== 'match') return;
        deleteDoc(change.doc.ref).catch(()=>{});
        await setDoc(doc(db,'devices',DEVICE_ID), { currentMatch: m, busy: true }, { merge: true }).catch(()=>{});
        showMatch(m);
      });
    });
  }

  try {
    // 1. Leer estado actual
    const devSnap = await getDoc(doc(db,'devices',DEVICE_ID));
    const devData = devSnap.exists() ? devSnap.data() : {};
    const prevMatch = devData?.currentMatch?.type === 'match' ? devData.currentMatch : null;

    // 2. Comprobar inbox pendiente
    const inboxSnap = await getDocs(collection(db,'devices',DEVICE_ID,'inbox'));
    const hasPendingInbox = inboxSnap.docs.some(d => d.data()?.match?.type === 'match');
    const isBusy = !!prevMatch || hasPendingInbox;

    // 3. Registrar con ready:false — el gestor no despachará hasta que el inbox confirme conexión
    await setDoc(doc(db,'devices',DEVICE_ID), {
      clientId: DEVICE_ID, name: DEVICE_NAME,
      lastSeen: serverTimestamp(), blocked: false,
      busy: isBusy, currentMatch: prevMatch || null,
      ready: false
    });

    dot.classList.add('on'); st.textContent = 'Conectando…';

    // 4. Suscribir inbox — el primer snapshot señaliza ready:true al gestor
    subscribeInbox();
    if(prevMatch) showMatch(prevMatch);

  } catch(e){
    console.error('Device setup error', e);
    subscribeInbox();
    st.textContent = 'Error de conexión';
  }

  // Ping cada 30s
  setInterval(async () => {
    try {
      await setDoc(doc(db,'devices',DEVICE_ID), { lastSeen: serverTimestamp() }, { merge: true });
    } catch(e){}
  }, 30000);

  function fmtTime(ms){ const s=ms/1000|0,m=s/60|0,ss=s%60; return ('0'+m).slice(-2)+':'+('0'+ss).slice(-2); }

  function startTimer(){
    if(running) return;
    running=true; startTs=Date.now();
    const el=$('ipad-tmr'); if(el) el.className='ipad-timer running';
    timerInt = setInterval(()=>{ const e=$('ipad-tmr'); if(e&&running) e.textContent=fmtTime(Date.now()-startTs); },500);
    const bs=$('ipad-btn-start'); if(bs) bs.style.display='none';
    const sv=$('ipad-btn-save'); if(sv) sv.style.display='block';
  }
  function stopTimer(){
    running=false; clearInterval(timerInt);
    const el=$('ipad-tmr'); if(el) el.className='ipad-timer stopped';
  }

  function showMatch(data){
    if(idleReloadTimer){ clearTimeout(idleReloadTimer); idleReloadTimer=null; } // cancela recarga por inactividad: llegó un partido
    curMatch=data; sc={s1:0,s2:0}; running=false; clearInterval(timerInt); startTs=null;
    const body=$('ipad-body');
    const torneoTag = data.torneoName
      ? `<div style="font-family:'Barlow Condensed',sans-serif;font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);text-align:center;opacity:0.6;margin-bottom:2px;">${esc(data.torneoName)}</div>` : '';
    const card = document.createElement('div'); card.className='ipad-match-card';
    card.innerHTML = `
      ${torneoTag}
      <div class="ipad-match-group-row">
        <div class="ipad-match-group">${esc(data.group)}</div>
      </div>
      <div class="ipad-timer stopped" id="ipad-tmr">00:00</div>
      <div class="ipad-score-area">
        <div class="ipad-team-row">
          <div class="ipad-team-name">${esc(data.t1)}</div>
          <div class="ipad-score-ctrl">
            <button class="ipad-sc-btn" onclick="ipadMod(-1,1)">−</button>
            <div class="ipad-sc-num" id="ipad-sc1">0</div>
            <button class="ipad-sc-btn" onclick="ipadMod(1,1)">+</button>
          </div>
        </div>
        <div class="ipad-sep">vs</div>
        <div class="ipad-team-row">
          <div class="ipad-team-name">${esc(data.t2)}</div>
          <div class="ipad-score-ctrl">
            <button class="ipad-sc-btn" onclick="ipadMod(-1,2)">−</button>
            <div class="ipad-sc-num" id="ipad-sc2">0</div>
            <button class="ipad-sc-btn" onclick="ipadMod(1,2)">+</button>
          </div>
        </div>
      </div>
      <button class="ipad-save-btn" id="ipad-btn-start" onclick="ipadStart()">▶ Iniciar partido</button>
      <button class="ipad-save-btn" id="ipad-btn-save" onclick="ipadSave()" style="display:none;background:var(--gold)">Guardar resultado ✓</button>
      <div id="ipad-sent-msg" style="display:none;" class="ipad-sent-msg">✓ Resultado enviado</div>`;
    body.replaceChildren(card);
  }

  window.ipadStart = () => startTimer();
  window.ipadMod = (v,n) => {
    if(!curMatch) return;
    if(n===1){ sc.s1=Math.max(0,sc.s1+v); $('ipad-sc1').textContent=sc.s1; }
    else      { sc.s2=Math.max(0,sc.s2+v); $('ipad-sc2').textContent=sc.s2; }
  };
  window.ipadSave = async () => {
    if(!curMatch) return;
    // En eliminatoria no puede haber empate (antes el empate daba la victoria a la pareja A)
    const _isBr = curMatch.matchType==='bracket' || curMatch.type==='bracket';
    if(_isBr && sc.s1===sc.s2){ alert('En eliminatoria no puede haber empate. Corrige el resultado.'); return; }
    stopTimer();
    const btn=$('ipad-btn-save'); btn.disabled=true; btn.textContent='Enviando…';
    const done=curMatch; curMatch=null;
    const sid=done.sessionId;
    try {
      const isBracket = done.matchType==='bracket' || done.type==='bracket';
      const scoreId = String(done.matchId||`${done.sessionId}_${done.gi}_${done.mi}`);
      const winnerName = isBracket ? (sc.s1>=sc.s2 ? done.t1 : done.t2) : null;
      const payload = {
        matchId:done.matchId, sid:done.sessionId,
        t1:done.t1, t2:done.t2, // el gestor comprueba que coinciden con el partido antes de aplicar
        s1:sc.s1, s2:sc.s2,
        from:DEVICE_ID, elapsed:startTs?Date.now()-startTs:0, ts:serverTimestamp()
      };
      if(isBracket){
        payload.type = 'bracket';
        payload.bType = done.bType;
        payload.bRi   = done.bRi;
        payload.bMi   = done.bMi;
        payload.winner = winnerName;
      } else {
        payload.gi = done.gi;
        payload.mi = done.mi;
      }
      await setDoc(doc(db,'scores', scoreId), payload);
      await setDoc(doc(db,'devices',DEVICE_ID), { currentMatch: null, busy: false }, { merge: true });
      $('ipad-sent-msg').style.display='block';
      btn.style.display='none';
      setTimeout(()=>{
        if(!curMatch) $('ipad-body').innerHTML=`
          <div class="ipad-waiting">
            <div class="ipad-waiting-icon">✅</div>
            <div class="ipad-waiting-text">Resultado guardado</div>
            <div class="ipad-waiting-sub">Esperando el próximo partido…</div>
          </div>`;
      },2500);
      // Recargar UNA sola vez tras 10s si seguimos sin partido. showMatch cancela
      // este temporizador en cuanto llega uno nuevo: sin recargas en carrera ni
      // acumulación de intervalos (la versión anterior dejaba un setInterval vivo).
      if(idleReloadTimer) clearTimeout(idleReloadTimer);
      idleReloadTimer = setTimeout(()=>{ if(!curMatch) location.reload(); }, 10000);
    } catch(e){
      curMatch=done; btn.disabled=false; btn.textContent='Guardar resultado ✓';
      alert('Error al guardar. Inténtalo de nuevo.');
    }
  };

  window.ipadToggleFS = () => {
    const el=$('ipad-screen');
    const isFs=!!(document.fullscreenElement||document.webkitFullscreenElement);
    if(!isFs){ const r=el.requestFullscreen||el.webkitRequestFullscreen; if(r) r.call(el).catch(()=>{}); }
    else { const x=document.exitFullscreen||document.webkitExitFullscreen; if(x) x.call(document).catch(()=>{}); }
  };
  ['fullscreenchange','webkitfullscreenchange'].forEach(ev=>document.addEventListener(ev,()=>{
    const btn=$('ipad-fs-btn'); if(!btn) return;
    btn.textContent=!!(document.fullscreenElement||document.webkitFullscreenElement)?'✕':'⛶';
  }));

  throw new Error('device-mode');
}

// ══════════════════════════════════════════════════════
// MODO PANTALLA GRANDE / COLA (pestaña secundaria)
// ══════════════════════════════════════════════════════
// state declarado aquí para que renderBracketDisplay pueda acceder a él
// incluso después del throw que detiene la inicialización del admin
let state = {};
// Vista pública del cuadro (?mode=bracket): listeners globales de reescalado.
// Declarados antes del throw de display-mode para que estén inicializados allí.
let _pubBracketListenersBound = false;
let _pubFitScaleAndLines = null;
// Diseño personalizado del cuadro público (ver sección 11.2)
const LAYOUTS_REF = () => doc(db,'config','bracketLayouts');
let _pubLayouts = null;          // { "16d": {...}, "8s": {...} } — de Firestore
let _pubLastBracketData = null;  // último estado recibido, para repintar al cambiar el diseño
let _designMode = false;         // ?mode=bracket&design=1 con sesión de admin
let _designDraft = null;         // diseño en edición (sin guardar)
let _designKey = null;           // clave del tamaño en edición
let _designSelected = 'upper';   // bloque seleccionado en el panel
let _designDirty = false;        // hay cambios sin guardar
let _pubApplyLayout = null;      // recoloca los bloques sin repintar (arrastre)
const DESIGN_BLOCK_NAMES = { title:'Título', upper:'Cuadro de ganadores', gf:'Gran Final', lower:'Cuadro de perdedores' };
const DESIGN_DEFAULT_COLORS = { accent:'#D4A017', bg:'#0E0E12', card:'#161620', text:'#F0EEE8' };

if((IS_DISPLAY||IS_BRACKET||IS_QUEUE) && (SESSION_ID||IS_QUEUE)){
  if(!auth.currentUser) await signInAnonymously(auth);
  document.querySelector('header').style.display='none';
  ['setup-screen','group-screen','tournament-screen'].forEach(id=>{const el=$(id);if(el)el.style.display='none';});

  if(IS_QUEUE){
    $('queue-screen').classList.add('active');
    const sub=$('qv-subtitle');

    // Caché de último estado live por dispositivo — permite inyectar el partido anterior
    // cuando Firestore emite un estado intermedio sin ningún partido live.
    // El nodo DOM se actualiza en sitio: el borde verde y el dispositivo no parpadean nunca.
    const _lastLiveByDev={};

    function renderQueueItems(allItems, title){
      if(sub) sub.textContent = title || '';
      const body=$('qv-body');
      let active = allItems
        .filter(it => it.status==='live' || it.status==='queued')
        .sort((a,b) => {
          if(a.status !== b.status) return a.status==='live' ? -1 : 1;
          return (a.assignedAt||0) - (b.assignedAt||0);
        });

      // 1. Actualizar caché y cancelar timers de limpieza para dispositivos que están live
      const activeLiveDevs=new Set();
      active.filter(it=>it.status==='live').forEach(it=>{
        const dk=it.devName||'__nodev__';
        activeLiveDevs.add(dk);
        _lastLiveByDev[dk]=it;
        if(_lastLiveByDev[dk+'__t']){clearTimeout(_lastLiveByDev[dk+'__t']);delete _lastLiveByDev[dk+'__t'];}
      });

      // 2. Para cada dispositivo con caché que ha desaparecido del estado actual,
      //    inyectar el último partido conocido como live (elimina el parpadeo).
      const injectItems=[];
      Object.entries(_lastLiveByDev).forEach(([dk,liveItem])=>{
        if(dk.endsWith('__t')||activeLiveDevs.has(dk)) return;
        if(!_lastLiveByDev[dk+'__t']){
          _lastLiveByDev[dk+'__t']=setTimeout(()=>{delete _lastLiveByDev[dk];delete _lastLiveByDev[dk+'__t'];},12000);
        }
        injectItems.push({...liveItem,status:'live'});
      });
      if(injectItems.length) active=[...injectItems,...active];

      const makeKey=it=>it.status==='live'
        ?`__live__${it.devName||'__nodev__'}`
        :(it.bType!=null
          ?`${it.torneoName||''}_b_${it.bType}_${it.bRi}_${it.bMi}`
          :(it.gi!=null&&it.mi!=null?`${it.torneoName||''}_g_${it.gi}_${it.mi}`:`${it.t1}_${it.t2}_${it.group||''}`));

      const existing={};
      body.querySelectorAll('.qv-item[data-key]').forEach(el=>{ existing[el.dataset.key]=el; });

      if(!active.length){
        body.innerHTML='<div class="qv-empty">Sin partidos asignados</div>';
        return;
      }
      const emptyEl=body.querySelector('.qv-empty'); if(emptyEl) emptyEl.remove();

      let qIdx=0;
      const usedKeys=new Set();
      const orderedEls=[];

      active.forEach(it=>{
        const isLive=it.status==='live';
        if(!isLive) qIdx++;
        const key=makeKey(it); usedKeys.add(key);
        const cls=isLive?'live':'queued';
        const posText=isLive?'En juego':'#'+qIdx;
        let el=existing[key];
        if(el){
          const wantCls='qv-item '+cls; if(el.className!==wantCls) el.className=wantCls;
          const dot=el.querySelector('.qv-dot'); if(dot){const dc='qv-dot '+cls;if(dot.className!==dc)dot.className=dc;}
          const posEl=el.querySelector('.qv-pos-num'); if(posEl){const pc='qv-pos-num '+cls;if(posEl.className!==pc)posEl.className=pc;if(posEl.textContent!==posText)posEl.textContent=posText;}
          const teamsEl=el.querySelector('.qv-teams');
          if(teamsEl){const th=`${esc(it.t1)}<span class="vs">vs</span>${esc(it.t2)}`;if(teamsEl.innerHTML!==th){teamsEl.style.opacity='0';teamsEl.innerHTML=th;requestAnimationFrame(()=>{teamsEl.style.opacity='';});}}
          const groupEl=el.querySelector('.qv-group');
          if(groupEl){const gh=it.torneoName?`<span style="color:var(--gold);opacity:0.8">${esc(it.torneoName)}</span> · ${esc(it.group)}`:esc(it.group);if(groupEl.innerHTML!==gh){groupEl.style.opacity='0';groupEl.innerHTML=gh;requestAnimationFrame(()=>{groupEl.style.opacity='';});}}
          let devDiv=el.querySelector('.qv-device');
          if(it.devName){
            if(!devDiv){devDiv=document.createElement('div');devDiv.className='qv-device';
              devDiv.innerHTML=`<div class="qv-device-name qv-device-name--admin ${cls}">${esc(it.devName)}</div><div class="qv-device-lbl">${isLive?'dispositivo':'siguiente en'}</div>`;
              el.appendChild(devDiv);
            } else {
              const dn=devDiv.querySelector('.qv-device-name');
              if(dn){const dc2=`qv-device-name qv-device-name--admin ${cls}`;if(dn.className!==dc2)dn.className=dc2;if(dn.textContent!==it.devName)dn.textContent=it.devName;}
              const dl=devDiv.querySelector('.qv-device-lbl');const lbl=isLive?'dispositivo':'siguiente en';if(dl&&dl.textContent!==lbl)dl.textContent=lbl;
            }
          } else if(devDiv){ devDiv.remove(); }
        } else {
          el=document.createElement('div'); el.className='qv-item '+cls; el.dataset.key=key;
          el.innerHTML=`<div class="qv-indicator"><div class="qv-dot ${cls}"></div><div class="qv-pos-num ${cls}">${posText}</div></div>`+
            `<div><div class="qv-teams">${esc(it.t1)}<span class="vs">vs</span>${esc(it.t2)}</div>`+
            `<div class="qv-group">${it.torneoName?`<span style="color:var(--gold);opacity:0.8">${esc(it.torneoName)}</span> · `:''}${esc(it.group)}</div></div>`+
            (it.devName?`<div class="qv-device"><div class="qv-device-name qv-device-name--admin ${cls}">${esc(it.devName)}</div><div class="qv-device-lbl">${isLive?'dispositivo':'siguiente en'}</div></div>`:'');
        }
        orderedEls.push(el);
      });
      Object.entries(existing).forEach(([k,el])=>{ if(!usedKeys.has(k)) el.remove(); });
      orderedEls.forEach((el,i)=>{ const cur=body.children[i]; if(cur!==el) body.insertBefore(el,cur||null); });
    }

    // Debounce de 120ms — absorbe estados intermedios de Firestore antes de pintar
    let _qTimer = null;
    function scheduleRender(allItems, title){
      clearTimeout(_qTimer);
      _qTimer = setTimeout(()=>renderQueueItems(allItems, title), 120);
    }

    if(SESSION_ID){
      // Cola de un torneo específico (compatibilidad)
      onSnapshot(queueRef(SESSION_ID), snap=>{
        const data=snap.data();
        const {items, title} = parseQueueData(data);
        scheduleRender(items, title);
      });
    } else {
      // Cola combinada de todos los torneos publicados
      const pubQueuesLocal = {};
      const pubQueueUnsubs = {}; // sid -> unsubscribe del listener de su cola
      function mergAndRender(){
        const allItems=[];
        Object.entries(pubQueuesLocal).forEach(([sid,{items,title}])=>{
          items.forEach(it=>allItems.push({...it,torneoName:title}));
        });
        scheduleRender(allItems, 'Todos los torneos');
      }
      onSnapshot(doc(db,'config','publishedTorneos'), snap=>{
        const ids=(snap.data()?.sessionIds||[]).filter(Boolean);
        // Limpiar torneos ya no publicados: cancelar su listener (antes seguía vivo y
        // volvía a meter el torneo en la cola; al republicar se duplicaba).
        Object.keys(pubQueueUnsubs).forEach(sid=>{
          if(ids.includes(sid)) return;
          try{ pubQueueUnsubs[sid](); }catch(e){}
          delete pubQueueUnsubs[sid];
          delete pubQueuesLocal[sid];
        });
        if(!ids.length){ scheduleRender([],''); return; }
        ids.forEach(sid=>{
          if(pubQueueUnsubs[sid]) return;
          pubQueuesLocal[sid]={items:[],title:''};
          pubQueueUnsubs[sid] = onSnapshot(queueRef(sid), qSnap=>{
            if(!pubQueueUnsubs[sid]) return; // ya despublicado
            pubQueuesLocal[sid] = parseQueueData(qSnap.data());
            mergAndRender();
          });
        });
        mergAndRender();
      });
      // Refresh bajo demanda — escucha evento 'refreshQueue' desde el gestor o dispositivo
      async function forceRefresh(){
        try{
          const pubSnap = await getDoc(doc(db,'config','publishedTorneos'));
          const ids = (pubSnap.data()?.sessionIds||[]).filter(Boolean);
          for(const sid of ids){
            const qSnap = await getDoc(queueRef(sid));
            if(qSnap.exists()) pubQueuesLocal[sid] = parseQueueData(qSnap.data());
          }
          mergAndRender();
        }catch(e){}
      }
      // Escuchar mensajes del gestor/dispositivo en la misma pestaña o broadcast
      window.addEventListener('refreshQueue', forceRefresh);
      // También via BroadcastChannel para pestañas diferentes
      try{
        const bc = new BroadcastChannel('torneoPro_queue');
        bc.onmessage = ()=>forceRefresh();
      }catch(e){}
    }
  } else {
    $('display-screen').classList.add('active');
    if(IS_BRACKET){
      // Diseños personalizados del cuadro (uno por tamaño). Al cambiar, se repinta.
      onSnapshot(LAYOUTS_REF(), snap=>{
        _pubLayouts = snap.data()?.layouts || {};
        if(_pubLastBracketData && !_designMode) renderBracketDisplay(_pubLastBracketData);
      }, ()=>{ _pubLayouts = {}; });
      // Modo diseño (?design=1): solo para el admin con sesión iniciada
      if(IS_DESIGN){
        if(auth.currentUser && !auth.currentUser.isAnonymous) _designMode = true;
        else setTimeout(()=>toast('⚠️ Inicia sesión como admin en el gestor para editar el diseño'), 800);
      }
    }
    onSnapshot(tourneyRef(SESSION_ID), snap=>{
      const data=snap.data();
      if(!data) return;
      if(IS_BRACKET && data.stateJson || IS_BRACKET && data.state?.rounds){
        const parsedState = parseState(data);
        if(parsedState.rounds){ _pubLastBracketData = parsedState; renderBracketDisplay(parsedState); }
      } else if(!IS_BRACKET){ const gd=parseGroupData(data); if(gd?.groups) renderDisplayScreen(gd); }
    });
    if(IS_BRACKET){
      // Ocultar header en vista pública del cuadro
      const hdr = document.querySelector('.dv-header');
      if(hdr) hdr.style.display = 'none';
      document.addEventListener('fullscreenchange',()=>{ window.dispatchEvent(new Event('resize')); });
      // En modo diseño no se fuerza pantalla completa (el panel tiene su propio botón)
      if(!_designMode) setTimeout(()=>{
        const elem=$('display-screen');
        if(elem?.requestFullscreen) elem.requestFullscreen().catch(()=>{});
      },300);
    }
  }
  throw new Error('display-mode')
}

// Variables del gestor — en scope de módulo para acceso desde funciones compartidas
let bracketSize=4, numGroups=2, doubleElim=true;
window._setDoubleElim = v => { doubleElim = v; };
let groupData={}, sessionId=null;
let isFsMode=false, activePanel=null;

// ══════════════════════════════════════════════════════
// MODO GESTOR
// ══════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// ESTADO GLOBAL DE DISPOSITIVOS Y COLA
// ════════════════════════════════════════════════════════════════
//
// connectedDevices: [{clientId, name, lastSeen, busy, currentMatch}]
//   - busy: bool — gestionado solo por el gestor admin (nunca desde Firestore listener)
//   - currentMatch: {gi, mi, sid, assignedAt} o null
//
// globalQueue: [{gi, mi, sid, t1, t2, group, torneoName, assignedAt}]
//   - Cola FIFO global. Un item por partido. Cualquier torneo puede añadir.
//   - Persiste en Firestore: config/globalQueue {queue:[...]}
//
// Reglas:
//   1. busy=true solo lo pone _sendMatchNow (cuando envía un partido)
//   2. busy=false solo lo pone el score handler (cuando recibe resultado)
//   3. El listener de presencia NUNCA modifica busy — solo añade/elimina dispositivos
//   4. La cola no está ligada a ningún torneo — despacha en orden FIFO global
// ════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// 6. ESTADO GLOBAL Y SESIÓN
// ═══════════════════════════════════════════════════════
// ── 6.1 Variables globales ──────────────────────────────
let connectedDevices = [];  // dispositivos conocidos por el gestor
let blockedDevices   = [];  // IDs bloqueados
let globalQueue      = [];  // cola FIFO global [{gi,mi,sid,t1,t2,group,torneoName,assignedAt}]
let unsubscribeSession=null, unsubscribeDevices=null, unsubscribeScores=null, unsubscribeQueue=null;

// ── 6.2 Identificador de sesión ────────────────────────
function genSessionId(){ return 'trn-'+Math.random().toString(36).slice(2,14); }

// ── 6.3 Persistencia de torneos ────────────────────────
let _saveInFlight=false, _savePending=false;
async function saveCurrentTournament(){
  if(!sessionId||!groupData.title) return;
  if(_saveInFlight){ _savePending=true; return; }
  _saveInFlight=true;
  try{
    await saveState(sessionId, groupData, state);
    if(sessionId) localStorage.setItem('torneoPro_lastSession', sessionId);
    updatePublishBtn();
  }catch(e){ console.error('saveCurrentTournament',e); }
  _saveInFlight=false;
  if(_savePending){ _savePending=false; saveCurrentTournament(); }
}

// ═══════════════════════════════════════════════════════
// 7. COLA GLOBAL Y DISPOSITIVOS
// ═══════════════════════════════════════════════════════
// ── 7.1 Persistencia de cola ───────────────────────────
// ════════════════════════════════════════════════════════════════
// COLA GLOBAL — SISTEMA SIMPLE Y ROBUSTO
// ════════════════════════════════════════════════════════════════
//
// Reglas:
// 1. globalQueue en memoria = espejo de config/globalQueue en Firestore
// 2. El listener onSnapshot mantiene globalQueue local sincronizado siempre
// 3. Cada item tiene un matchId único global (config/matchCounter)
// 4. El dispatch marca dev.busy=true localmente ANTES de cualquier await
// 5. Un item en cola que ha sido despachado (busy=true en dev) ya no está en la cola Firestore
//
// Estructura de un item de cola:
//   { matchId, gi, mi, sid, t1, t2, group, torneoName, assignedAt }
// ════════════════════════════════════════════════════════════════

const QUEUE_REF = () => doc(db,'config','globalQueue');

// Notificar a las pestañas de cola pública que deben refrescarse
let _bc = null;
try{ _bc = new BroadcastChannel('torneoPro_queue'); }catch(e){}
function broadcastQueueRefresh(){
  window.dispatchEvent(new Event('refreshQueue'));
  try{ _bc?.postMessage('refresh'); }catch(e){}
}

async function saveGlobalQueue(){
  try{ await setDoc(QUEUE_REF(), { queue: globalQueue, updatedAt: serverTimestamp() }); }
  catch(e){ console.error('saveGlobalQueue',e); }
}

// ID único por partido — timestamp de ms, estrictamente creciente para evitar
// colisiones si se añaden dos partidos en el mismo milisegundo.
let _lastMatchId = 0;
function getNextMatchId(){
  let id = Date.now();
  if(id <= _lastMatchId) id = _lastMatchId + 1;
  _lastMatchId = id;
  return id;
}

// ── 7.2 Envío a dispositivos ───────────────────────────

async function _sendMatchNow(dev, qItem){
  const {sid, t1, t2, group, torneoName, matchId, type, bType, bRi, bMi, gi, mi} = qItem;
  const isBracket = type === 'bracket';
  dev.busy = true;
  dev.currentMatch = {sid, matchId, t1, t2, group, torneoName, assignedAt: Date.now(),
    ...(isBracket ? {type:'bracket', bType, bRi, bMi} : {gi, mi})};
  const payload = {type:'match', t1, t2, group,
    target:dev.clientId, startAt:Date.now(), sessionId:sid, torneoName, matchId,
    ...(isBracket ? {matchType:'bracket', bType, bRi, bMi} : {gi, mi})};
  try{
    await sendToDevice(sid, dev.clientId, {match:payload});
    await setDoc(doc(db,'devices',dev.clientId), {busy:true, currentMatch:payload}, {merge:true});
    if(sid===sessionId){
      if(!isBracket && activePanel?.gi===gi&&activePanel?.mi===mi){closeScorePanel(gi);activePanel=null;}
      isBracket ? renderBracket() : renderGroups();
    }
    toast(`📱 ${t1} vs ${t2} → ${dev.name}`);
  }catch(e){
    dev.busy=false; dev.currentMatch=null;
    console.error('_sendMatchNow error',e);
    throw e;
  }
}

// Despachar usando globalQueue local
let _dispatching = false;
let _dispatchPending = false;
async function dispatchNextFromQueue(){
  if(_dispatching){ _dispatchPending = true; return; }
  _dispatching = true;
  try{
    do{
      _dispatchPending = false;
      while(true){
        const free = connectedDevices.find(d=>!d.busy && d.ready !== false);
        if(!free || !globalQueue.length) break;
        const item = globalQueue.shift();
        // Marcar busy ANTES de guardar — así buildAndSaveQueue verá live=true
        free.busy = true;
        free.dispatchedAt = Date.now(); // marca el momento del despacho para ignorar busy:false tardíos de ipadSave
        free.currentMatch = {gi:item.gi, mi:item.mi, sid:item.sid, matchId:item.matchId,
          t1:item.t1, t2:item.t2, group:item.group, torneoName:item.torneoName,
          assignedAt:Date.now(),
          ...(item.type==='bracket' ? {type:'bracket', bType:item.bType, bRi:item.bRi, bMi:item.bMi} : {})};
        await saveGlobalQueue(); // listener dispara: item no está + dev.busy=true → status:'live' ✓
        try{
          await _sendMatchNow(free, item);
          // Actualizar cola pública con status live (listener puede no haber disparado aún)
          if(sessionId && (groupData.groups || state.rounds)) buildAndSaveQueue().catch(()=>{});
        }
        catch(e){
          free.busy = false;
          free.currentMatch = null;
          globalQueue.unshift(item);
          await saveGlobalQueue();
          break;
        }
      }
    } while(_dispatchPending); // re-ejecutar si alguien llamó durante el dispatch
    // Siempre actualizar cola pública al terminar el dispatch
    if(sessionId && (groupData.groups || state.rounds)){
      buildAndSaveQueue().catch(()=>{});
      // También otros torneos con dispositivos activos
      const activeSids = [...new Set(connectedDevices.filter(d=>d.busy&&d.currentMatch?.sid&&d.currentMatch.sid!==sessionId).map(d=>d.currentMatch.sid))];
      activeSids.forEach(sid=>buildAndSaveQueueForSid(sid).catch(()=>{}));
    }
  }finally{
    _dispatching = false;
  }
}

// ── 7.3 Estado de cola para UI ─────────────────────────

function isMatchLive(gi,mi){
  return connectedDevices.some(d=>d.busy&&d.currentMatch?.gi===gi&&d.currentMatch?.mi===mi&&d.currentMatch?.sid===sessionId);
}
function getMatchDeviceName(gi,mi){
  return connectedDevices.find(d=>d.busy&&d.currentMatch?.gi===gi&&d.currentMatch?.mi===mi&&d.currentMatch?.sid===sessionId)?.name||null;
}
function isMatchQueued(gi,mi){
  return globalQueue.some(q=>q.gi===gi&&q.mi===mi&&q.sid===sessionId);
}
function getMatchQueuePos(gi,mi){
  const pos=globalQueue.findIndex(q=>q.gi===gi&&q.mi===mi&&q.sid===sessionId);
  return pos>=0?pos+1:null;
}

// ── 7.3b Estado de cola (bracket) ──────────────────────
function isBracketMatchLive(bType,bRi,bMi){
  return connectedDevices.some(d=>d.busy&&d.currentMatch?.type==='bracket'&&d.currentMatch?.bType===bType&&d.currentMatch?.bRi===bRi&&d.currentMatch?.bMi===bMi&&d.currentMatch?.sid===sessionId);
}
function getBracketMatchDeviceName(bType,bRi,bMi){
  return connectedDevices.find(d=>d.busy&&d.currentMatch?.type==='bracket'&&d.currentMatch?.bType===bType&&d.currentMatch?.bRi===bRi&&d.currentMatch?.bMi===bMi&&d.currentMatch?.sid===sessionId)?.name||null;
}
function isBracketMatchQueued(bType,bRi,bMi){
  return globalQueue.some(q=>q.type==='bracket'&&q.bType===bType&&q.bRi===bRi&&q.bMi===bMi&&q.sid===sessionId);
}
function getBracketMatchQueuePos(bType,bRi,bMi){
  const pos=globalQueue.findIndex(q=>q.type==='bracket'&&q.bType===bType&&q.bRi===bRi&&q.bMi===bMi&&q.sid===sessionId);
  return pos>=0?pos+1:null;
}

async function addBracketMatchToQueue(bType,bRi,bMi){
  if(isBracketMatchLive(bType,bRi,bMi)){ toast('⚠️ Este partido ya está en juego'); return; }
  if(isBracketMatchQueued(bType,bRi,bMi)){ toast('⚠️ Ya está en la cola'); return; }
  // Obtener el partido del state
  let match;
  if(bType==='upper') match=state.rounds?.[bRi]?.[bMi];
  else if(bType==='lower') match=state.lRounds?.[bRi]?.[bMi];
  else if(bType==='gf') match=state.gf;
  if(!match||!match.t1||!match.t2||match.winner){ toast('⚠️ Partido no disponible'); return; }
  const matchId = getNextMatchId();
  const roundLabel = bType==='gf'?'Gran Final':bType==='upper'?`Upper R${bRi+1}`:`Lower R${bRi+1}`;
  const item = {matchId, type:'bracket', bType, bRi, bMi, sid:sessionId,
    t1:match.t1.name, t2:match.t2.name,
    group:roundLabel, torneoName:groupData.title||state.title,
    assignedAt:Date.now()};
  globalQueue.push(item);
  await dispatchNextFromQueue();
  await saveGlobalQueue();
  renderBracket();
  await buildAndSaveQueue();
  updateDeviceUI();
}

async function removeBracketMatchFromQueue(bType,bRi,bMi){
  const idx=globalQueue.findIndex(q=>q.type==='bracket'&&q.bType===bType&&q.bRi===bRi&&q.bMi===bMi&&q.sid===sessionId);
  if(idx<0) return;
  globalQueue.splice(idx,1);
  toast('✕ Partido eliminado de la cola');
  await saveGlobalQueue();
  renderBracket();
  await buildAndSaveQueue();
  updateDeviceUI();
}

// ── 7.4 Añadir / quitar de la cola ─────────────────────

async function addToGlobalQueue(gi,mi){
  if(isMatchLive(gi,mi)){ toast('⚠️ Este partido ya está en juego'); return; }
  if(isMatchQueued(gi,mi)){ toast('⚠️ Ya está en la cola'); return; }
  const m=groupData.groups?.[gi]?.matches?.[mi]; if(!m) return;
  const matchId = getNextMatchId();
  const item = {matchId, gi, mi, sid:sessionId,
    t1:m.t1.name, t2:m.t2.name,
    group:groupData.groups[gi].name, torneoName:groupData.title,
    assignedAt:Date.now()};
  if(activePanel?.gi===gi&&activePanel?.mi===mi){closeScorePanel(gi);activePanel=null;}
  globalQueue.push(item);
  await dispatchNextFromQueue(); // intenta despachar inmediatamente
  await saveGlobalQueue();       // guardar estado actual en Firestore
  renderGroups();
  await buildAndSaveQueue();
  updateDeviceUI();
}

async function removeFromGlobalQueue(gi,mi){
  const idx=globalQueue.findIndex(q=>q.gi===gi&&q.mi===mi&&q.sid===sessionId);
  if(idx<0) return;
  globalQueue.splice(idx,1);
  toast('✕ Partido eliminado de la cola');
  await saveGlobalQueue();
  renderGroups();
  await buildAndSaveQueue();
  updateDeviceUI();
}

// ── 7.5 Botón de cola en el panel de marcadores ────────

function renderSendToSection(gi,mi,container){
  const section=document.createElement('div'); section.className='send-to-section';
  const live=isMatchLive(gi,mi);
  const queued=isMatchQueued(gi,mi);
  const pos=queued?getMatchQueuePos(gi,mi):null;
  const btn=document.createElement('button');
  if(live){
    btn.className='send-to-btn sent'; btn.textContent='▶ En juego'; btn.disabled=true;
  } else if(queued){
    btn.className='send-to-btn queued'; btn.textContent=`📋 En cola #${pos}`;
    btn.addEventListener('click',()=>removeFromGlobalQueue(gi,mi));
  } else {
    btn.className='send-to-btn'; btn.textContent='➕ Añadir a cola';
    btn.addEventListener('click',()=>addToGlobalQueue(gi,mi));
  }
  const btnRow=document.createElement('div');
  btnRow.style.cssText='display:flex;flex-direction:column;gap:6px;';
  btnRow.appendChild(btn);

  // Botón imprimir ticket individual
  const ticketBtn=document.createElement('button');
  ticketBtn.className='send-to-btn';
  ticketBtn.style.cssText='border-color:#e67e22;color:#e67e22;';
  ticketBtn.textContent='\u{1F5A8}\uFE0F Ticket';
  ticketBtn.addEventListener('click',()=>{
    const m=groupData.groups[gi].matches[mi];
    const g=groupData.groups[gi];
    imprimirTicketPartido({
      torneo:(groupData.title||'TORNEO').toUpperCase(),
      grupo:g.name||'Grupo '+(gi+1),
      pa:m.t1.name.toUpperCase(),
      pb:m.t2.name.toUpperCase()
    });
  });
  btnRow.appendChild(ticketBtn);
  section.appendChild(btnRow);

  container.appendChild(section);
}

// ════════════════════════════════════════════════════════════════
// COLA PÚBLICA (vista para espectadores)
// ════════════════════════════════════════════════════════════════
async function buildAndSaveQueue(){
  if(!sessionId || (!groupData.groups && !state.rounds)) return;
  const items=[];
  // Partidos de grupos
  (groupData.groups||[]).forEach((g,gi)=>{
    g.matches.forEach((m,mi)=>{
      if(m.played||m.t1.name==='BYE'||m.t2.name==='BYE') return;
      const dev=connectedDevices.find(d=>d.busy&&d.currentMatch?.gi===gi&&d.currentMatch?.mi===mi&&d.currentMatch?.sid===sessionId);
      const qPos=globalQueue.findIndex(q=>q.gi===gi&&q.mi===mi&&q.sid===sessionId);
      items.push({gi,mi,t1:m.t1.name,t2:m.t2.name,group:g.name,torneoName:groupData.title,
        status:dev?'live':qPos>=0?'queued':'pending',
        devName:dev?dev.name:null, queuePos:qPos>=0?qPos+1:null,
        assignedAt:dev?.currentMatch?.assignedAt||(qPos>=0?globalQueue[qPos].assignedAt:null)});
    });
  });
  // Partidos de bracket (solo los que están en cola o en juego)
  if(state.rounds){
    const addBracketItem = (match, bType, bRi, bMi, label) => {
      if(!match||!match.t1||!match.t2||match.winner||match.t1.name==='BYE'||match.t2.name==='BYE') return;
      const dev=connectedDevices.find(d=>d.busy&&d.currentMatch?.type==='bracket'&&d.currentMatch?.bType===bType&&d.currentMatch?.bRi===bRi&&d.currentMatch?.bMi===bMi&&d.currentMatch?.sid===sessionId);
      const qPos=globalQueue.findIndex(q=>q.type==='bracket'&&q.bType===bType&&q.bRi===bRi&&q.bMi===bMi&&q.sid===sessionId);
      if(!dev&&qPos<0) return; // solo incluir si está en cola o en juego
      items.push({bType,bRi,bMi,t1:match.t1.name,t2:match.t2.name,group:label,torneoName:groupData.title||state.title,
        status:dev?'live':qPos>=0?'queued':'pending',
        devName:dev?dev.name:null, queuePos:qPos>=0?qPos+1:null,
        assignedAt:dev?.currentMatch?.assignedAt||(qPos>=0?globalQueue[qPos].assignedAt:null)});
    };
    state.rounds.forEach((round,ri)=>round.forEach((m,mi)=>addBracketItem(m,'upper',ri,mi,`Upper R${ri+1}`)));
    (state.lRounds||[]).forEach((round,lri)=>round.forEach((m,mi)=>addBracketItem(m,'lower',lri,mi,`Lower R${lri+1}`)));
    if(state.gf) addBracketItem(state.gf,'gf',0,0,'Gran Final');
  }
  items.sort((a,b)=>{ const r={live:0,queued:1,pending:2}; if(r[a.status]!==r[b.status]) return r[a.status]-r[b.status]; return (a.assignedAt||0)-(b.assignedAt||0); });
  try{ await saveQueueMeta(sessionId,items,groupData.title||state.title); broadcastQueueRefresh(); }catch(e){}
}

// Reconstruir cola pública de cualquier torneo usando globalQueue + connectedDevices
// No necesita groupData — todo lo que necesitamos está en los items de la cola
async function buildAndSaveQueueForSid(targetSid){
  if(targetSid===sessionId){ await buildAndSaveQueue(); return; }
  // Items de este torneo que están en cola
  const queuedItems = globalQueue.filter(q=>q.sid===targetSid);
  // Dispositivos ocupados con partidos de este torneo
  const liveDevs = connectedDevices.filter(d=>d.busy&&d.currentMatch?.sid===targetSid);

  const items = [];
  // Añadir los que están en juego (live)
  liveDevs.forEach(dev=>{
    const cm = dev.currentMatch;
    items.push({
      gi:cm.gi, mi:cm.mi,
      t1:cm.t1||'', t2:cm.t2||'',
      group:cm.group||'', torneoName:cm.torneoName||targetSid,
      status:'live', devName:dev.name,
      assignedAt:cm.assignedAt||0
    });
  });
  // Añadir los que están en cola (queued)
  queuedItems.forEach((q,i)=>{
    items.push({
      gi:q.gi, mi:q.mi,
      t1:q.t1, t2:q.t2,
      group:q.group, torneoName:q.torneoName||targetSid,
      status:'queued', devName:null,
      queuePos:i+1, assignedAt:q.assignedAt
    });
  });
  items.sort((a,b)=>{
    const r={live:0,queued:1,pending:2};
    if(r[a.status]!==r[b.status]) return r[a.status]-r[b.status];
    return (a.assignedAt||0)-(b.assignedAt||0);
  });
  // Obtener título del torneo de la cola pública existente
  try{
    const snap = await getDoc(queueRef(targetSid));
    const title = snap.exists() ? (snap.data().title||targetSid) : targetSid;
    await saveQueueMeta(targetSid, items, title);
    broadcastQueueRefresh();
  }catch(e){}
}

// ════════════════════════════════════════════════════════════════
// CARGA Y GESTIÓN DE TORNEOS
// ════════════════════════════════════════════════════════════════
async function getAllTournaments(){
  try{ const s=await getDocs(collection(db,'torneos')); const r={}; s.forEach(d=>r[d.id]=d.data()); return r; }catch(e){ return {}; }
}

async function restoreTournament(sid, data, showToast){
  if(unsubscribeSession) unsubscribeSession();
  if(unsubscribeScores) unsubscribeScores();
  sessionId=sid; groupData=parseGroupData(data); state=parseState(data);
  isPublished=false; updatePublishBtn();
  // Preservar busy/currentMatch en memoria — solo añadir dispositivos nuevos
  (data.devices||[]).forEach(d=>{
    if(!connectedDevices.find(x=>x.clientId===d.clientId))
      connectedDevices.push({clientId:d.clientId,name:d.name,lastSeen:Date.now(),busy:!!d.busy,currentMatch:d.currentMatch||null});
  });
  blockedDevices=data.blocked||[];
  if(state.rounds){
    $('display-title').textContent=groupData.title; $('fs-bar-title').textContent=groupData.title;
    ['setup-screen','group-screen','pairing-screen'].forEach(id=>$(id).style.display='none');
    $('tournament-screen').style.display='block'; renderBracket(); updateProgress();
  } else {
    $('gs-title').textContent=groupData.title;
    ['setup-screen','pairing-screen','tournament-screen'].forEach(id=>$(id).style.display='none');
    $('group-screen').style.display='block'; renderGroups();
  }
  subscribeToSession(); updateDeviceUI();
  await checkPublishState(); updatePublishBtn();
  await buildAndSaveQueue(); // cola pública del torneo activo
  // Actualizar cola pública de otros torneos con items en la cola global
  const otherSids = [...new Set(globalQueue.filter(q=>q.sid!==sid).map(q=>q.sid))];
  for(const otherSid of otherSids){ await buildAndSaveQueueForSid(otherSid); }
  const busy=connectedDevices.filter(d=>d.busy);
  if(busy.length) setTimeout(()=>toast(`⚠️ ${busy.map(d=>d.name).join(', ')} tenía${busy.length>1?'n':''} partido en curso`),1000);
  if(showToast) toast(`📂 Torneo "${groupData.title}" cargado`);
}

function subscribeToSession(){
  if(unsubscribeScores) unsubscribeScores();
  unsubscribeScores = onSnapshot(collection(db,'scores'), async snap=>{
    for(const change of snap.docChanges()){
      if(change.type!=='added') continue;
      const d=change.doc.data();
      // Liberar el dispositivo que reportó el resultado — independientemente del torneo.
      // Solo si su partido actual coincide con el resultado (o no tiene ninguno), para
      // no pisar un partido recién despachado por otra pestaña/gestor (escritura tardía).
      const dev=connectedDevices.find(x=>x.clientId===d.from);
      const _devMid=dev?.currentMatch?.matchId;
      const _sameMatch=_devMid==null || d.matchId==null || String(_devMid)===String(d.matchId);
      if(dev && _sameMatch){ dev.busy=false; dev.currentMatch=null; }
      if(d.from && _sameMatch) setDoc(doc(db,'devices',d.from),{busy:false,currentMatch:null},{merge:true}).catch(()=>{});
      // Aplicar resultado solo si es del torneo activo
      if(d.sid===sessionId){
        if(d.type==='bracket'){
          // Resultado de partido de bracket
          const winner = d.winner; // nombre del ganador
          const match = d.bType==='gf' ? state.gf
            : d.bType==='lower' ? state.lRounds?.[d.bRi]?.[d.bMi]
            : state.rounds?.[d.bRi]?.[d.bMi];
          if(match && !match.winner && match.t1 && match.t2){
            // Validar: el resultado debe ser de ESTE partido y el ganador uno de sus dos
            // jugadores. Antes, si no coincidía, se daba la victoria al segundo jugador.
            const si = winner===match.t1.name ? 0 : winner===match.t2.name ? 1 : -1;
            if(si<0 || !scoreTeamsMatch(d, match)){
              console.warn('Resultado de cuadro ignorado (no coincide con el partido)', d, match);
              toast(`⚠️ Resultado ignorado: no coincide con el partido actual${dev?' · '+dev.name:''}`);
            } else if(d.bType==='gf'){
              match.s1=+d.s1; match.s2=+d.s2;
              selectWinnerGF(si);
              toast(`📱 🏆 ${winner} campeón${dev?' · '+dev.name:''}`);
            } else if(d.bType==='lower'){
              match.s1=+d.s1; match.s2=+d.s2;
              selectWinnerLower(d.bRi, d.bMi, si);
              toast(`📱 ${winner} avanza en lower${dev?' · '+dev.name:''}`);
            } else {
              match.s1=+d.s1; match.s2=+d.s2;
              selectWinner(d.bRi, d.bMi, si);
              toast(`📱 ${winner} avanza${dev?' · '+dev.name:''}`);
            }
          }
        } else {
          // Resultado de partido de grupos
          const match=groupData.groups?.[d.gi]?.matches?.[d.mi];
          if(match&&!match.played&&!scoreTeamsMatch(d, match)){
            console.warn('Resultado de grupo ignorado (no coincide con el partido)', d, match);
            toast(`⚠️ Resultado ignorado: no coincide con el partido actual${dev?' · '+dev.name:''}`);
          } else if(match&&!match.played){
            applyScore(d.gi,d.mi,+d.s1,+d.s2,true);
            toast(`📱 ${match.t1.name} ${d.s1}–${d.s2} ${match.t2.name}${dev?' · '+dev.name:''}`);
          } else { renderGroups(); }
        }
        // Borrar score del torneo activo — ya procesado
        deleteDoc(change.doc.ref).catch(()=>{});
      } else if(d.sid){
        // Score de otro torneo — se deja en Firestore para que lo aplique quien abra ese
        // torneo (loadTournament / este mismo listener). Antes se borraba a los 60 s y el
        // resultado se perdía si nadie tenía ese torneo abierto. Solo se borra si el
        // torneo ya no existe (basura).
        const ref = change.doc.ref;
        getDoc(tourneyRef(d.sid)).then(s=>{ if(!s.exists()) deleteDoc(ref).catch(()=>{}); }).catch(()=>{});
      }
      await dispatchNextFromQueue();
      await buildAndSaveQueueForSid(d.sid||sessionId);
      if(d.sid && d.sid !== sessionId) await buildAndSaveQueue();
      updateDeviceUI();
    }
  });
}

// Un resultado enviado por un iPad trae los nombres de las parejas (t1/t2). Si los trae,
// deben coincidir con el partido en esa posición; si no, el cuadro/grupo ha cambiado o el
// resultado es falso. Resultados antiguos sin nombres se aceptan (compatibilidad).
function scoreTeamsMatch(d, match){
  if(d.t1==null && d.t2==null) return true;
  return d.t1===match.t1?.name && d.t2===match.t2?.name;
}

async function loadTournament(sid){
  try{
    const snap=await getDoc(tourneyRef(sid));
    if(!snap.exists()){ localStorage.removeItem('torneoPro_lastSession'); toast('⚠️ Torneo no encontrado'); return; }
    const data=snap.data();
    const qSnap=await getDoc(QUEUE_REF());
    globalQueue=qSnap.exists()?(qSnap.data().queue||[]):[];
    // Aplicar scores pendientes de este torneo antes de restaurar.
    // Solo se pre-aplican los de GRUPOS; los de BRACKET se dejan en Firestore para
    // que el listener de scores (subscribeToSession) los procese con la lógica de
    // propagación correcta. Antes se borraban sin aplicarse → se perdía el resultado.
    try{
      const scoresSnap=await getDocs(collection(db,'scores'));
      const pendingGroups=scoresSnap.docs.filter(d=>{ const sc=d.data(); return sc.sid===sid && sc.type!=='bracket'; });
      if(pendingGroups.length){
        const gd=parseGroupData(data);
        pendingGroups.forEach(scoreDoc=>{
          const sc=scoreDoc.data();
          const match=gd.groups?.[sc.gi]?.matches?.[sc.mi];
          if(match&&!match.played&&scoreTeamsMatch(sc, match)){ match.s1=+sc.s1; match.s2=+sc.s2; match.played=true; }
          deleteDoc(scoreDoc.ref).catch(()=>{});
        });
        // Guardar groupData con resultados aplicados
        await saveState(sid, gd, parseState(data));
        data.groupDataJson=JSON.stringify(gd);
      }
    }catch(e){ console.error('pending scores',e); }
    const fiveMin=Date.now()-300000;
    const devSnap=await getDocs(collection(db,'devices'));
    const liveDevices=[];
    devSnap.forEach(d=>{ const dd=d.data(); if(!dd.blocked&&dd.clientId){ const ts=dd.lastSeen?.toMillis?.()||0; if(ts>fiveMin||dd.busy){
      // Normalizar currentMatch: el payload en Firestore usa 'sessionId', local usa 'sid'
      let cm = dd.currentMatch||null;
      if(cm && cm.sessionId && !cm.sid) cm = {...cm, sid:cm.sessionId};
      liveDevices.push({clientId:dd.clientId,name:dd.name,lastSeen:Date.now(),busy:!!dd.busy,currentMatch:cm});
    } } });
    const dlSnap=await getDoc(doc(db,'config','devicesList'));
    const blocked=dlSnap.exists()?(dlSnap.data().blocked||[]):[];
    await restoreTournament(sid,{...data,devices:liveDevices,blocked},true);
    $('tourneys-overlay').style.display='none';
  }catch(e){ toast('⚠️ Error al cargar torneo'); console.error(e); }
}

async function renderTourneysList(){
  const list=$('tourneys-list'); if(!list) return;
  list.innerHTML='<div style="color:var(--text-muted);padding:1rem">Cargando…</div>';
  const all=await getAllTournaments(); const entries=Object.entries(all);
  if(!entries.length){ list.innerHTML='<div style="color:var(--text-muted);padding:1rem">No hay torneos guardados.</div>'; return; }
  list.innerHTML='';
  entries.forEach(([sid,data])=>{
    const gd=parseGroupData(data); const title=gd?.title||sid;
    const st=parseState(data); const isKO=st?.rounds?true:(data.stateJson?data.stateJson.includes('"rounds"'):false);
    const row=document.createElement('div'); row.className='tourney-row';
    row.innerHTML=`<div class="tourney-open" style="display:flex;align-items:center;gap:0.8rem;flex:1;cursor:pointer"><div><div style="font-weight:700">${esc(title)}</div><div style="font-size:0.75rem;color:var(--text-muted)">${isKO?'Fase Eliminatoria':'Fase de Grupos'}</div></div></div><button class="btn btn-danger" style="padding:0.3rem 0.6rem">Eliminar</button>`;
    row.querySelector('.tourney-open').addEventListener('click',()=>loadTournament(sid));
    row.querySelector('.btn-danger').addEventListener('click',e=>deleteTournament(sid,e));
    list.appendChild(row);
  });
}

async function deleteTournament(sid, event){
  if(event) event.stopPropagation();
  if(!confirm('¿Eliminar este torneo?')) return;
  try{
    await setDoc(doc(db,'config','publishedTorneos'),{sessionIds:arrayRemove(sid),updatedAt:serverTimestamp()},{merge:true});
    await saveQueueMeta(sid,[],''). catch(()=>{});
    await deleteDoc(tourneyRef(sid));
    if(sid===sessionId) resetAll();
    await runTransaction(db,async tx=>{ const s=await tx.get(QUEUE_REF()); const q=s.exists()?(s.data().queue||[]):[]; tx.set(QUEUE_REF(),{queue:q.filter(x=>x.sid!==sid),updatedAt:serverTimestamp()}); }).catch(()=>{});
    globalQueue=globalQueue.filter(q=>q.sid!==sid);
    toast('🗑️ Torneo eliminado'); renderTourneysList();
  }catch(e){ toast('⚠️ Error al eliminar'); console.error(e); }
}

// ════════════════════════════════════════════════════════════════
// DISPOSITIVOS — UI
// ════════════════════════════════════════════════════════════════
function updateDeviceUI(){
  const count=connectedDevices.length;
  const mini=$('ntfy-mini-text'); if(mini) mini.textContent=count===0?'0 disp.':`${count} disp.`;
  const dot2=$('ntfy-dot2'); if(dot2){ count>0?dot2.classList.add('on'):dot2.classList.remove('on'); }
  renderDevicesList();
  // Refrescar botón de cola en panel de marcadores de grupos
  document.querySelectorAll('.score-panel.open').forEach(p=>{
    if(!activePanel) return;
    const {gi,mi}=activePanel; if(`sp-${gi}`!==p.id) return;
    const sec=p.querySelector('.send-to-section');
    if(sec){ const tmp=document.createElement('div'); renderSendToSection(gi,mi,tmp); sec.replaceWith(tmp.firstElementChild||tmp); }
  });
  // Refrescar botón de cola en panel de marcadores del bracket
  if(_bsp && $('bracket-score-panel')?.style.display!=='none'){
    const bType = _bsp.isGF?'gf':_bsp.isLower?'lower':'upper';
    const bRi   = _bsp.isGF?0:_bsp.isLower?_bsp.lri:_bsp.ri;
    const existing = $('bsp-queue-section');
    if(existing){
      const tmp = document.createElement('div');
      renderBracketSendToSection(bType, bRi, _bsp.mi, tmp);
      tmp.firstElementChild.id = 'bsp-queue-section';
      existing.replaceWith(tmp.firstElementChild);
    }
  }
}

async function clearAllDevices(){
  if(!confirm('¿Eliminar todos los dispositivos? Tendrán que volver a escanear el QR.')) return;
  try{
    const snap=await getDocs(collection(db,'devices'));
    await Promise.all(snap.docs.map(d=>deleteDoc(d.ref)));
    connectedDevices=[]; blockedDevices=[]; globalQueue=[];
    await saveGlobalQueue(); await setDoc(doc(db,'config','devicesList'),{devices:[],blocked:[],updatedAt:serverTimestamp()});
    await buildAndSaveQueue().catch(()=>{});
    updateDeviceUI(); toast('🗑️ Todos los dispositivos eliminados');
  }catch(e){ toast('⚠️ Error al limpiar'); }
}

async function removeDevice(clientId){
  connectedDevices=connectedDevices.filter(d=>d.clientId!==clientId);
  try{ await deleteDoc(doc(db,'devices',clientId)); }catch(e){}
  updateDeviceUI();
}

function renderDevicesList(){
  const list=$('connect-devices-list'); if(!list) return;
  if(!connectedDevices.length){ list.innerHTML='<div class="connect-empty">Ningún dispositivo conectado todavía.</div>'; return; }
  list.innerHTML='';
  connectedDevices.forEach(dev=>{
    const ago=Math.round((Date.now()-dev.lastSeen)/1000);
    const statusTxt=dev.busy?'⏳ En partido':(ago<10?'✓ Libre':`hace ${ago}s`);
    const statusColor=dev.busy?'var(--gold)':'var(--win)';
    const row=document.createElement('div'); row.className='connect-device-row';
    row.innerHTML=`<div><div class="dev-name">${esc(dev.name)}</div><div class="dev-status" style="color:${statusColor}">${statusTxt}</div></div><button class="btn btn-danger" style="padding:0.2rem 0.5rem;font-size:0.75rem">✕</button>`;
    // Listener en vez de onclick="removeDevice('${id}')": el id viene de Firestore y
    // un id con comillas podía inyectar código en el atributo.
    row.querySelector('button').addEventListener('click',()=>removeDevice(dev.clientId));
    list.appendChild(row);
  });
}

function generateDeviceQR(){
  const name=$('connect-device-name').value.trim()||`Dispositivo ${connectedDevices.length+1}`;
  const existing=connectedDevices.find(d=>d.name===name);
  const deviceId=existing?existing.clientId:('dev-'+Math.random().toString(36).slice(2,10));
  const url=`${location.origin}${location.pathname}?device=${encodeURIComponent(name)}&id=${deviceId}`;
  const wrap=$('connect-qr-wrap'); wrap.innerHTML='';
  if(window.QRCode){ new QRCode(wrap,{text:url,width:200,height:200}); }
  else { wrap.innerHTML=`<a href="${url}" target="_blank" style="word-break:break-all;font-size:0.75rem">${url}</a>`; }
  const urlRow=$('connect-url-row'); const urlBox=$('connect-url-box');
  if(urlRow&&urlBox){ urlBox.textContent=url; urlRow.style.display='flex'; }
}

function copyConnectURL(){
  const urlBox=$('connect-url-box'); const url=urlBox?.textContent||'';
  if(!url) return;
  navigator.clipboard.writeText(url).then(()=>toast('✓ URL copiada')).catch(()=>{
    const ta=document.createElement('textarea'); ta.value=url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast('✓ URL copiada');
  });
}

function openConnectModal(){
  $('connect-overlay').classList.add('open'); renderDevicesList();
  if(!$('connect-device-name').value){ $('connect-device-name').value=`Dispositivo ${connectedDevices.length+1}`; }
  const before=connectedDevices.length;
  connectedDevices=connectedDevices.filter(d=>d.busy||(Date.now()-d.lastSeen<180000));
  if(connectedDevices.length!==before) updateDeviceUI();
}


$('btn-display-mode').addEventListener('click',()=>{
  if(!sessionId){toast('⚠️ Crea o carga un torneo primero');return;}
  window.open(`${location.pathname}?mode=display&session=${sessionId}`,'_blank','noopener');
  toast('👥 Vista pública de grupos abierta');
});
$('btn-queue-mode').addEventListener('click',()=>{
  window.open(`${location.pathname}?mode=queue`,'_blank','noopener');
  toast('📋 Cola combinada abierta');
  closeAdminMenu();
});
$('btn-manage-tourneys').addEventListener('click',()=>{ renderTourneysList(); $('tourneys-overlay').style.display='flex'; closeAdminMenu(); });
$('btn-connect-device').addEventListener('click',()=>{ openConnectModal(); closeAdminMenu(); });
$('btn-clear-devices').addEventListener('click',()=>clearAllDevices());

window.closeAdminMenu = function(){
  const dd=$('admin-menu-dropdown');
  if(dd) dd.style.display='none';
};

// ═══════════════════════════════════════════════════════
// 8. PANTALLA DE CONFIGURACIÓN (Setup)
// ═══════════════════════════════════════════════════════
function divisors(n){ const r=[]; for(let i=2;i<=n;i++) if(n%i===0) r.push(i); return r; }

function rebuildGroupOptions(){
  const c=$('group-options'); c.innerHTML='';
  divisors(bracketSize).forEach((g,i)=>{
    const btn=document.createElement('button'); btn.className='size-btn'+(i===0?' active':''); btn.textContent=g;
    btn.addEventListener('click',()=>{ c.querySelectorAll('.size-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); numGroups=g; updateGroupInfo(); rebuildTeamInputs(); });
    c.appendChild(btn);
  });
  numGroups=divisors(bracketSize)[0]; updateGroupInfo(); rebuildTeamInputs();
}
function updateGroupInfo(){
  const tpg=bracketSize/numGroups;
  $('groups-info').innerHTML=`<strong>${numGroups} grupos</strong> de <strong>${tpg} participante${tpg>1?'s':''}</strong> · <strong>Todos clasifican</strong> al cuadro`;
}
function rebuildTeamInputs(){
  const g=$('teams-grid'); g.innerHTML='';
  const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ', tpg=bracketSize/numGroups;
  for(let i=1;i<=bracketSize;i++){
    const row=document.createElement('div'); row.className='team-input-row';
    const w=document.createElement('div'); w.className='team-input-wrap';
    w.innerHTML=`<span class="team-num">${i}</span><input type="text" placeholder="Equipo ${i}" data-idx="${i}">`;
    const sel=document.createElement('select'); sel.className='group-select'; sel.dataset.idx=i;
    for(let j=0;j<numGroups;j++){
      const opt=document.createElement('option'); opt.value=j; opt.textContent='Grupo '+letters[j];
      if(Math.floor((i-1)/tpg)===j) opt.selected=true;
      sel.appendChild(opt);
    }
    row.appendChild(w); row.appendChild(sel); g.appendChild(row);
  }
}
document.querySelectorAll('#size-options .size-btn').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('#size-options .size-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); bracketSize=+btn.dataset.size; rebuildGroupOptions();
}));
rebuildGroupOptions();

$('btn-fill-test').onclick=()=>{ [...$('teams-grid').querySelectorAll('input')].forEach((inp,i)=>{ if(!inp.value.trim()) inp.value=`Jugador ${i+1}`; }); toast('🎲 Nombres de prueba rellenados'); };

// Importar jugadores desde archivo
$('btn-import-players').addEventListener('click', ()=>$('import-file-input').click());
$('import-file-input').addEventListener('change', async e=>{
  const file = e.target.files[0]; if(!file) return;
  e.target.value = ''; // reset para poder reimportar el mismo archivo
  try{
    let names = [];
    const ext = file.name.split('.').pop().toLowerCase();

    if(ext==='xlsx'||ext==='xls'){
      // Excel: usar SheetJS si está disponible, si no avisar
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs') // 0.18.5 (npm) tenía vulnerabilidades conocidas.catch(()=>null);
      if(!XLSX){ toast('⚠️ Formato Excel no soportado en este navegador. Usa .txt o .csv'); return; }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, {type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1});
      names = rows.flatMap(r=>r).map(v=>String(v||'').trim()).filter(Boolean);
    } else {
      // txt / csv: leer como texto, una línea = un jugador
      const text = await file.text();
      names = text.split(/\r?\n|;|,/).map(n=>n.trim()).filter(Boolean);
    }

    if(!names.length){ toast('⚠️ No se encontraron nombres en el archivo'); return; }

    const inputs = [...$('teams-grid').querySelectorAll('input')];
    const filled = Math.min(names.length, inputs.length);
    inputs.forEach((inp, i)=>{ inp.value = i<names.length ? names[i] : ''; });
    toast(`✓ ${filled} jugadores importados${names.length>inputs.length?' (hay más en el archivo que plazas disponibles)':''}`);
  }catch(err){
    console.error('Import error', err);
    toast('⚠️ Error al leer el archivo');
  }
});

$('start-btn').addEventListener('click',async()=>{
  const title=$('tourney-name').value.trim()||'Torneo';
  const teamsData=[...$('teams-grid').querySelectorAll('.team-input-row')].map(row=>({
    name:row.querySelector('input').value.trim()||'BYE',
    groupIdx:parseInt(row.querySelector('select').value)
  }));
  const tpg=bracketSize/numGroups, counts=Array(numGroups).fill(0);
  teamsData.forEach(t=>counts[t.groupIdx]++);
  if(counts.some(c=>c!==tpg)){ toast(`⚠️ Cada grupo debe tener exactamente ${tpg} equipos.`); return; }
  // Nombres repetidos: la clasificación y el cuadro identifican a los jugadores por nombre,
  // así que dos "Juan" mezclarían sus estadísticas.
  const seen=new Set(), dups=new Set();
  teamsData.forEach(t=>{
    if(t.name==='BYE') return;
    const k=t.name.toLocaleLowerCase('es');
    if(seen.has(k)) dups.add(t.name); else seen.add(k);
  });
  if(dups.size){ toast(`⚠️ Nombres repetidos: ${[...dups].join(', ')}`); return; }
  await launchGroupStageManual(title, teamsData);
});

function resetAll(){
  if(isFsMode) exitFs();
  // NO vaciar cola pública — los partidos en juego/cola siguen siendo válidos
  // NO despublicar — el torneo sigue publicado con sus partidos
  // NO cancelar unsubscribeScores — el listener de scores sigue necesitándose para
  //    procesar resultados de partidos en curso de este torneo
  const oldSid = sessionId;
  sessionId=null; groupData={}; state={};
  // Quitar partidos SIN asignar de este torneo de la cola global
  // (los que están en juego siguen su curso — el score handler los gestionará)
  if(oldSid){
    runTransaction(db, async tx=>{
      const snap = await tx.get(QUEUE_REF());
      const queue = snap.exists() ? (snap.data().queue||[]) : [];
      tx.set(QUEUE_REF(), { queue: queue.filter(q=>q.sid!==oldSid), updatedAt: serverTimestamp() });
    }).catch(()=>{});
    globalQueue = globalQueue.filter(q=>q.sid!==oldSid);
  }
  // NO limpiar connectedDevices ni scores listener
  if(unsubscribeSession) unsubscribeSession();
  // unsubscribeScores se mantiene activo — procesa resultados de partidos en curso
  updatePublishBtn();
  ['group-screen','pairing-screen','tournament-screen'].forEach(id=>$(id).style.display='none');
  $('setup-screen').style.display='block';
  $('champion-banner').classList.remove('visible');
  doubleElim = true;
  document.querySelectorAll('#elim-options .size-btn').forEach((b,i)=>b.classList.toggle('active',i===0));
  $('elim-info').innerHTML = 'Cada participante tiene <strong>2 oportunidades</strong> — si pierdes en el cuadro principal pasas al cuadro de perdedores.';
}
$('reset-btn').addEventListener('click', resetAll);


// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// 9. FASE DE GRUPOS
// ═══════════════════════════════════════════════════════
function makeRR(teams){
  const m=[];
  for(let i=0;i<teams.length;i++) for(let j=i+1;j<teams.length;j++)
    if(teams[i].name!=='BYE'&&teams[j].name!=='BYE') m.push({t1:teams[i],t2:teams[j],s1:null,s2:null,played:false});
  return m;
}
function calcStandings(group){
  if(group.manualOrder) return group.manualOrder;
  const mp={};
  group.teams.forEach((t,idx)=>{
    // Usar key única para BYEs múltiples (BYE_0, BYE_1...) pero mantener name='BYE'
    const key = t.name==='BYE' ? `BYE_${idx}` : t.name;
    mp[key]={team:t,P:0,W:0,D:0,L:0,GF:0,GA:0,Pts:0};
  });
  group.matches.forEach(m=>{
    if(!m.played) return;
    const keyA = m.t1.name==='BYE' ? Object.keys(mp).find(k=>k.startsWith('BYE_')&&mp[k].team===m.t1) : m.t1.name;
    const keyB = m.t2.name==='BYE' ? Object.keys(mp).find(k=>k.startsWith('BYE_')&&mp[k].team===m.t2) : m.t2.name;
    const a=mp[keyA],b=mp[keyB]; if(!a||!b) return;
    a.P++;b.P++;a.GF+=m.s1;a.GA+=m.s2;b.GF+=m.s2;b.GA+=m.s1;
    if(m.s1>m.s2){a.W++;a.Pts+=3;b.L++;}
    else if(m.s1<m.s2){b.W++;b.Pts+=3;a.L++;}
    else{a.D++;a.Pts++;b.D++;b.Pts++;}
  });
  return Object.values(mp).sort((a,b)=>a.team.name==='BYE'?1:b.team.name==='BYE'?-1:b.Pts-a.Pts||(b.GF-b.GA)-(a.GF-a.GA)||b.GF-a.GF);
}

async function launchGroupStageManual(title, teamsData){
  const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ', groups=[];
  for(let g=0;g<numGroups;g++){
    const groupTeams=teamsData.filter(t=>t.groupIdx===g).map((t,i)=>({name:t.name,seed:g*(bracketSize/numGroups)+i+1}));
    groups.push({name:'Grupo '+letters[g],teams:groupTeams,matches:makeRR(groupTeams),manualOrder:null});
  }
  sessionId=genSessionId();
  groupData={title,groups};
  state={};
  $('gs-title').textContent=title;
  ['setup-screen','pairing-screen','tournament-screen'].forEach(id=>$(id).style.display='none');
  $('group-screen').style.display='block';
  await saveCurrentTournament();
  subscribeToSession();
  renderGroups();
}

function renderGroups(){
  if(!groupData.groups) return;
  const c=$('groups-container');
  if(!c) return;
  c.innerHTML='';
  groupData.groups.forEach((g,gi)=>{
    try{ c.appendChild(buildGroupCard(g,gi)); }
    catch(e){ console.error(`buildGroupCard error gi=${gi}`,e); }
  });
  updateGroupProgress();
}

function moveTeam(gi,fromIdx,toIdx){
  const group=groupData.groups[gi]; if(!group.manualOrder) group.manualOrder=calcStandings(group);
  const list=group.manualOrder; if(toIdx<0||toIdx>=list.length) return;
  const team=list.splice(fromIdx,1)[0]; list.splice(toIdx,0,team);
  renderGroups(); saveCurrentTournament();
}

function buildGroupCard(group,gi){
  const realMatches=group.matches.filter(m=>m.t1.name!=='BYE'&&m.t2.name!=='BYE');
  const allM=realMatches.length, doneM=realMatches.filter(m=>m.played).length;
  const card=document.createElement('div'); card.className='group-card'; card.id=`gc-${gi}`;
  const hdr=document.createElement('div'); hdr.className='group-card-title';
  hdr.innerHTML=`<span>${esc(group.name)}</span><span class="gcard-counter">${doneM}/${allM}</span>`;
  card.appendChild(hdr);
  const wrap=document.createElement('div'); wrap.className='standings-wrap';
  const table=document.createElement('table'); table.className='standings-table';
  table.innerHTML=`<thead><tr><th style="width:1.2rem">#</th><th style="text-align:left">Equipo</th><th>PJ</th><th>Pts</th><th style="width:2.5rem"></th></tr></thead>`;
  const tbody=document.createElement('tbody');
  calcStandings(group).forEach((s,i)=>{
    if(s.team.name==='BYE') return; // no mostrar BYEs en la tabla
    const tr=document.createElement('tr');
    tr.innerHTML=`<td><span class="rank">${i+1}</span></td><td>${esc(s.team.name)}</td><td>${s.P>0?s.P:'—'}</td><td class="pts-col">${s.P>0?s.Pts:'—'}</td><td><button class="move-btn" onclick="moveTeam(${gi},${i},${i-1})">▲</button><button class="move-btn" onclick="moveTeam(${gi},${i},${i+1})">▼</button></td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody); wrap.appendChild(table); card.appendChild(wrap);
  const lbl=document.createElement('div'); lbl.className='group-matches-lbl'; lbl.textContent='Partidos'; card.appendChild(lbl);
  group.matches.forEach((m,mi)=>{
    if(m.t1.name==='BYE'||m.t2.name==='BYE') return; // no mostrar partidos contra BYE
    const live=isMatchLive(gi,mi), qPos=!live?getMatchQueuePos(gi,mi):null;
    let cls='group-match-item'; if(m.played) cls+=' played'; if(live) cls+=' live'; else if(qPos) cls+=' queued-match';
    const item=document.createElement('div'); item.className=cls;
    const s1=m.played?m.s1:'-',s2=m.played?m.s2:'-';
    const editIcon=m.played?'<span style="font-size:0.6rem;color:var(--text-muted);margin-left:auto;padding-left:4px;opacity:0.6">✎</span>':'';
    const dot=live?'<span class="live-dot"></span>':qPos?'<span class="queue-dot"></span>':'';
    const devTag=live?`<span style="font-size:0.58rem;color:var(--win);margin-left:2px;opacity:0.8">${esc(getMatchDeviceName(gi,mi)||'')}</span>`:qPos?`<span style="font-size:0.58rem;color:var(--gold);margin-left:2px;opacity:0.9">#${qPos}</span>`:'';
    item.innerHTML=`${dot}<div class="gm-team">${esc(m.t1.name)}</div><div class="gm-score${m.played?'':' pending'}">${s1}–${s2}</div><div class="gm-team r">${esc(m.t2.name)}</div>${devTag}${editIcon}`;
    item.style.cursor='pointer'; item.onclick=()=>openScorePanel(gi,mi);
    card.appendChild(item);
  });
  const panel=document.createElement('div'); panel.className='score-panel'; panel.id=`sp-${gi}`;
  card.appendChild(panel); return card;
}

function openScorePanel(gi,mi){
  if(activePanel?.gi===gi&&activePanel?.mi===mi) return;
  const m=groupData.groups[gi].matches[mi];
  const p=$(`sp-${gi}`); p.innerHTML=''; p.classList.add('open');
  const initS1=m.played?m.s1:0, initS2=m.played?m.s2:0;
  activePanel={gi,mi,s1:initS1,s2:initS2};
  const row=document.createElement('div'); row.className='score-row';
  row.innerHTML=`<div class="sc-lbl">${esc(m.t1.name)}</div><div class="sc-grp"><button class="sc-btn" onclick="modSc(-1,1)">-</button><div class="sc-num" id="sc1">${initS1}</div><button class="sc-btn" onclick="modSc(1,1)">+</button></div><div class="sc-sep">:</div><div class="sc-grp"><button class="sc-btn" onclick="modSc(-1,2)">-</button><div class="sc-num" id="sc2">${initS2}</div><button class="sc-btn" onclick="modSc(1,2)">+</button></div><div class="sc-lbl">${esc(m.t2.name)}</div>`;
  const acts=document.createElement('div'); acts.className='score-actions';
  const clearBtn=m.played?`<button class="sc-cancel" style="color:#E24B4A;border-color:#E24B4A;" onclick="clearScore(${gi},${mi})">✕ Borrar</button>`:'';
  acts.innerHTML=`${clearBtn}<button class="sc-cancel" onclick="closeScorePanel(${gi})">Cancelar</button><button class="sc-save" onclick="applyScore(${gi},${mi})">${m.played?'Actualizar':'Guardar'}</button>`;
  p.appendChild(row); renderSendToSection(gi,mi,p); p.appendChild(acts);
}
window.modSc=(v,n)=>{ if(!activePanel)return; if(n===1){activePanel.s1=Math.max(0,activePanel.s1+v);$('sc1').textContent=activePanel.s1;}else{activePanel.s2=Math.max(0,activePanel.s2+v);$('sc2').textContent=activePanel.s2;} };
window.closeScorePanel=gi=>$(`sp-${gi}`).classList.remove('open');

function applyScore(gi,mi,forceS1,forceS2,skipQueueSave=false){
  const m=groupData.groups[gi].matches[mi];
  if(forceS1!==undefined){m.s1=forceS1;m.s2=forceS2;}else{m.s1=activePanel.s1;m.s2=activePanel.s2;}
  m.played=true; _commitScore(gi,skipQueueSave);
}
function clearScore(gi,mi){ const m=groupData.groups[gi].matches[mi]; m.played=false;m.s1=null;m.s2=null; _commitScore(gi); toast('🗑️ Resultado eliminado'); }
function _commitScore(gi,skipQueueSave=false){
  groupData.groups[gi].manualOrder=null;
  closeScorePanel(gi); activePanel=null;
  renderGroups();
  saveCurrentTournament();
  if(!skipQueueSave) buildAndSaveQueue().catch(e=>console.error('buildAndSaveQueue',e));
}

$('btn-simulate-gs').onclick=()=>{ if(!confirm('¿Rellenar TODOS los partidos pendientes con resultados aleatorios? Se guardará y publicará.')) return; groupData.groups.forEach((g,gi)=>{ g.matches.forEach((m,mi)=>{ if(!m.played){ applyScore(gi,mi,Math.floor(Math.random()*5),Math.floor(Math.random()*5)); } }); }); toast('🎲 Resultados simulados'); };

function updateGroupProgress(){
  const all=groupData.groups.flatMap(g=>g.matches).filter(m=>m.t1.name!=='BYE'&&m.t2.name!=='BYE'), done=all.filter(m=>m.played).length;
  $('gs-fill').style.width=(all.length?Math.round(done/all.length*100):100)+'%';
  $('gs-progress-text').textContent=`${done} / ${all.length} partidos`;
  const complete=done===all.length;
  $('btn-advance').classList.toggle('ready',complete||!!state.rounds);
  $('btn-advance').textContent=state.rounds?'Ver Cuadro →':'Avanzar al Cuadro →';
  $('footer-info').innerHTML=state.rounds?'<strong>Cuadro generado.</strong> Puedes volver a verlo o seguir editando resultados.':complete?'<strong>¡Fase de grupos completada!</strong> Ya puedes configurar los cruces.':'Completa todos los partidos para continuar.';
}
$('btn-advance').onclick=()=>{
  if(state.rounds){
    // Cuadro ya generado — mostrar directamente sin reconfigurar
    $('group-screen').style.display='none';
    $('tournament-screen').style.display='block';
    renderBracket(); updateProgress();
  } else {
    renderPairingScreen();
  }
};

// ═══════════════════════════════════════════════════════
// 10. EMPAREJAMIENTOS Y CUADRO ELIMINATORIO
// ═══════════════════════════════════════════════════════
function renderPairingScreen(){
  const nGroups = groupData.groups.length;
  const grid=$('pairing-grid'); grid.innerHTML='';
  for(let i=0;i<nGroups/2;i++){
    const pairDiv=document.createElement('div'); pairDiv.className='pairing-match';
    pairDiv.innerHTML=`<div class="pairing-match-title">Cruce de Grupos ${i+1}</div>`;
    const row=document.createElement('div'); row.className='pairing-row';
    const sel1=document.createElement('select'); sel1.className='group-pairing-select'; sel1.dataset.pair=i; sel1.dataset.side=0;
    const sel2=document.createElement('select'); sel2.className='group-pairing-select'; sel2.dataset.pair=i; sel2.dataset.side=1;
    groupData.groups.forEach((g,idx)=>{
      const o1=document.createElement('option'); o1.value=idx; o1.textContent=g.name; if(idx===i*2) o1.selected=true; sel1.appendChild(o1);
      const o2=document.createElement('option'); o2.value=idx; o2.textContent=g.name; if(idx===i*2+1) o2.selected=true; sel2.appendChild(o2);
    });
    row.appendChild(sel1); const vs=document.createElement('div'); vs.className='pairing-vs-text'; vs.textContent='VS'; row.appendChild(vs); row.appendChild(sel2);
    pairDiv.appendChild(row); grid.appendChild(pairDiv);
  }
  $('group-screen').style.display='none'; $('pairing-screen').style.display='block';
}

// Generar cruces aleatorios sin repetir grupos en el mismo cruce
function randomizePairings(){
  const nGroups = groupData.groups.length;
  const nPairs = nGroups / 2;
  const indices = [...Array(nGroups).keys()]; // [0,1,2,3,...]
  
  // Fisher-Yates shuffle
  for(let i=indices.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  
  // Asignar selects: índices shuffled en pares
  const selects = [...document.querySelectorAll('.group-pairing-select')];
  selects.forEach((sel, i) => { sel.value = indices[i]; });
  toast('🔀 Cruces aleatorizados');
}
$('btn-simulate-bracket').addEventListener('click', ()=>{
  if(!state.rounds){ toast('⚠️ No hay cuadro activo'); return; }
  if(!confirm('¿Simular todos los partidos con resultados aleatorios?')) return;
  function simMatch(match){
    if(match.winner||!match.t1||!match.t2) return;
    if(match.t1.name==='BYE'||match.t2.name==='BYE') return;
    const s = Math.random()>0.5 ? 0 : 1;
    const winner = s===0?match.t1:match.t2, loser = s===0?match.t2:match.t1;
    match.winner=winner; match.loser=loser;
  }
  // Simular iterativamente hasta que no haya cambios
  let changed=true;
  while(changed){
    changed=false;
    state.rounds.forEach((round,ri)=>round.forEach((m,mi)=>{
      if(!m.winner&&m.t1&&m.t2&&m.t1.name!=='BYE'&&m.t2.name!=='BYE'){
        simMatch(m);
        if(m.winner){ changed=true; propagateUpper(state.rounds,ri,mi,m.winner); if(!state.singleElim){dropToLower(ri,mi,m.loser); autoAdvanceLowerByes();} }
      }
    }));
    if(!state.singleElim){
      (state.lRounds||[]).forEach((round,lri)=>round.forEach((m,mi)=>{
        if(!m.winner&&m.t1&&m.t2&&m.t1.name!=='BYE'&&m.t2.name!=='BYE'){
          simMatch(m);
          if(m.winner){ changed=true; propagateLower(lri,mi,m.winner); }
        }
      }));
      if(!state.gf.winner&&state.gf.t1&&state.gf.t2){
        simMatch(state.gf);
        if(state.gf.winner){ changed=true; }
      }
      const lastR=state.rounds[state.rounds.length-1];
      if(lastR[0]?.winner&&!state.gf.t1) state.gf.t1=lastR[0].winner;
    }
  }
  const champ = state.singleElim ? state.champion : state.gf?.winner;
  if(champ){
    $('champion-name').textContent=champ.name;
    $('champion-banner').classList.add('visible');
  }
  saveCurrentTournament(); renderBracket(); updateProgress();
  toast('🎲 Simulación completada');
});

$('btn-start-bracket').onclick=()=>{
  const selects=[...document.querySelectorAll('.group-pairing-select')], groupIndices=selects.map(s=>parseInt(s.value));
  if(new Set(groupIndices).size!==groupIndices.length){ toast('⚠️ No puedes repetir grupos en los cruces.'); return; }
  const pairings=[]; for(let i=0;i<groupIndices.length;i+=2) pairings.push([groupIndices[i],groupIndices[i+1]]);
  $('pairing-screen').style.display='none'; launchTournament(groupData.title, generateProfessionalNames(pairings));
};

function generateProfessionalNames(pairings){
  const nGroups = groupData.groups.length;
  const sortedGroups = groupData.groups.map(g => calcStandings(g));
  const nextPow2 = n => { let p=1; while(p<n) p*=2; return p; };

  // Jugadores reales por grupo (sin BYEs de fase de grupos)
  const realOf = gIdx => sortedGroups[gIdx]
    .filter(s => s.team.name !== 'BYE')
    .map(s => s.team.name);

  // Tamaño objetivo por grupo = bracketSize / nGroups
  const totalReal = groupData.groups.reduce((sum, _, i) => sum + realOf(i).length, 0);
  const targetBracket = nextPow2(totalReal);
  const slotPerGroup = targetBracket / nGroups;

  // Cada grupo rellenado hasta slotPerGroup con BYEs al final
  const fullOf = gIdx => {
    const real = realOf(gIdx);
    const byes = Array(Math.max(0, slotPerGroup - real.length)).fill('BYE');
    return [...real, ...byes];
  };

  // Para 2 grupos: tabla de seeding fija
  if(nGroups === 2){
    const A = fullOf(pairings[0][0]);
    const B = fullOf(pairings[0][1]);
    const n = A.length;
    const last = n - 1;

    let slots;
    if(n === 8){
      // Bracket de 16: 8 jugadores por grupo
      slots = [
        A[0], B[last],   B[3], A[last-3],
        B[1], A[last-1], A[2], B[last-2],
        B[0], A[last],   A[3], B[last-3],
        A[1], B[last-1], B[2], A[last-2],
      ];
    } else if(n === 16){
      // Bracket de 32: 16 jugadores por grupo
      slots = [
        A[0], B[last],   B[7], A[last-7],
        B[3], A[last-3], A[4], B[last-4],
        B[1], A[last-1], A[6], B[last-6],
        A[2], B[last-2], B[5], A[last-5],
        A[1], B[last-1], B[6], A[last-6],
        B[2], A[last-2], A[5], B[last-5],
        B[0], A[last],   A[7], B[last-7],
        A[3], B[last-3], B[4], A[last-4],
      ];
    } else if(n === 4){
      // Bracket de 8: 4 jugadores por grupo
      slots = [
        A[0], B[last],
        B[1], A[last-1],
        B[0], A[last],
        A[1], B[last-1],
      ];
    } else {
      // Fallback genérico: 1ºA vs últB, 2ºB vs penA, ...
      slots = [];
      for(let i=0;i<n/2;i++){
        if(i%2===0){ slots.push(A[i], B[last-i]); }
        else       { slots.push(B[i], A[last-i]); }
      }
      const half = slots.length;
      for(let i=0;i<n/2;i++){
        if(i%2===0){ slots.push(B[i], A[last-i]); }
        else       { slots.push(A[i], B[last-i]); }
      }
    }
    return slots.map(s => s ?? 'BYE');
  }

  // Para 4 grupos: tabla de seeding fija que respeta los cruces elegidos por el usuario
  // A y C = primer cruce, B y D = segundo cruce
  if(nGroups === 4){
    const A = fullOf(pairings[0][0]);
    const C = fullOf(pairings[0][1]);
    const B = fullOf(pairings[1][0]);
    const D = fullOf(pairings[1][1]);
    const n = A.length;
    const last = n - 1;

    let slots = null;
    if(n === 4){
      // Bracket de 16: 4 jugadores por grupo
      slots = [
        A[0], D[last],
        B[1], C[last-1],
        C[0], B[last],
        D[1], A[last-1],
        B[0], C[last],
        A[1], D[last-1],
        D[0], A[last],
        C[1], B[last-1],
      ];
    } else if(n === 8){
      // Bracket de 32: 8 jugadores por grupo
      slots = [
        A[0], D[last],   C[3], B[last-3],
        B[1], C[last-1], A[2], D[last-2],
        C[0], B[last],   A[3], D[last-3],
        D[1], A[last-1], C[2], B[last-2],
        B[0], C[last],   D[3], A[last-3],
        A[1], D[last-1], B[2], C[last-2],
        D[0], A[last],   B[3], C[last-3],
        C[1], B[last-1], D[2], A[last-2],
      ];
    }
    // Si n no coincide con ninguna tabla fija (p. ej. 64 jugadores = 16 por grupo)
    // delega en el fallback genérico de más abajo, que reparte a TODOS los jugadores.
    if(slots) return slots.map(s => s ?? 'BYE');
  }

  // Fallback para otros números de grupos: L/R intercalado
  const L = [], R = [];
  pairings.forEach(([a, b]) => {
    const gA = fullOf(a);
    const gB = fullOf(b);
    const n = gA.length;
    for(let i = 0; i < n/2; i++){
      const top = i, bot = n-1-i;
      const m1 = [gA[top], gB[bot]];
      const m2 = [gB[top], gA[bot]];
      if(i % 2 === 0){ L.push(...m1); R.push(...m2); }
      else            { R.push(...m1); L.push(...m2); }
    }
  });
  return [...L, ...R];
}

function launchTournament(title, names){
  const rounds = buildUpperRounds(names);
  const lRounds = doubleElim ? buildLowerRounds(rounds) : null;
  const gf = doubleElim ? { t1: null, t2: null, winner: null } : null;
  const totalMatches = rounds.flat().length + (lRounds ? lRounds.flat().length + 1 : 0);
  state = { title, numTeams: names.length, totalMatches, rounds, lRounds, gf, singleElim: !doubleElim };
  // Drop BYEs de upper R1 al lower (state.lRounds ya existe)
  rounds[0].forEach((m, mi) => {
    if(m.winner && m.loser) dropToLower(0, mi, { name:'BYE', seed:0 });
  });
  autoAdvanceLowerByes();
  $('display-title').textContent = title; $('fs-bar-title').textContent = title;
  $('tournament-screen').style.display = 'block';
  saveCurrentTournament(); renderBracket(); updateProgress(); flashHint();
}


function autoAdvanceLowerByes(){
  if(!state.lRounds) return;
  let advanced = false;
  state.lRounds.forEach((round, lri)=>{
    round.forEach((m, mi)=>{
      if(m.winner) return;
      const t1IsBye = m.t1?.name==='BYE';
      const t2IsBye = m.t2?.name==='BYE';
      if(t1IsBye && t2IsBye){
        // BYE vs BYE — propagar BYE para que la siguiente ronda también se resuelva
        const byeTeam = {name:'BYE', seed:0};
        m.winner = byeTeam; m.loser = byeTeam;
        propagateLower(lri, mi, byeTeam);
        advanced = true;
      } else if(t1IsBye && m.t2 && !t2IsBye){
        m.winner = m.t2; m.loser = m.t1;
        propagateLower(lri, mi, m.t2);
        advanced = true;
      } else if(t2IsBye && m.t1 && !t1IsBye){
        m.winner = m.t1; m.loser = m.t2;
        propagateLower(lri, mi, m.t1);
        advanced = true;
      }
    });
  });
  if(advanced) autoAdvanceLowerByes();
}

function buildUpperRounds(names){
  const objs = names.map((n,i) => ({name:n, seed:i+1}));
  const first = [];
  for(let i=0; i<objs.length; i+=2)
    first.push({t1:objs[i], t2:objs[i+1]||null, winner:null, loser:null});
  const rounds = [first];
  for(let p=first.length; p>1; p=Math.ceil(p/2))
    rounds.push(Array.from({length:Math.ceil(p/2)}, ()=>({t1:null,t2:null,winner:null,loser:null})));
  // Auto-advance BYEs en upper R1 — solo propagar al upper siguiente
  // El drop al lower se hace en launchTournament después de construir state
  rounds[0].forEach((m,mi)=>{
    if(!m.t2||m.t2.name==='BYE'){
      m.winner=m.t1; m.loser={name:'BYE',seed:0};
      propagateUpper(rounds,0,mi,m.t1);
    } else if(m.t1&&m.t1.name==='BYE'){
      m.winner=m.t2; m.loser={name:'BYE',seed:0};
      propagateUpper(rounds,0,mi,m.t2);
    }
  });
  return rounds;
}

function buildLowerRounds(upperRounds){
  /*
    Double elimination lower bracket structure:
    - L odd rounds  (1,3,5...): lower survivors vs lower survivors → size halves
    - L even rounds (2,4,6...): upper losers drop in vs lower survivors → same size as prev lower round

    For upper with R rounds and n first-round matches:
    Upper R1 → n losers → pair them → L-R1 has n/2 matches
    Upper R2 → n/2 losers drop into L-R2 (n/2 matches, same as L-R1)
    L-R3: n/4 matches (survivors only)
    Upper R3 → n/4 losers drop into L-R4 (n/4 matches)
    L-R5: n/8 matches
    ...until 1 match remains → winner goes to Grand Final
  */
  const uR = upperRounds.length; // number of upper rounds
  const n  = upperRounds[0].length; // matches in upper R1

  const lRounds = [];
  let size = Math.floor(n / 2); // L-R1 has n/2 matches

  // L-R1: pair up the 2*size losers from upper R1
  const lr1 = Array.from({length: size}, (_,i) => ({
    t1: null, t2: null, winner: null, loser: null,
    fromUpper: [i*2, i*2+1], // indices into upperRounds[0]
    type: 'lower-only'
  }));
  lRounds.push(lr1);

  // For each subsequent upper round (ur = 1..uR-1), add two lower rounds:
  //   even: drop losers from upper round ur → size stays same as previous lower round
  //   odd:  survivors only → size halves
  for(let ur = 1; ur < uR; ur++){
    const prevSize = lRounds[lRounds.length-1].length;

    // Even lower round: upper losers drop in (one per lower match)
    // upper round ur has uR/2^ur matches = prevSize matches (they align)
    lRounds.push(Array.from({length: prevSize}, (_,i) => ({
      t1: null, t2: null, winner: null, loser: null,
      fromUpperRound: ur, fromUpperIdx: i,
      type: 'drop-in'  // t1 = upper loser, t2 = prev lower winner (or vice versa, alternating)
    })));

    // Odd lower round: survivors only (unless we're at the last upper round)
    if(ur < uR - 1){
      const newSize = Math.ceil(prevSize / 2);
      lRounds.push(Array.from({length: newSize}, () => ({
        t1: null, t2: null, winner: null, loser: null,
        type: 'lower-only'
      })));
    }
  }

  return lRounds;
}

function propagateUpper(rounds, ri, mi, winner){
  if(ri+1 < rounds.length){
    const nmi = Math.floor(mi/2);
    rounds[ri+1][nmi][mi%2===0?'t1':'t2'] = winner;
  }
}

function dropToLower(upperRound, upperMatchIdx, loser){
  if(!state.lRounds?.length || !loser) return;

  if(upperRound === 0){
    // Upper R1 losers → L-R1, paired in order (0,1 → lm0; 2,3 → lm1...)
    const lmi = Math.floor(upperMatchIdx / 2);
    const slot = upperMatchIdx % 2 === 0 ? 't1' : 't2';
    if(state.lRounds[0]?.[lmi]) state.lRounds[0][lmi][slot] = loser;
  } else {
    // Upper round ur > 0 → drop-in lower round at index ur*2 - 1
    const lri = upperRound * 2 - 1;
    if(lri < state.lRounds.length){
      const dropRound = state.lRounds[lri];
      // Alternate inversion each drop-in round to prevent rematches across rounds
      // ur=1 (R2) → inverted, ur=2 (R3) → normal, ur=3 (R4) → inverted...
      const shouldInvert = upperRound % 2 === 1;
      const targetIdx = shouldInvert ? (dropRound.length - 1) - upperMatchIdx : upperMatchIdx;
      const m = dropRound[targetIdx];
      if(m) m.t1 = loser;
    }
  }
}

function propagateLower(lri, mi, winner){
  const nextLri = lri + 1;
  if(nextLri < state.lRounds.length){
    const nextRound = state.lRounds[nextLri];
    if(nextRound[0]?.type === 'drop-in'){
      // Winner goes to t2 of the matching drop-in match
      if(nextRound[mi]) nextRound[mi].t2 = winner;
    } else {
      // lower-only: pair up winners
      const nmi = Math.floor(mi / 2);
      if(nextRound[nmi]) nextRound[nmi][mi%2===0?'t1':'t2'] = winner;
    }
  } else {
    // Last lower round winner → Gran Final t2
    state.gf.t2 = winner;
  }
}function renderBracket(){
  // Auto-avanzar BYEs pendientes (por si el torneo fue guardado antes del fix)
  if(state.lRounds) autoAdvanceLowerByes();
  const c=$('bracket-container'); c.innerHTML='';
  if(state.numTeams===64){ c.classList.add('size-64'); c.classList.remove('size-32'); }
  else if(state.numTeams===32){ c.classList.add('size-32'); c.classList.remove('size-64'); }
  else { c.classList.remove('size-32'); c.classList.remove('size-64'); }
  const wrap = document.createElement('div'); wrap.className='bracket-full-wrap';
  // Upper bracket
  if(!state.singleElim){ const upperLabel = document.createElement('div'); upperLabel.className='bracket-section-label'; upperLabel.textContent='▲ Upper Bracket'; wrap.appendChild(upperLabel); }
  const upperWrap = document.createElement('div'); upperWrap.style.cssText='display:flex;gap:2rem;align-items:center;position:relative;';
  renderUpperInto(upperWrap);
  wrap.appendChild(upperWrap);
  if(!state.singleElim){
    // Divider
    const div1 = document.createElement('div'); div1.className='bracket-divider'; wrap.appendChild(div1);
    // Lower bracket
    const lowerLabel = document.createElement('div'); lowerLabel.className='bracket-section-label'; lowerLabel.textContent='▼ Lower Bracket';
    wrap.appendChild(lowerLabel);
    const lowerWrap = document.createElement('div'); lowerWrap.className='lower-bracket-wrap';
    renderLowerInto(lowerWrap);
    wrap.appendChild(lowerWrap);
    // Grand Final
    const div2 = document.createElement('div'); div2.className='bracket-divider'; wrap.appendChild(div2);
    const gfWrap = document.createElement('div'); gfWrap.className='grand-final-wrap';
    const gfLabel = document.createElement('div'); gfLabel.className='grand-final-label'; gfLabel.textContent='🏆 Gran Final';
    gfWrap.appendChild(gfLabel);
    const gfCard = buildCard(state.gf, 'gf', 0, true); gfCard.id='match-gf-0'; gfWrap.appendChild(gfCard);
    wrap.appendChild(gfWrap);
  }
  c.appendChild(wrap);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('class','bracket-svg'); svg.id='bracket-svg'; c.appendChild(svg);
  setTimeout(()=>scaleBracket(),60);
  setTimeout(()=>scaleBracket(),260);
}

function renderUpperInto(container){
  const {rounds} = state, total = rounds.length;
  const halfR = total - 1;
  const root = document.createElement('div'); root.className='bracket-dual';
  const left = document.createElement('div'); left.className='bracket-half-left';
  for(let ri=0; ri<halfR; ri++){
    const h = Math.ceil(rounds[ri].length/2);
    left.appendChild(makeCol(roundLabel(total,ri), rounds[ri].slice(0,h), ri, 0, 'left'));
  }
  const center = document.createElement('div'); center.className='bracket-center';
  const ch = document.createElement('div'); ch.className='round-header'; ch.textContent=state.singleElim?'Final':'Final Upper'; center.appendChild(ch);
  const ca = document.createElement('div'); ca.className='center-match-area';
  ca.style.cssText = 'padding:1.5rem;border-radius:var(--radius-lg);';
  const finalMatch = buildCard(rounds[total-1][0], total-1, 0, false);
  finalMatch.id=`match-${total-1}-0`; ca.appendChild(finalMatch); center.appendChild(ca);
  const right = document.createElement('div'); right.className='bracket-half-right';
  for(let ri=0; ri<halfR; ri++){
    const h = Math.ceil(rounds[ri].length/2);
    right.appendChild(makeCol(roundLabel(total,ri), rounds[ri].slice(h), ri, h, 'right'));
  }
  root.appendChild(left); root.appendChild(center); root.appendChild(right); container.appendChild(root);
}

function renderLowerInto(container){
  const { lRounds } = state; if(!lRounds?.length) return;
  lRounds.forEach((round, lr)=>{
    const col = document.createElement('div'); col.className='lower-round-col';
    const hdr = document.createElement('div'); hdr.className='round-header';
    // Label based on type
    const isDropIn = round[0]?.type === 'drop-in';
    const uRound = isDropIn ? (round[0]?.fromUpperRound ?? 0) : null;
    hdr.textContent = isDropIn
      ? `Perdedores R${uRound + 1}`
      : `Lower R${lr + 1}`;
    col.appendChild(hdr);
    const mc = document.createElement('div'); mc.className='lower-matches';
    round.forEach((m, mi)=>{
      const card = buildCard(m, `l${lr}`, mi, false);
      card.id=`match-l${lr}-${mi}`; mc.appendChild(card);
    });
    col.appendChild(mc); container.appendChild(col);
  });
}

function makeCol(label, matches, ri, startMi, side){
  const col=document.createElement('div'); col.className='round-col';
  const h=document.createElement('div'); h.className='round-header'; h.textContent=label; col.appendChild(h);
  const mc=document.createElement('div'); mc.className='match-col';
  matches.forEach((m,li)=>{
    const wr=document.createElement('div'); wr.className='match-wrapper';
    const card=buildCard(m,ri,startMi+li); card.id=`match-${ri}-${startMi+li}`; wr.appendChild(card);
    const step=100/matches.length; wr.style.top=`${li*step+step/2}%`; mc.appendChild(wr);
  });
  col.appendChild(mc); return col;
}

function buildCard(match, ri, mi, isFinal=false){
  const card=document.createElement('div'); card.className='match'+(isFinal?' final-match':'');
  const isLower = typeof ri === 'string' && ri.startsWith('l');
  const isGF = ri === 'gf';
  const lri = isLower ? parseInt(ri.slice(1)) : null;

  // Estado de cola — resaltar visualmente igual que grupos
  if(!IS_DISPLAY && !IS_BRACKET && !match.winner &&
     match.t1 && match.t2 && match.t1.name!=='BYE' && match.t2.name!=='BYE'){
    const bType = isGF?'gf':isLower?'lower':'upper';
    const bRi   = isGF?0:isLower?lri:ri;
    if(isBracketMatchLive(bType, bRi, mi)){
      card.classList.add('match-live');
    } else if(isBracketMatchQueued(bType, bRi, mi)){
      card.classList.add('match-queued');
    }
    // Resaltar si es el partido abierto en el panel
    if(_bsp && _bsp.isGF===isGF && _bsp.isLower===isLower &&
       _bsp.lri===lri && _bsp.ri===ri && _bsp.mi===mi){
      card.classList.add('match-selected');
    }
  }
  [match.t1, match.t2].forEach((team, si)=>{
    const slot=document.createElement('div');
    const isBye=team&&team.name==='BYE';
    const isWin=match.winner&&team&&match.winner.name===team.name;
    const isLos=match.winner&&team&&match.winner.name!==team.name;
    slot.className='team-slot'+(isBye?' bye empty':'')+((!team)?' empty':'')+(isWin?' winner':'')+(isLos?' loser':'');
    if(isBye){
      slot.innerHTML='<span class="slot-seed"></span><span class="slot-name" style="color:transparent;user-select:none;">—</span><span class="slot-win-icon"></span>';
      slot.style.cssText='cursor:default;pointer-events:none;opacity:0.15;';
    } else {
      slot.innerHTML=`<span class="slot-seed">${team?'#'+team.seed:''}</span><span class="slot-name">${team?esc(team.name):'Por decidir'}</span><span class="slot-win-icon">▲</span>`;
    }
    if(!isBye&&team&&!IS_DISPLAY&&!IS_BRACKET){
      const _ri=ri, _mi=mi, _si=si, _lri=lri, _teamName=team?.name;
      slot.addEventListener('click', (e)=>{
        e.stopPropagation();
        openBracketScorePanel(ri, mi, isGF, isLower, lri);
      });
    }
    card.appendChild(slot);
  });


  return card;
}


function renderBracketSendToSection(bType, bRi, bMi, container){
  const section = document.createElement('div'); section.className='send-to-section';
  const live   = isBracketMatchLive(bType, bRi, bMi);
  const queued = isBracketMatchQueued(bType, bRi, bMi);
  const pos    = queued ? getBracketMatchQueuePos(bType, bRi, bMi) : null;
  const btn = document.createElement('button');
  if(live){
    btn.className='send-to-btn sent'; btn.textContent='▶ En juego'; btn.disabled=true;
  } else if(queued){
    btn.className='send-to-btn queued'; btn.textContent=`📋 En cola #${pos}`;
    btn.addEventListener('click', ()=>{ removeBracketMatchFromQueue(bType,bRi,bMi); closeBracketScorePanel(); });
  } else {
    btn.className='send-to-btn'; btn.textContent='➕ Añadir a cola';
    btn.addEventListener('click', ()=>{ addBracketMatchToQueue(bType,bRi,bMi); closeBracketScorePanel(); });
  }
  section.appendChild(btn); container.appendChild(section);
}

// ── 10.1 Panel de puntuación del bracket ───────────────
let _bsp = null; // {ri, mi, isGF, isLower, lri, s1, s2}

function openBracketScorePanel(ri, mi, isGF, isLower, lri){
  const match = isGF ? state.gf
    : isLower ? state.lRounds?.[lri]?.[mi]
    : state.rounds?.[ri]?.[mi];
  if(!match || !match.t1 || !match.t2) return;
  // Partidos contra BYE se resuelven solos: no se editan
  if(match.t1.name==='BYE' || match.t2.name==='BYE') return;

  // Partido ya jugado → modo edición: se precarga el resultado guardado (o 1-0 para el
  // ganador si es un resultado antiguo sin marcador) y se permite corregirlo o anularlo.
  const editing = !!match.winner;
  let s1 = 0, s2 = 0;
  if(editing){
    if(match.s1!=null && match.s2!=null){ s1 = match.s1; s2 = match.s2; }
    else if(match.winner.name===match.t1.name){ s1 = 1; } else { s2 = 1; }
  }
  _bsp = {ri, mi, isGF, isLower, lri, s1, s2, editing};

  const label = isGF ? 'Gran Final'
    : isLower ? `Lower R${lri+1}` : `Upper R${ri+1}`;
  $('bsp-label').textContent = editing ? `${label} · Editar resultado (ganó ${match.winner.name})` : label;
  const saveBtn = $('bsp-save-btn'), clearBtn = $('bsp-clear-btn');
  if(saveBtn) saveBtn.textContent = editing ? 'Actualizar ✓' : 'Guardar resultado ✓';
  if(clearBtn) clearBtn.style.display = editing ? '' : 'none';

  $('bsp-row').innerHTML = `
    <div class="sc-lbl">${esc(match.t1.name)}</div>
    <div class="sc-grp">
      <button class="sc-btn" onclick="modBSP(-1,1)">-</button>
      <div class="sc-num" id="bsp-s1">${s1}</div>
      <button class="sc-btn" onclick="modBSP(1,1)">+</button>
    </div>
    <div class="sc-sep">:</div>
    <div class="sc-grp">
      <button class="sc-btn" onclick="modBSP(-1,2)">-</button>
      <div class="sc-num" id="bsp-s2">${s2}</div>
      <button class="sc-btn" onclick="modBSP(1,2)">+</button>
    </div>
    <div class="sc-lbl">${esc(match.t2.name)}</div>`;

  // Botón de cola — igual que en grupos (no aplica a un partido ya jugado)
  const bType = isGF?'gf':isLower?'lower':'upper';
  const bRi   = isGF?0:isLower?lri:ri;
  const existingQ = $('bsp-queue-section');
  if(existingQ) existingQ.remove();
  if(!editing){
    const qSection = document.createElement('div');
    renderBracketSendToSection(bType, bRi, mi, qSection);
    qSection.id = 'bsp-queue-section';
    $('bsp-row').after(qSection);
  }

  $('bracket-score-panel').style.display = 'block';
}

window.closeBracketScorePanel = () => {
  $('bracket-score-panel').style.display = 'none';
  _bsp = null;
  renderBracket();
};

window.modBSP = (v, n) => {
  if(!_bsp) return;
  if(n===1){ _bsp.s1 = Math.max(0, _bsp.s1+v); $('bsp-s1').textContent = _bsp.s1; }
  else     { _bsp.s2 = Math.max(0, _bsp.s2+v); $('bsp-s2').textContent = _bsp.s2; }
};

window.saveBracketScore = () => {
  if(!_bsp) return;
  const {ri, mi, isGF, isLower, lri, s1, s2} = _bsp;
  if(s1 === s2){ toast('⚠️ El resultado no puede ser un empate'); return; }
  const winnerSi = s1 > s2 ? 0 : 1;
  const bType = isGF?'gf':isLower?'lower':'upper';
  const bRi   = isGF?0:isLower?lri:ri;
  const match = getBracketMatch(state, bType, bRi, mi);
  if(!match) return;

  if(match.winner){
    const newWinner = winnerSi===0 ? match.t1 : match.t2;
    if(newWinner.name === match.winner.name){
      // Mismo ganador: solo se corrige el marcador, no cambia nada del cuadro
      match.s1 = s1; match.s2 = s2;
      closeBracketScorePanel();
      saveCurrentTournament();
      toast('✓ Resultado actualizado');
      return;
    }
    // Cambia el ganador: anular este partido y todo lo que dependía de él
    if(!confirmBracketUndo(bType, bRi, mi, `¿Cambiar el ganador a ${newWinner.name}?`)) return;
    undoBracketMatch(state, bType, bRi, mi);
    afterBracketUndo();
  }

  closeBracketScorePanel();
  match.s1 = s1; match.s2 = s2;
  if(isGF) window.selectWinnerGF(winnerSi);
  else if(isLower) window.selectWinnerLower(lri, mi, winnerSi);
  else window.selectWinner(ri, mi, winnerSi);
};

// Anular el resultado (botón "Anular resultado" del panel en modo edición)
window.clearBracketScore = () => {
  if(!_bsp) return;
  const {ri, mi, isGF, isLower, lri} = _bsp;
  const bType = isGF?'gf':isLower?'lower':'upper';
  const bRi   = isGF?0:isLower?lri:ri;
  const match = getBracketMatch(state, bType, bRi, mi);
  if(!match?.winner) return;
  if(!confirmBracketUndo(bType, bRi, mi, `¿Anular el resultado de ${match.t1.name} vs ${match.t2.name}? El partido volverá a quedar pendiente.`)) return;
  undoBracketMatch(state, bType, bRi, mi);
  closeBracketScorePanel();
  afterBracketUndo();
  toast('↺ Resultado anulado');
};

// ── 10.2 Editar / anular resultados del cuadro ─────────
function getBracketMatch(st, bType, ri, mi){
  return bType==='gf' ? st.gf
    : bType==='lower' ? st.lRounds?.[ri]?.[mi]
    : st.rounds?.[ri]?.[mi];
}

// Casilla del lower donde cae el perdedor de un partido del upper (misma lógica que dropToLower)
function lowerDropTarget(st, ur, umi){
  if(!st.lRounds?.length) return null;
  if(ur === 0) return {lri:0, lmi:Math.floor(umi/2), slot: umi%2===0 ? 't1' : 't2'};
  const lri = ur*2 - 1, round = st.lRounds[lri];
  if(!round) return null;
  const lmi = ur%2===1 ? (round.length-1) - umi : umi;
  return {lri, lmi, slot:'t1'};
}

// Casilla a la que avanza el ganador de un partido del lower (misma lógica que propagateLower)
function lowerNextTarget(st, lri, mi){
  const next = st.lRounds[lri+1];
  if(!next) return {gf:true};
  if(next[0]?.type === 'drop-in') return {lri:lri+1, lmi:mi, slot:'t2'};
  return {lri:lri+1, lmi:Math.floor(mi/2), slot: mi%2===0 ? 't1' : 't2'};
}

// Anula el resultado de un partido y, en cascada, todos los partidos posteriores a los
// que llegaron su ganador o su perdedor (y vacía esas casillas). Devuelve la lista de
// partidos reales (sin BYE) cuyo resultado se ha borrado; el primero es el propio partido.
function undoBracketMatch(st, bType, ri, mi, cleared=[]){
  const m = getBracketMatch(st, bType, ri, mi);
  if(!m?.winner) return cleared;
  if(m.t1?.name!=='BYE' && m.t2?.name!=='BYE') cleared.push(`${m.t1?.name} vs ${m.t2?.name}`);
  m.winner = null; m.loser = null; delete m.s1; delete m.s2;

  // Vacía la casilla a la que avanzó alguien (anulando antes ese partido si ya se jugó)
  const free = (tb, tri, tmi, slot) => {
    undoBracketMatch(st, tb, tri, tmi, cleared);
    const t = getBracketMatch(st, tb, tri, tmi);
    if(t) t[slot] = null;
  };

  if(bType === 'upper'){
    if(ri+1 < st.rounds.length) free('upper', ri+1, Math.floor(mi/2), mi%2===0 ? 't1' : 't2');
    else if(st.gf) free('gf', 0, 0, 't1');
    else st.champion = null; // eliminación simple: era la final
    if(!st.singleElim){
      const d = lowerDropTarget(st, ri, mi);
      if(d) free('lower', d.lri, d.lmi, d.slot);
    }
  } else if(bType === 'lower'){
    const n = lowerNextTarget(st, ri, mi);
    if(n.gf){ if(st.gf) free('gf', 0, 0, 't2'); }
    else free('lower', n.lri, n.lmi, n.slot);
  }
  // gf: no tiene partidos posteriores
  return cleared;
}

// Pide confirmación mostrando qué resultados posteriores se van a borrar (simulación sobre una copia)
function confirmBracketUndo(bType, ri, mi, question){
  const deps = undoBracketMatch(JSON.parse(JSON.stringify(state)), bType, ri, mi).slice(1);
  const extra = deps.length
    ? `\n\nTambién se borrarán ${deps.length} resultado${deps.length>1?'s':''} posterior${deps.length>1?'es':''} que dependía${deps.length>1?'n':''} de este partido:\n• ${deps.join('\n• ')}`
    : '';
  return confirm(question + extra);
}

// Tras anular: quitar de la cola partidos del cuadro que ya no son válidos, avisar de
// partidos en juego afectados, y guardar/redibujar
function afterBracketUndo(){
  const stillValid = (bType, bRi, bMi, t1, t2) => {
    const m = getBracketMatch(state, bType, bRi, bMi);
    return !!m && !m.winner && m.t1?.name===t1 && m.t2?.name===t2;
  };
  const before = globalQueue.length;
  globalQueue = globalQueue.filter(q => q.sid!==sessionId || q.type!=='bracket' || stillValid(q.bType, q.bRi, q.bMi, q.t1, q.t2));
  if(globalQueue.length !== before) saveGlobalQueue();
  connectedDevices.forEach(d => {
    const cm = d.currentMatch;
    if(d.busy && cm?.type==='bracket' && cm.sid===sessionId && !stillValid(cm.bType, cm.bRi, cm.bMi, cm.t1, cm.t2))
      setTimeout(() => toast(`⚠️ ${cm.t1} vs ${cm.t2} (${d.name}) ya no es válido: su resultado se ignorará`), 2600);
  });
  const champ = state.singleElim ? state.champion : state.gf?.winner;
  if(!champ) $('champion-banner').classList.remove('visible');
  saveCurrentTournament(); renderBracket(); updateProgress();
  buildAndSaveQueue().catch(()=>{});
}

function selectWinner(ri, mi, si){
  const match = state.rounds[ri][mi];
  if(match.winner){ toast('Ya hay un ganador.'); return; }
  if(!match.t1||!match.t2){ toast('Faltan equipos en este partido.'); return; }
  const winner = si===0 ? match.t1 : match.t2;
  const loser  = si===0 ? match.t2 : match.t1;
  match.winner = winner; match.loser = loser;
  propagateUpper(state.rounds, ri, mi, winner);
  const lastR = state.rounds[state.rounds.length-1];
  if(state.singleElim){
    if(lastR.length===1 && lastR[0].winner){
      state.champion = lastR[0].winner;
      $('champion-name').textContent = state.champion.name;
      $('champion-banner').classList.add('visible');
    }
    toast(`✓ ${winner.name} avanza · ${loser.name} eliminado`);
  } else {
    if(lastR.length===1 && lastR[0].winner) state.gf.t1 = lastR[0].winner;
    dropToLower(ri, mi, loser);
    autoAdvanceLowerByes();
    toast(`✓ ${winner.name} avanza · ${loser.name} al lower`);
  }
  saveCurrentTournament(); renderBracket(); updateProgress();
}

function selectWinnerLower(lri, mi, si){
  const match = state.lRounds[lri][mi];
  if(match.winner){ toast('Ya hay un ganador.'); return; }
  if(!match.t1||!match.t2){ toast('Faltan equipos.'); return; }
  const winner = si===0 ? match.t1 : match.t2;
  const loser  = si===0 ? match.t2 : match.t1;
  match.winner = winner; match.loser = loser;
  propagateLower(lri, mi, winner);
  toast(`✓ ${winner.name} avanza en lower`);
  saveCurrentTournament(); renderBracket(); updateProgress();
}

function selectWinnerGF(si){
  if(state.gf.winner){ toast('Ya hay un ganador.'); return; }
  if(!state.gf.t1||!state.gf.t2){ toast('Faltan equipos para la Gran Final.'); return; }
  const winner = si===0 ? state.gf.t1 : state.gf.t2;
  state.gf.winner = winner;
  $('champion-name').textContent = winner.name;
  if(!isFsMode){ $('champion-banner').classList.add('visible'); $('champion-banner').scrollIntoView({behavior:'smooth',block:'center'}); }
  toast(`🏆 ¡${winner.name} es el CAMPEÓN!`);
  saveCurrentTournament(); renderBracket(); updateProgress();
}

// Resetear un partido del upper (antigua API, expuesta en window). Usa el mismo motor en
// cascada que la edición desde el panel; la versión anterior no limpiaba bien el lower.
function resetWinner(ri, mi){
  if(!state.rounds?.[ri]?.[mi]?.winner) return;
  if(!confirmBracketUndo('upper', ri, mi, '¿Resetear este partido?')) return;
  undoBracketMatch(state, 'upper', ri, mi);
  afterBracketUndo();
  toast('✓ Resultado reseteado');
}

function roundLabel(total, ri){ return(['Final','Semifinal','Cuartos de Final','Octavos de Final'][total-1-ri]??`Ronda ${ri+1}`); }

function updateProgress(){
  const uPlayed = state.rounds.flat().filter(m=>m.winner).length;
  const lPlayed = (state.lRounds||[]).flat().filter(m=>m.winner).length;
  const gfPlayed = state.gf?.winner ? 1 : 0;
  const played = uPlayed + lPlayed + gfPlayed;
  $('progress-fill').style.width=Math.round(played/state.totalMatches*100)+'%';
  const txt=`${played} / ${state.totalMatches} partidos`;
  $('progress-text').textContent=$('fs-bar-progress').textContent=txt;
}

// ═══════════════════════════════════════════════════════
// 11. PANTALLA DE VISUALIZACIÓN
// ═══════════════════════════════════════════════════════
function renderDisplayScreen(data){
  if(!data?.groups) return;
  $('dv-title').textContent=data.title||'—';
  const cont=$('dv-groups'); cont.innerHTML='';
  const allM=data.groups.flatMap(g=>g.matches).filter(m=>m.t1.name!=='BYE'&&m.t2.name!=='BYE'), played=allM.filter(m=>m.played).length, total=allM.length;
  $('dv-progress-text').textContent=`${played} / ${total} partidos jugados`;
  $('dv-progress-fill').style.width=total?Math.round(played/total*100)+'%':'0%';
  const n=data.groups.length, topCount=Math.ceil(n/2), botCount=Math.floor(n/2);
  const contW=cont.clientWidth||window.innerWidth, gapPx=Math.round(Math.min(contW*0.012,10));
  const cardW=n===2
    ? `calc((100% - ${gapPx}px) / 2)`
    : `calc((100% - ${(topCount-1)*gapPx}px) / ${topCount})`;
  function buildDvCard(g){
    const st=calcStandings(g).filter(s=>s.team.name!=='BYE');
    const rows=st.map((s,rank)=>{
      const gd=s.GF-s.GA, gdTxt=s.P>0?(gd>0?`+${gd}`:`${gd}`):'—', gdCls=gd>0?'dv-dg-pos':gd<0?'dv-dg-neg':'';
      const pj=s.P>0?s.P:'—', pts=s.P>0?s.Pts:'—';
      const sep=(rank===0&&st.length>1)?'<tr class="dv-sep-row"><td colspan="5"></td></tr>':'';
      return `<tr${rank===0?' class="dv-row-first"':''}><td><span class="dv-rank${rank===0?' top':''}">${rank+1}</span></td><td class="td-name">${esc(s.team.name)}</td><td>${pj}</td><td class="${gdCls}">${gdTxt}</td><td><span class="dv-pts">${pts}</span></td></tr>${sep}`;
    }).join('');
    const card=document.createElement('div'); card.className='dv-group-card'; card.style.width=cardW;
    card.innerHTML=`<div class="dv-group-name">${esc(g.name)}</div><div class="dv-table-wrap"><table class="dv-table"><thead><tr><th style="width:2em">#</th><th class="th-name">Equipo</th><th>PJ</th><th>DG</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    return card;
  }
  if(n===2){
    const row=document.createElement('div'); row.className='dv-row';
    data.groups.forEach(g=>row.appendChild(buildDvCard(g))); cont.appendChild(row);
  } else {
    const row1=document.createElement('div'); row1.className='dv-row';
    data.groups.slice(0,topCount).forEach(g=>row1.appendChild(buildDvCard(g))); cont.appendChild(row1);
    if(botCount>0){ const row2=document.createElement('div'); row2.className='dv-row'; data.groups.slice(topCount).forEach(g=>row2.appendChild(buildDvCard(g))); cont.appendChild(row2); }
  }
}
function renderBracketDisplay(data){
  if(!data?.rounds) return;

  // ── Diseño personalizado (11.2): uno por tamaño de cuadro y tipo de eliminación ──
  const layoutKey = bracketLayoutKey(data);
  if(_designMode && _designKey !== layoutKey){
    _designKey = layoutKey;
    _designDraft = JSON.parse(JSON.stringify(_pubLayouts?.[layoutKey] || {blocks:{}, style:{}}));
    _designDirty = false;
  }
  const layout = _designMode ? _designDraft : (_pubLayouts?.[layoutKey] || null);
  const custom = !!layout;                 // sin diseño guardado → colocación automática de siempre
  const lst = (custom && layout.style) || {};
  applyLayoutStyle(lst);

  const vW=window.innerWidth, vH=window.innerHeight;
  const footEl = document.querySelector('#display-screen .dv-footer');
  const footH = footEl && footEl.style.display!=='none' ? (footEl.offsetHeight||36) : 0;
  const availH = vH - footH;

  const cont=$('dv-groups');
  cont.innerHTML='';
  cont.style.cssText=`flex:1;overflow:hidden;position:relative;background:var(--bg);height:${availH}px;`;

  const cls = data.numTeams===64?'size-64':data.numTeams===32?'size-32':'';
  const savedState=state; state=data;

  // ── Contenedor UPPER ──
  const upperC=document.createElement('div');
  upperC.id='pub-upper-c'; upperC.className=cls;
  upperC.style.cssText='position:absolute;top:0;left:0;transform-origin:top left;min-width:max-content;padding:0.6rem 0 0.4rem;';
  // Bloques independientes (solo en diseño personalizado): título y Gran Final
  let titleC=null, gfC=null;

  try{
    const {rounds}=state, total=rounds.length, halfR=total-1;
    const uWrap=document.createElement('div'); uWrap.style.cssText='display:flex;gap:2rem;align-items:flex-start;position:relative;';

    // Títulos arriba del bracket (sobre las columnas laterales)
    const left=document.createElement('div'); left.className='bracket-half-left';
    for(let ri=0;ri<halfR;ri++){ const h=Math.ceil(rounds[ri].length/2); left.appendChild(makeCol(roundLabel(total,ri),rounds[ri].slice(0,h),ri,0,'left')); }
    const center=document.createElement('div'); center.className='bracket-center'; center.style.cssText='min-width:200px;display:flex;flex-direction:column;align-items:center;';

    // Nombre del torneo y Cervecería Mané — arriba, sin espaciador
    const titleStack = document.createElement('div');
    titleStack.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:0.3rem;margin-bottom:0.6rem;text-align:center;white-space:nowrap;';
    const tournName = document.createElement('div');
    tournName.textContent = data.title || '';
    tournName.style.cssText = 'font-family:"Barlow Condensed",sans-serif;font-size:3.2rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text);line-height:1;';
    const brand = document.createElement('div');
    brand.textContent = 'Cervecería Mané';
    brand.style.cssText = 'font-family:"Barlow Condensed",sans-serif;font-size:1.6rem;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--gold);line-height:1;';
    if(lst.showBrand===false) brand.style.display='none';
    titleStack.appendChild(tournName); titleStack.appendChild(brand);
    if(custom){
      titleC = document.createElement('div'); titleC.id='pub-title-c';
      titleC.style.cssText='position:absolute;top:0;left:0;transform-origin:top left;width:max-content;';
      titleStack.style.marginBottom='0';
      titleC.appendChild(titleStack);
      if(lst.showTitle===false && !_designMode) titleC.style.display='none';
      if(lst.showTitle===false && _designMode) titleC.style.opacity='0.25';
    } else {
      center.appendChild(titleStack);
    }

    const ch=document.createElement('div'); ch.className='round-header'; ch.textContent=data.singleElim?'Final':'Final Upper'; center.appendChild(ch);
    const ca=document.createElement('div'); ca.className='center-match-area';
    const finalM=buildCard(rounds[total-1][0],total-1,0,false); finalM.id=`match-${total-1}-0`; ca.appendChild(finalM); center.appendChild(ca);

    // Gran Final — misma posición pero más grande
    if(custom && data.gf){
      // Diseño personalizado: la Gran Final es un bloque propio (se muestra aunque falten finalistas)
      gfC = document.createElement('div'); gfC.id='pub-gf-c';
      gfC.style.cssText='position:absolute;top:0;left:0;transform-origin:top left;width:max-content;min-width:220px;display:flex;flex-direction:column;align-items:center;';
      const gfH=document.createElement('div'); gfH.className='round-header'; gfH.textContent='🏆 Gran Final'; gfH.style.cssText='color:var(--gold);font-size:1rem;';
      const gfCard=buildCard(data.gf,'gf',0,false); gfCard.id='match-gf-0-pub'; gfCard.style.width='220px';
      gfC.appendChild(gfH); gfC.appendChild(gfCard);
    } else if(data.gf?.t1&&data.gf?.t2){
      const gfSpacer = document.createElement('div');
      gfSpacer.style.cssText = 'height:1.5rem;';
      center.appendChild(gfSpacer);
      const gfH=document.createElement('div'); gfH.className='round-header'; gfH.textContent='🏆 Gran Final'; gfH.style.cssText='color:var(--gold);font-size:1rem;'; center.appendChild(gfH);
      const gfA=document.createElement('div'); gfA.style.cssText='padding:0.3rem;display:flex;justify-content:center;transform:scale(1.35);transform-origin:top center;margin-top:0.3rem;';
      const gfCard=buildCard(data.gf,'gf',0,false); gfCard.id='match-gf-0-pub'; gfA.appendChild(gfCard); center.appendChild(gfA);
    }
    const right=document.createElement('div'); right.className='bracket-half-right';
    for(let ri=0;ri<halfR;ri++){ const h=Math.ceil(rounds[ri].length/2); right.appendChild(makeCol(roundLabel(total,ri),rounds[ri].slice(h),ri,h,'right')); }
    uWrap.appendChild(left); uWrap.appendChild(center); uWrap.appendChild(right);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('class','bracket-svg'); svg.id='pub-bracket-svg';
    svg.style.cssText='position:absolute;top:0;left:0;pointer-events:none;overflow:visible;';
    uWrap.appendChild(svg);
    upperC.appendChild(uWrap);
  }catch(e){ console.error('upper error',e); }

  // ── Contenedor LOWER ──
  const lowerC=document.createElement('div');
  lowerC.id='pub-lower-c'; lowerC.className=cls;
  lowerC.style.cssText='position:absolute;top:0;left:0;transform-origin:top left;min-width:max-content;padding:0 3rem 0.2rem;';

  if(data.lRounds?.length){
    try{
      const lDual=document.createElement('div'); lDual.style.cssText='display:flex;align-items:flex-start;gap:0.8rem;';
      const lLeft=document.createElement('div'); lLeft.style.cssText='display:flex;gap:0.3rem;align-items:flex-start;';
      const lCenter=document.createElement('div'); lCenter.style.cssText='display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:160px;flex-shrink:0;';
      const lRight=document.createElement('div'); lRight.style.cssText='display:flex;gap:0.3rem;align-items:flex-start;flex-direction:row-reverse;';
      // Estilo inline para aumentar gap vertical entre partidos del lower (más alto)
      const matchGap = (lst.lowerGap!=null ? lst.lowerGap : 1.2) + 'rem';
      data.lRounds.forEach((round,lr)=>{
        const isDropIn=round[0]?.type==='drop-in', uRound=isDropIn?(round[0]?.fromUpperRound??0):null;
        const label=isDropIn?`Perdedores R${uRound+1}`:`Lower R${lr+1}`;
        const n=round.length, half=Math.ceil(n/2);
        if(n===1){
          const col=document.createElement('div'); col.className='lower-round-col';
          const hdr=document.createElement('div'); hdr.className='round-header'; hdr.textContent=label; col.appendChild(hdr);
          const mc=document.createElement('div'); mc.className='lower-matches'; mc.style.gap=matchGap;
          const card=buildCard(round[0],`l${lr}`,0,false); card.id=`match-l${lr}-0`; mc.appendChild(card); col.appendChild(mc); lCenter.appendChild(col);
        } else {
          const colL=document.createElement('div'); colL.className='lower-round-col';
          const hdrL=document.createElement('div'); hdrL.className='round-header'; hdrL.textContent=label; colL.appendChild(hdrL);
          const mcL=document.createElement('div'); mcL.className='lower-matches'; mcL.style.gap=matchGap;
          round.slice(0,half).forEach((m,mi)=>{ const card=buildCard(m,`l${lr}`,mi,false); card.id=`match-l${lr}-${mi}`; mcL.appendChild(card); }); colL.appendChild(mcL); lLeft.appendChild(colL);
          const colR=document.createElement('div'); colR.className='lower-round-col';
          const hdrR=document.createElement('div'); hdrR.className='round-header'; hdrR.textContent=label; colR.appendChild(hdrR);
          const mcR=document.createElement('div'); mcR.className='lower-matches'; mcR.style.gap=matchGap;
          round.slice(half).forEach((m,mi)=>{ const card=buildCard(m,`l${lr}`,half+mi,false); card.id=`match-l${lr}-${half+mi}`; mcR.appendChild(card); }); colR.appendChild(mcR); lRight.appendChild(colR);
        }
      });
      lDual.appendChild(lLeft); lDual.appendChild(lCenter); lDual.appendChild(lRight); lowerC.appendChild(lDual);
    }catch(e){ console.error('lower error',e); }
  }

  state=savedState;
  cont.appendChild(upperC); cont.appendChild(lowerC);
  if(titleC) cont.appendChild(titleC);
  if(gfC) cont.appendChild(gfC);

  let _uSc = 1;

  // Posición de un elemento relativa a un contenedor usando el árbol DOM de layout.
  // No depende de getBoundingClientRect, DPR ni zoom — siempre en píxeles CSS de layout.
  function posRelTo(el, container){
    let x=0, y=0, cur=el;
    while(cur && cur!==container){ x+=cur.offsetLeft; y+=cur.offsetTop; cur=cur.offsetParent; }
    return {x, y, w:el.offsetWidth, h:el.offsetHeight};
  }

  function drawPubLines(){
    const svg=document.getElementById('pub-bracket-svg'); if(!svg) return;
    svg.innerHTML='';
    const {rounds}=data, totalRounds=rounds.length;
    // Tamaño del SVG = tamaño de layout del contenedor upper (sin transforms, sin DPR)
    const bW=upperC.offsetWidth||1, bH=upperC.offsetHeight||1;
    svg.setAttribute('width',bW); svg.setAttribute('height',bH);
    svg.style.width=bW+'px'; svg.style.height=bH+'px';
    for(let ri=0;ri<totalRounds-1;ri++){
      rounds[ri].forEach((m,mi)=>{
        const sEl=document.getElementById(`match-${ri}-${mi}`);
        const eEl=document.getElementById(`match-${ri+1}-${Math.floor(mi/2)}`);
        if(!sEl||!eEl) return;
        const s=posRelTo(sEl,upperC), e=posRelTo(eEl,upperC);
        let x1=s.x+s.w, y1=s.y+s.h/2, x2=e.x, y2=e.y+e.h/2;
        if(x2<x1){x1=s.x; x2=e.x+e.w;}
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d',`M ${x1} ${y1} L ${(x1+x2)/2} ${y1} L ${(x1+x2)/2} ${y2} L ${x2} ${y2}`);
        path.setAttribute('class','bracket-line'+(m.winner?' active':''));
        svg.appendChild(path);
      });
    }
  }

  // Bloques del diseño personalizado: clave → elemento
  const blockEls = { title:titleC, upper:upperC, gf:gfC, lower:data.lRounds?.length ? lowerC : null };

  // Diseño personalizado: cada bloque se coloca en (x,y) y con ancho w, todo como fracción
  // del área visible (así se ve igual en cualquier pantalla). La altura sigue a la anchura.
  // Los bloques sin posición guardada reciben una por defecto basada en la colocación automática.
  function applyCustom(){
    const vW = window.innerWidth;
    const fEl = document.querySelector('#display-screen .dv-footer');
    const availH = window.innerHeight - (fEl && fEl.style.display!=='none' ? (fEl.offsetHeight||36) : 0);
    cont.style.height = availH+'px';
    const blocks = layout.blocks || (layout.blocks = {});
    const nat = {};
    Object.entries(blockEls).forEach(([k,el])=>{ if(el){ el.style.transform='none'; nat[k]={w:el.offsetWidth||1, h:el.offsetHeight||1}; } });

    // Valores por defecto (solo para bloques que aún no tienen posición)
    if(blockEls.title && !blocks.title) blocks.title = { x:0.35, y:0.01, w:0.30 };
    // Los cuadros empiezan justo debajo del título (si se ve)
    let top0 = 0.02;
    if(blockEls.title && blockEls.title.style.display!=='none'){
      const t = blocks.title;
      top0 = t.y + nat.title.h*(t.w*vW/nat.title.w)/availH + 0.02;
    }
    if(!blocks.upper || (blockEls.lower && !blocks.lower)){
      const area = availH*(1-top0);
      let uSc = vW/nat.upper.w, lSc = blockEls.lower ? vW/nat.lower.w : 0;
      let uH = nat.upper.h*uSc, lH = blockEls.lower ? nat.lower.h*lSc : 0;
      if(uH+lH > area){ const r=area/(uH+lH); uSc*=r; lSc*=r; uH*=r; lH*=r; }
      if(!blocks.upper) blocks.upper = { x:(1-nat.upper.w*uSc/vW)/2, y:top0, w:nat.upper.w*uSc/vW };
      if(blockEls.lower && !blocks.lower) blocks.lower = { x:(1-nat.lower.w*lSc/vW)/2, y:top0+uH/availH, w:nat.lower.w*lSc/vW };
    }
    if(blockEls.gf && !blocks.gf){
      const u = blocks.upper, uHf = nat.upper.h*(u.w*vW/nat.upper.w)/availH;
      blocks.gf = { x:0.42, y:u.y+uHf*0.6, w:0.16 };
    }

    Object.entries(blockEls).forEach(([k,el])=>{
      if(!el) return;
      const b = blocks[k];
      const sc = (b.w*vW)/nat[k].w;
      el.style.transform = `scale(${sc})`;
      el.style.setProperty('--dz-inv', String(1/sc));
      el.style.left = (b.x*vW)+'px';
      el.style.top  = (b.y*availH)+'px';
      if(k==='upper') _uSc = sc;
    });
    if(_designMode) refreshDesignPanel();
  }

  function fitScale(){
    if(custom){
      requestAnimationFrame(()=>requestAnimationFrame(()=>{ applyCustom(); setTimeout(()=>requestAnimationFrame(drawPubLines), 120); }));
      return;
    }
    const vW = window.innerWidth;
    const vH = window.innerHeight;
    const fEl = document.querySelector('#display-screen .dv-footer');
    const footH = fEl && fEl.style.display!=='none' ? (fEl.offsetHeight||36) : 0;
    const availH = vH - footH;
    cont.style.height = availH+'px';

    // Resetear transforms para medir el tamaño natural del DOM
    upperC.style.transform='none';
    lowerC.style.transform='none';

    // Doble rAF garantiza que el navegador refluyó tras el reset
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const hasLower = data.lRounds?.length > 0;
      // offsetWidth/offsetHeight: píxeles CSS de layout, estables sin importar DPR ni zoom
      const uW = upperC.offsetWidth || 1;
      const uH = upperC.offsetHeight || 1;

      if(!hasLower){
        // Eliminación simple: ocupa toda la pantalla centrado
        const uSc = Math.min(vW/uW, availH/uH);
        _uSc = uSc;
        upperC.style.transform=`scale(${uSc})`;
        upperC.style.left=((vW - uW*uSc)/2)+'px';
        upperC.style.top=Math.max(0,(availH - uH*uSc)/2)+'px';
        lowerC.style.display='none';
      } else {
        lowerC.style.display='';
        // Medir tamaño natural con offsetWidth/offsetHeight (layout CSS, sin DPR)
        const lW = lowerC.offsetWidth || 1;
        const lH = lowerC.offsetHeight || 1;

        // Escalar cada bracket al ancho de pantalla
        let uSc = vW/uW;
        let lSc = vW/lW;
        let uVisH = uH*uSc;
        let lVisH = lH*lSc;

        // Si juntos no caben en alto, reducir ambos proporcionalmente
        if(uVisH + lVisH > availH){
          const r = availH/(uVisH + lVisH);
          uSc *= r; lSc *= r;
          uVisH = uH*uSc; lVisH = lH*lSc;
        }

        _uSc = uSc;
        const topMargin = Math.max(0,(availH - uVisH - lVisH)/2);

        // Solo transform y posición — sin width/height explícitos para evitar ciclo de encogimiento
        upperC.style.transform=`scale(${uSc})`;
        upperC.style.left=((vW - uW*uSc)/2)+'px';
        upperC.style.top=topMargin+'px';

        lowerC.style.transform=`scale(${lSc})`;
        lowerC.style.left=((vW - lW*lSc)/2)+'px';
        lowerC.style.top=(topMargin + uVisH)+'px';
        lowerC.style.bottom='auto';
      }

      // Redibujar líneas con retraso para que el navegador haya aplicado los transforms
      setTimeout(()=>requestAnimationFrame(drawPubLines), 120);
    }));
  }

  // Función que recalcula escala Y redibuja líneas con retrasos escalonados
  function fitScaleAndLines(){
    fitScale();
    setTimeout(()=>requestAnimationFrame(drawPubLines), 150);
    setTimeout(()=>requestAnimationFrame(drawPubLines), 450);
  }

  if(custom && !blockEls.lower) lowerC.style.display='none';
  // Ocultar el cuadro hasta colocarlo evita ver un instante la colocación sin escalar
  setTimeout(fitScaleAndLines, 200); setTimeout(fitScaleAndLines, 700);

  // Modo diseño: bloques arrastrables y redimensionables
  if(_designMode){
    _pubApplyLayout = applyCustom;
    setupDesignBlocks(blockEls, cont);
  }

  // renderBracketDisplay se invoca en CADA actualización de Firestore. Para no
  // acumular un listener de resize, tres de fullscreen y un setInterval por cada
  // actualización (fuga de memoria y CPU creciente), guardamos la última función
  // de reescalado y registramos los listeners globales una sola vez; siempre
  // apuntan a la versión vigente.
  _pubFitScaleAndLines = fitScaleAndLines;
  if(!_pubBracketListenersBound){
    _pubBracketListenersBound = true;
    window.addEventListener('resize', ()=>_pubFitScaleAndLines?.());
    // F11 y otros cambios de fullscreen cambian el viewport asíncronamente
    ['fullscreenchange','webkitfullscreenchange','mozfullscreenchange'].forEach(ev=>{
      document.addEventListener(ev, ()=>{
        setTimeout(()=>_pubFitScaleAndLines?.(), 100);
        setTimeout(()=>_pubFitScaleAndLines?.(), 400);
      });
    });
    // Detectar cambio de DPI al mover la ventana entre pantallas de distinta escala
    let _prevDpr = window.devicePixelRatio;
    setInterval(()=>{
      if(Math.abs(window.devicePixelRatio - _prevDpr) > 0.01){
        _prevDpr = window.devicePixelRatio;
        setTimeout(()=>_pubFitScaleAndLines?.(), 100);
        setTimeout(()=>_pubFitScaleAndLines?.(), 500);
      }
    }, 300);
  }

  const uP=data.rounds.flat().filter(m=>m.winner).length;
  const lP=(data.lRounds||[]).flat().filter(m=>m.winner).length;
  const gfP=data.gf?.winner?1:0, played=uP+lP+gfP, total2=data.totalMatches||1;
  $('dv-progress-text').textContent=`${played} / ${total2} partidos jugados`;
  $('dv-progress-fill').style.width=Math.round(played/total2*100)+'%';
}

// ── 11.2 Diseño personalizado del cuadro público ────────
// Firestore: config/bracketLayouts = { layouts: { "<numTeams><d|s>": {blocks, style} } }
//   blocks: { title|upper|gf|lower: {x, y, w} }  — fracciones del área visible
//   style:  { accent, bg, card, text (colores), showTitle, showBrand, showFooter, lowerGap (rem) }
// Sin diseño para un tamaño → colocación automática de siempre.

function bracketLayoutKey(data){ return `${data.numTeams||data.rounds[0].length*2}${data.singleElim?'s':'d'}`; }
function bracketLayoutLabel(key){ const n=parseInt(key,10); return `cuadro de ${n} · ${key.endsWith('s')?'eliminación simple':'doble eliminación'}`; }

// Colores y elementos visibles (se aplican a toda la pantalla del cuadro)
function applyLayoutStyle(st){
  const scr = $('display-screen'); if(!scr) return;
  const set = (v, val) => { if(val) scr.style.setProperty(v, val); else scr.style.removeProperty(v); };
  set('--gold', st.accent); set('--bg', st.bg); set('--bg2', st.card); set('--text', st.text);
  const f = scr.querySelector('.dv-footer');
  if(f) f.style.display = st.showFooter===false ? 'none' : '';
}

// Hace arrastrables los bloques (mover) y les añade un tirador ◢ (cambiar tamaño)
function setupDesignBlocks(blockEls, cont){
  ensureDesignPanel();
  Object.entries(blockEls).forEach(([key, el])=>{
    if(!el) return;
    el.classList.add('design-block');
    if(key===_designSelected) el.classList.add('design-selected');
    el.dataset.block = key;
    const tag = document.createElement('div'); tag.className='design-tag'; tag.textContent = DESIGN_BLOCK_NAMES[key];
    const handle = document.createElement('div'); handle.className='design-handle'; handle.title='Arrastra para cambiar el tamaño';
    el.appendChild(tag); el.appendChild(handle);

    const startDrag = (e, mode) => {
      e.preventDefault(); e.stopPropagation();
      selectDesignBlock(key);
      const b = _designDraft.blocks?.[key]; if(!b) return;
      const vW = window.innerWidth, availH = cont.clientHeight || window.innerHeight;
      const start = { px:e.clientX, py:e.clientY, x:b.x, y:b.y, w:b.w };
      const target = e.currentTarget;
      try{ target.setPointerCapture(e.pointerId); }catch(_){}
      const move = ev => {
        const dx = (ev.clientX-start.px)/vW, dy = (ev.clientY-start.py)/availH;
        if(mode==='move'){ b.x = start.x+dx; b.y = start.y+dy; }
        else { b.w = Math.max(0.04, start.w+dx); }
        markDesignDirty();
        _pubApplyLayout?.();
      };
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        _pubFitScaleAndLines?.(); // redibujar líneas del cuadro con la escala final
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    };
    el.addEventListener('pointerdown', e => startDrag(e, 'move'));
    handle.addEventListener('pointerdown', e => startDrag(e, 'resize'));
  });
}

function selectDesignBlock(key){
  _designSelected = key;
  document.querySelectorAll('.design-block').forEach(el => el.classList.toggle('design-selected', el.dataset.block===key));
  refreshDesignPanel();
}

function markDesignDirty(){
  _designDirty = true;
  const s = $('dz-status'); if(s){ s.textContent = '● Cambios sin guardar'; s.style.color = '#E8A33D'; }
}

// Panel flotante del modo diseño (se crea una vez dentro de #display-screen para que
// siga visible en pantalla completa)
function ensureDesignPanel(){
  if($('design-panel')) return;
  const p = document.createElement('div'); p.id = 'design-panel';
  p.innerHTML = `
    <div class="dz-head"><span>🎨 Diseño del cuadro</span><button class="dz-min" id="dz-min" title="Minimizar">—</button></div>
    <div class="dz-body" id="dz-body">
      <div class="dz-sub" id="dz-key"></div>
      <div class="dz-hint">Arrastra los bloques para moverlos. Tira de la esquina ◢ para cambiar su tamaño.</div>
      <div class="dz-row"><span>Bloque:</span><select id="dz-block"></select></div>
      <div class="dz-row dz-btns">
        <button id="dz-center-h">↔ Centrar</button>
        <button id="dz-center-v">↕ Centrar</button>
        <button id="dz-reset-block" title="Volver a la posición por defecto">↺ Bloque</button>
      </div>
      <div class="dz-sep"></div>
      <div class="dz-row"><label><input type="checkbox" id="dz-show-title"> Mostrar título</label></div>
      <div class="dz-row"><label><input type="checkbox" id="dz-show-brand"> Mostrar "Cervecería Mané"</label></div>
      <div class="dz-row"><label><input type="checkbox" id="dz-show-footer"> Mostrar barra de progreso</label></div>
      <div class="dz-row"><span>Separación perdedores</span><input type="range" id="dz-gap" min="0" max="4" step="0.1"></div>
      <div class="dz-sep"></div>
      <div class="dz-colors">
        <label>Acento <input type="color" id="dz-accent"></label>
        <label>Fondo <input type="color" id="dz-bg"></label>
        <label>Tarjetas <input type="color" id="dz-card"></label>
        <label>Texto <input type="color" id="dz-text"></label>
      </div>
      <div class="dz-sep"></div>
      <div class="dz-status" id="dz-status">Sin cambios</div>
      <div class="dz-row dz-btns">
        <button class="dz-primary" id="dz-save">💾 Guardar diseño</button>
        <button id="dz-fs">⛶ Pantalla completa</button>
      </div>
      <div class="dz-row dz-btns">
        <button id="dz-discard">Descartar cambios</button>
        <button class="dz-danger" id="dz-auto">Volver a automático</button>
      </div>
    </div>`;
  $('display-screen').appendChild(p);

  const sel = $('dz-block');
  Object.entries(DESIGN_BLOCK_NAMES).forEach(([k,n])=>{ const o=document.createElement('option'); o.value=k; o.textContent=n; sel.appendChild(o); });
  sel.addEventListener('change', ()=>selectDesignBlock(sel.value));

  $('dz-min').addEventListener('click', ()=>{
    const b=$('dz-body'); const hide=b.style.display!=='none';
    b.style.display = hide ? 'none' : ''; $('dz-min').textContent = hide ? '▢' : '—';
  });
  const relayout = (full) => { markDesignDirty(); if(full && _pubLastBracketData) renderBracketDisplay(_pubLastBracketData); else _pubApplyLayout?.(); };
  const blockOf = () => _designDraft.blocks?.[_designSelected];
  const natSize = () => { const el=document.querySelector(`.design-block[data-block="${_designSelected}"]`); return el ? el.getBoundingClientRect() : null; };
  $('dz-center-h').addEventListener('click', ()=>{
    const b=blockOf(), r=natSize(); if(!b||!r) return;
    b.x = (1 - r.width/window.innerWidth)/2; relayout(false);
  });
  $('dz-center-v').addEventListener('click', ()=>{
    const b=blockOf(), r=natSize(); if(!b||!r) return;
    const h = $('dv-groups').clientHeight || window.innerHeight;
    b.y = (1 - r.height/h)/2; relayout(false);
  });
  $('dz-reset-block').addEventListener('click', ()=>{
    if(!_designDraft.blocks) return;
    delete _designDraft.blocks[_designSelected]; relayout(true);
  });
  const st = () => (_designDraft.style || (_designDraft.style = {}));
  $('dz-show-title').addEventListener('change', e=>{ st().showTitle = e.target.checked; relayout(true); });
  $('dz-show-brand').addEventListener('change', e=>{ st().showBrand = e.target.checked; relayout(true); });
  $('dz-show-footer').addEventListener('change', e=>{ st().showFooter = e.target.checked; relayout(true); });
  $('dz-gap').addEventListener('input', e=>{ st().lowerGap = parseFloat(e.target.value); relayout(true); });
  [['dz-accent','accent'],['dz-bg','bg'],['dz-card','card'],['dz-text','text']].forEach(([id,k])=>{
    $(id).addEventListener('input', e=>{ st()[k] = e.target.value; markDesignDirty(); applyLayoutStyle(st()); });
  });

  $('dz-save').addEventListener('click', async ()=>{
    const btn=$('dz-save'); btn.disabled=true;
    try{
      await setDoc(LAYOUTS_REF(), { layouts:{ [_designKey]: _designDraft }, updatedAt: serverTimestamp() }, { merge:true });
      _pubLayouts = { ...(_pubLayouts||{}), [_designKey]: JSON.parse(JSON.stringify(_designDraft)) };
      _designDirty = false;
      const s=$('dz-status'); s.textContent='✓ Guardado — las pantallas públicas ya lo usan'; s.style.color='var(--win)';
      toast('💾 Diseño guardado');
    }catch(e){ console.error(e); toast('⚠️ No se pudo guardar el diseño'); }
    finally{ btn.disabled=false; }
  });
  $('dz-discard').addEventListener('click', ()=>{
    if(_designDirty && !confirm('¿Descartar los cambios sin guardar?')) return;
    _designDraft = JSON.parse(JSON.stringify(_pubLayouts?.[_designKey] || {blocks:{}, style:{}}));
    _designDirty = false;
    const s=$('dz-status'); s.textContent='Sin cambios'; s.style.color='';
    if(_pubLastBracketData) renderBracketDisplay(_pubLastBracketData);
  });
  $('dz-auto').addEventListener('click', async ()=>{
    if(!confirm(`¿Borrar el diseño personalizado del ${bracketLayoutLabel(_designKey)} y volver a la colocación automática?`)) return;
    try{
      if(_pubLayouts?.[_designKey]) await updateDoc(LAYOUTS_REF(), { [`layouts.${_designKey}`]: deleteField() });
      if(_pubLayouts) delete _pubLayouts[_designKey];
      _designDraft = {blocks:{}, style:{}}; _designDirty = false;
      const s=$('dz-status'); s.textContent='Diseño borrado: las pantallas usan la colocación automática'; s.style.color='';
      if(_pubLastBracketData) renderBracketDisplay(_pubLastBracketData);
    }catch(e){ console.error(e); toast('⚠️ No se pudo borrar el diseño'); }
  });
  $('dz-fs').addEventListener('click', ()=>{
    const el=$('display-screen');
    if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    else el.requestFullscreen?.().catch(()=>{});
  });
  window.addEventListener('beforeunload', e=>{ if(_designDirty){ e.preventDefault(); e.returnValue=''; } });
}

// Sincroniza los controles del panel con el diseño en edición
function refreshDesignPanel(){
  if(!$('design-panel') || !_designDraft) return;
  const st = _designDraft.style || {};
  $('dz-key').textContent = 'Editando: ' + bracketLayoutLabel(_designKey);
  const sel=$('dz-block');
  [...sel.options].forEach(o => { o.disabled = !document.querySelector(`.design-block[data-block="${o.value}"]`); });
  sel.value = _designSelected;
  $('dz-show-title').checked = st.showTitle !== false;
  $('dz-show-brand').checked = st.showBrand !== false;
  $('dz-show-footer').checked = st.showFooter !== false;
  $('dz-gap').value = st.lowerGap != null ? st.lowerGap : 1.2;
  $('dz-accent').value = st.accent || DESIGN_DEFAULT_COLORS.accent;
  $('dz-bg').value = st.bg || DESIGN_DEFAULT_COLORS.bg;
  $('dz-card').value = st.card || DESIGN_DEFAULT_COLORS.card;
  $('dz-text').value = st.text || DESIGN_DEFAULT_COLORS.text;
}

// ── 11.1 Pantalla completa ─────────────────────────────
function syncBracketOverlay(){ const c=$('bracket-container'),svg=$('bracket-svg'); if(!c||!svg) return; const w=Math.max(c.scrollWidth,1),h=Math.max(c.scrollHeight,1); svg.setAttribute('width',w); svg.setAttribute('height',h); svg.style.width=w+'px'; svg.style.height=h+'px'; requestAnimationFrame(()=>requestAnimationFrame(drawLines)); }
// Ajusta el cuadro (admin) para que quepa entero en el área visible. Nunca amplía
// (tope en 1), así los cuadros pequeños no cambian; solo encoge los que se salen
// (p. ej. 64). Antes no existía esta función y solo se llamaba en pantalla completa,
// por lo que en modo normal el cuadro de 64 se salía y se solapaba.
function scaleBracket(){
  const outer=$('bracket-outer'), scaler=$('bracket-scaler'), cont=$('bracket-container');
  if(!outer||!scaler||!cont||outer.clientWidth<1||outer.clientHeight<1) return;
  scaler.style.transform='none';
  const cw=cont.scrollWidth, ch=cont.scrollHeight;
  if(cw<1||ch<1) return;
  const sc=Math.min((outer.clientWidth-24)/cw, (outer.clientHeight-24)/ch, 1);
  scaler.style.transform='scale('+sc+')';
  syncBracketOverlay();
}
function enterFs(){ const elem=$('tournament-screen'); if(!elem) return; isFsMode=true; const req=elem.requestFullscreen||elem.webkitRequestFullscreen; if(req){req.call(elem).then(()=>{setTimeout(()=>{syncBracketOverlay();window.dispatchEvent(new Event('resize'));},100);toast('⛶ Pantalla completa — ESC para salir');}).catch(()=>{document.body.classList.add('fs-mode');setTimeout(()=>{syncBracketOverlay();window.dispatchEvent(new Event('resize'));},100);});}else{document.body.classList.add('fs-mode');setTimeout(()=>{syncBracketOverlay();window.dispatchEvent(new Event('resize'));},100);} }
function exitFs(){ isFsMode=false; if(document.fullscreenElement) document.exitFullscreen().catch(()=>{}); else if(document.webkitFullscreenElement) document.webkitExitFullscreen(); document.body.classList.remove('fs-mode'); setTimeout(()=>{syncBracketOverlay();window.dispatchEvent(new Event('resize'));},100); }
if(!IS_DISPLAY && !IS_BRACKET && !IS_QUEUE && !IS_DEVICE){
  document.addEventListener('keydown',e=>{ if(e.key==='F11'){e.preventDefault();if($('tournament-screen').style.display!=='none')isFsMode?exitFs():enterFs();}if(e.key==='Escape'&&isFsMode){e.preventDefault();exitFs();} });
  ['fullscreenchange','webkitfullscreenchange','mozfullscreenchange'].forEach(ev=>document.addEventListener(ev,()=>{setTimeout(()=>{syncBracketOverlay();window.dispatchEvent(new Event('resize'));},50);}));
  if($('btn-fullscreen')) $('btn-fullscreen').addEventListener('click',()=>{
    if(!sessionId){ toast('⚠️ No hay cuadro activo'); return; }
    window.open(`${location.pathname}?mode=bracket&session=${sessionId}`,'_blank','noopener');
    toast('🏆 Cuadro público abierto');
  });
  // Editor del diseño del cuadro público: abre la vista pública en modo diseño
  if($('btn-bracket-design')) $('btn-bracket-design').addEventListener('click',()=>{
    if(!sessionId){ toast('⚠️ No hay cuadro activo'); return; }
    window.open(`${location.pathname}?mode=bracket&session=${sessionId}&design=1`,'_blank');
    toast('🎨 Editor de diseño abierto');
  });
  window.addEventListener('resize',()=>scaleBracket());
}
function flashHint(){ const h=$('fs-hint'); h.classList.add('show'); setTimeout(()=>h.classList.remove('show'),3500); }

function drawLines(){
  const svg=$('bracket-svg'); if(!svg) return; svg.innerHTML='';
  const {rounds}=state, totalRounds=rounds.length, scaler=$('bracket-scaler');
  let scale=1; if(scaler?.style.transform){const match=scaler.style.transform.match(/scale\(([^)]+)\)/);if(match)scale=parseFloat(match[1]);}
  const svgRect=svg.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  for(let ri=0;ri<totalRounds-1;ri++){
    rounds[ri].forEach((m,mi)=>{
      const startEl=$(`match-${ri}-${mi}`), endEl=$(`match-${ri+1}-${Math.floor(mi/2)}`); if(!startEl||!endEl) return;
      const sR=startEl.getBoundingClientRect(), eR=endEl.getBoundingClientRect();
      let x1=(sR.right-svgRect.left)/dpr/scale, y1=(sR.top+sR.height/2-svgRect.top)/dpr/scale;
      let x2=(eR.left-svgRect.left)/dpr/scale, y2=(eR.top+eR.height/2-svgRect.top)/dpr/scale;
      if(x2<x1){x1=(sR.left-svgRect.left)/dpr/scale;x2=(eR.right-svgRect.left)/dpr/scale;}
      const midX=x1+(x2-x1)/2;
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d',`M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`);
      path.setAttribute('class','bracket-line'+(m.winner?' active':''));
      svg.appendChild(path);
    });
  }
}

// ═══════════════════════════════════════════════════════
// 12. INICIALIZACIÓN
// ═══════════════════════════════════════════════════════
// ── 12.1 Exponer funciones al HTML ───────────────────── ─────────────────────
const _fns = {
  loadTournament, deleteTournament, moveTeam,
  openScorePanel, modSc: window.modSc, closeScorePanel: window.closeScorePanel,
  applyScore, clearScore,
  removeDevice, clearAllDevices, generateDeviceQR, copyConnectURL, openConnectModal,
  addToGlobalQueue, removeFromGlobalQueue,
  addBracketMatchToQueue, removeBracketMatchFromQueue,
  selectWinner, selectWinnerLower, selectWinnerGF, resetWinner,
  ipadToggleFS, ipadMod: window.ipadMod, ipadSave: window.ipadSave, ipadStart: window.ipadStart,
  renderPairingScreen,
  closeTourneysOverlay: () => $('tourneys-overlay').style.display='none',
  closeConnectOverlay:  () => $('connect-overlay').classList.remove('open'),
  goBackToGroups: () => { $('pairing-screen').style.display='none'; $('group-screen').style.display='block'; },
  goBackToGroupsFromBracket: () => {
    if(!confirm('¿Volver a la fase de grupos? El cuadro eliminatorio se mantendrá guardado.')) return;
    $('tournament-screen').style.display='none';
    $('gs-title').textContent=groupData.title;
    $('group-screen').style.display='block';
    renderGroups();
  },
  openLoginModal: window.openLoginModal, closeLoginModal: window.closeLoginModal,
  doLogin: window.doLogin, adminLogout: window.adminLogout,
  switchPubTab: window.switchPubTab, togglePublish: window.togglePublish,
  showPubPanel: window.showPubPanel, closePubPanel: window.closePubPanel,
};
Object.entries(_fns).forEach(([k,v]) => { if(v){ window[k]=v; window['_fn_'+k]=v; } });

// ── 12.2 Auth reactivo ───────────────────────────────── ─────────────────────────────────
if(!IS_DEVICE && !IS_DISPLAY && !IS_BRACKET && !IS_QUEUE){
  let _authInitDone = false;
  onAuthStateChanged(auth, async user => {
    if(user && !user.isAnonymous){
      // Sesión de admin — mostrar gestor
      isAdmin = true;
      _authInitDone = true;
      showAdminView();
    } else {
      if(_authInitDone && isAdmin){
        // Ya estábamos como admin — ignorar cambios externos (otras pestañas)
        // Solo reaccionar si fue un logout explícito (isAdmin se pone a false en adminLogout)
        return;
      }
      if(!user) await signInAnonymously(auth);
      isAdmin = false;
      _authInitDone = true;
      showPublicView();
    }
  });
}

// ═══════════════════════════════════════════════════════
// 13. GENERACIÓN DE PDF (Pegatinas)
// ═══════════════════════════════════════════════════════
// Sello de fondo de pegatinas y tickets. Antes iba incrustado en base64 (dos copias
// de ~190 KB dentro de script.js); ahora se descarga solo al generar un PDF y se cachea.
let _selloPromise = null;
function loadSello(){
  if(!_selloPromise){
    _selloPromise = fetch('sello.png')
      .then(r => { if(!r.ok) throw new Error('sello.png '+r.status); return r.blob(); })
      .then(blob => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      }))
      .catch(e => { _selloPromise = null; throw e; });
  }
  return _selloPromise;
}

window.generarPegatinas = async function(){
  if(!window.jspdf){ toast('❌ jsPDF no cargado'); return; }
  const gd = groupData;
  if(!gd?.groups?.length){ toast('❌ No hay datos de grupos'); return; }
  toast('⏳ Generando PDF...');

  const { jsPDF } = window.jspdf;
  const torneoNombre = (gd.title||'TORNEO').toUpperCase();

  const W=595.28, H=841.89, SW=W/2, SH=H/4;

  // Generar partidos de cada grupo
  const matches=[];
  gd.groups.forEach(g=>{
    g.matches.forEach(m=>{
      if(m.t1?.name!=='BYE' && m.t2?.name!=='BYE'){
        matches.push({torneo:torneoNombre, grupo:g.name, pa:m.t1.name.toUpperCase(), pb:m.t2.name.toUpperCase()});
      }
    });
  });
  if(!matches.length){ toast('❌ No hay partidos'); return; }

  const doc = new jsPDF({unit:'pt', format:'a4'});

  // Imagen de fondo circular en base64
  const bgImg = await loadSello();

  const positions = [
    [0,0],[SW,0],[0,SH],[SW,SH],[0,2*SH],[SW,2*SH],[0,3*SH],[SW,3*SH]
  ];

  function drawSticker(sx, sy, torneo, grupo, pa, pb){
    // Imagen circular de fondo
    const iw = SW*0.60, ih = SH*0.70;
    const ix = sx + (SW-iw)/2 + 10;
    const iy = sy + SH*0.14;
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({opacity:0.20}));
    doc.addImage(bgImg,'PNG', ix, iy, iw, ih);
    doc.restoreGraphicsState();

    // ARRIBA: título fijo "TORNEO FUTBOLÍN CERVECERÍA MANÉ"
    const titulo = 'TORNEO FUTBOLÍN CERVECERÍA MANÉ';
    doc.setFont('helvetica','bold');
    let fs = 13;
    doc.setFontSize(fs);
    const available = SW - 10;
    while(doc.getTextWidth(titulo) > available && fs > 6){
      fs -= 0.5;
      doc.setFontSize(fs);
    }
    doc.setTextColor(0,0,0);
    doc.text(titulo, sx + SW/2, sy + 16, {align:'center'});

    // CENTRO: Pareja B arriba, Pareja A abajo
    const pa_y = sy + SH*0.67;
    const pb_y = sy + SH*0.43;
    const box_size = 32;
    const box_x = sx + SW - box_size - 22;
    const box_pa_y = pa_y + 4.5 - box_size/2;
    const box_pb_y = pb_y + 4.5 - box_size/2;

    doc.setTextColor(0,0,0);
    // PAREJA B
    doc.setFont('helvetica','bold'); doc.setFontSize(8);
    doc.text('PAREJA  B:', sx+10, pb_y);
    doc.setFontSize(9);
    doc.text(pb, sx+72, pb_y);
    doc.setLineWidth(1); doc.setDrawColor(0,0,0);
    doc.rect(box_x, box_pb_y, box_size, box_size);

    // PAREJA A
    doc.setFont('helvetica','bold'); doc.setFontSize(8);
    doc.text('PAREJA  A:', sx+10, pa_y);
    doc.setFontSize(9);
    doc.text(pa, sx+72, pa_y);
    doc.rect(box_x, box_pa_y, box_size, box_size);

    // ABAJO: nombre del torneo real + letra del grupo
    const footer_y = sy + SH - 8;
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
    doc.text('TORNEO:', sx+10, footer_y);
    doc.setFont('helvetica','bold'); doc.setFontSize(8);
    doc.text(torneo, sx+52, footer_y);
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
    doc.text('GRUPO:', sx+SW*0.54, footer_y);
    doc.setFont('helvetica','bold'); doc.setFontSize(8);
    doc.text(grupo.replace(/GRUPO\s*/i,''), sx+SW*0.54+40, footer_y);
  }

  function drawCutLines(){
    doc.setDrawColor(100,100,100);
    doc.setLineWidth(0.5);
    doc.setLineDash([4,4]);
    doc.line(SW, 0, SW, H);
    for(let row=1;row<4;row++) doc.line(0, row*SH, W, row*SH);
    doc.setLineDash([]);
  }

  matches.forEach((m,i)=>{
    const posIdx = i % 8;
    if(posIdx===0){
      if(i>0) doc.addPage();
      drawCutLines();
    }
    const [sx,sy] = positions[posIdx];
    drawSticker(sx, sy, m.torneo, m.grupo, m.pa, m.pb);
  });

  doc.save('pegatinas_'+torneoNombre.toLowerCase().replace(/\s+/g,'_')+'.pdf');
  toast('✅ PDF generado: '+matches.length+' partidos');
};


window.imprimirTicketPartido = async function(data){
  if(!window.jspdf){ alert('jsPDF no disponible'); return; }
  const { jsPDF } = window.jspdf;

  // 80mm ancho de rollo — documento 120x80mm en portrait con contenido apaisado
  const W = 120;
  const H = 80;

  const doc = new jsPDF({ unit:'mm', format:[W, H], orientation:'portrait' });

  const bgImg = await loadSello();

  // Imagen circular de fondo centrada, muy transparente
  const iw = 40, ih = 40;
  const ix = (W - iw) / 2;
  const iy = (H - ih) / 2;
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({opacity: 0.10}));
  doc.addImage(bgImg, 'PNG', ix, iy, iw, ih);
  doc.restoreGraphicsState();

  // ── TÍTULO centrado arriba ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(0, 0, 0);
  const titulo = 'TORNEO FUTBOLIN CERVECERIA MANE';
  doc.text(titulo, W / 2, 8, { align: 'center' });

  // Línea separadora superior
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(5, 11, W - 5, 11);

  // ── ZONA CENTRAL: pareja A | VS | pareja B ──
  // Columna izquierda: PAREJA A
  const colA_x = 6;
  const colVS_x = W / 2;
  const colB_x = W / 2 + 6;
  const row1_y = 22;  // etiqueta
  const row2_y = 33;  // nombre
  const row3_y = 46;  // cuadro resultado (esquina superior)

  // — PAREJA A (izquierda) —
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(80, 80, 80);
  doc.text('PAREJA  A', colA_x, row1_y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  let paName = data.pa;
  while(doc.getTextWidth(paName) > (W / 2 - 14) && paName.length > 3) paName = paName.slice(0,-1);
  doc.text(paName, colA_x, row2_y);

  // cuadro resultado A
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.rect(colA_x, row3_y, 14, 14);

  // — VS (centro) —
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(150, 150, 150);
  doc.text('VS', colVS_x, row2_y + 2, { align: 'center' });

  // — PAREJA B (derecha) —
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(80, 80, 80);
  doc.text('PAREJA  B', colB_x, row1_y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  let pbName = data.pb;
  while(doc.getTextWidth(pbName) > (W / 2 - 14) && pbName.length > 3) pbName = pbName.slice(0,-1);
  doc.text(pbName, colB_x, row2_y);

  // cuadro resultado B
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.rect(colB_x, row3_y, 14, 14);

  // Línea separadora inferior
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(5, H - 14, W - 5, H - 14);

  // ── ABAJO: torneo + grupo ──
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(80, 80, 80);
  doc.text('TORNEO:', 6, H - 8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(0, 0, 0);
  let torneoName = data.torneo;
  while(doc.getTextWidth(torneoName) > 60 && torneoName.length > 3) torneoName = torneoName.slice(0,-1);
  doc.text(torneoName, 22, H - 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(80, 80, 80);
  doc.text('GRUPO:', W - 35, H - 8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(0, 0, 0);
  doc.text(data.grupo.replace(/GRUPO\s*/i, ''), W - 19, H - 8);

  // Impresión directa y silenciosa mediante iframe oculto
  const blobUrl = doc.output('bloburl');
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = blobUrl;
  document.body.appendChild(iframe);
  iframe.onload = function() {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch(e) {
      // fallback: descarga si iframe bloqueado
      doc.save('ticket_partido.pdf');
    }
    setTimeout(() => document.body.removeChild(iframe), 5000);
  };
};


