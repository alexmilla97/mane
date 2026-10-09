# Gestor de Torneos

## Descripción
Aplicación web de una sola página (SPA) para gestionar torneos completos. Incluye fase de grupos, emparejamientos y cuadro de eliminatorias con doble eliminación (bracket superior e inferior) y gran final.

## Tecnologías
- HTML5 / CSS3 / JavaScript vanilla (sin frameworks)
- Firebase (Firestore + Auth) para persistencia y sincronización en tiempo real
- Fuentes: Barlow Condensed + Barlow (Google Fonts)
- Librerías externas: qrcodejs (QR), jsPDF (pegatinas PDF), SheetJS (importar Excel)

## Funcionalidades implementadas
- Pantalla de configuración: nombre del torneo, número de equipos (4/8/16/32/64), grupos
- Fase de grupos: clasificaciones en tiempo real, marcadores, indicadores de partido en directo / en cola
- Sistema multi-dispositivo: enviar partidos a pantallas externas vía Firebase
- Pantalla de emparejamientos: asignación de cruces entre grupos
- Cuadro de eliminatorias: **doble eliminación** (por defecto) o **eliminación simple**, escalado automático al viewport
- Modo pantalla completa (F11)
- Códigos QR para acceso desde móvil
- Vistas especiales por parámetro URL: `IS_DISPLAY`, `IS_BRACKET`, `IS_QUEUE`, `IS_DEVICE`
- Vista pública de torneos publicados (sin login)
- Generación de pegatinas en PDF para partidos
- Importación de jugadores desde .txt, .csv o .xlsx

## Diseño visual
- Tema oscuro: fondo `#0E0E12`, acentos en dorado `#D4A017`
- Variables CSS centralizadas en `:root`
- Diseño responsive con scroll horizontal para los grupos
- Imagen de fondo `portada.JPG` aplicada mediante `<div id="page-bg">` fijo con `z-index:-1` (inline style en `<head>`)
- Encabezado de vista pública (`pub-header`) semitransparente con `backdrop-filter: blur`
- Vista pública fijada a `height: 100vh` para evitar scroll de página cuando no hay paneles abiertos

## Estructura del proyecto
```
PAGINA MANE/
├── index.html    — HTML y estructura de pantallas
├── style.css     — Todo el CSS
├── script.js     — Toda la lógica JavaScript (con índice de secciones al inicio)
├── portada.JPG   — Imagen de fondo de la página
├── sello.png     — Sello de fondo de pegatinas/tickets PDF (se carga con loadSello() solo al generar)
├── firestore.rules.propuesta — Propuesta de reglas de Firestore (NO publicada)
└── CLAUDE.md     — Instrucciones para Claude Code
```

## Vistas de la página
- **Vista pública (escritorio/móvil)**: `torneosmane.org` sin login — muestra torneos publicados, tarjetas de clasificación y cola de partidos
- **Vista admin (escritorio)**: tras hacer login — gestión completa de torneos, grupos, brackets y dispositivos
- Al referirse a cambios de diseño, especificar "móvil" o "escritorio" para aplicar los estilos correctos

## Repositorio
- GitHub: https://github.com/alexmilla97/mane
- Rama principal: `main`

## Servidor local
El proyecto usa `<script type="module">` y requiere un servidor HTTP (no funciona con `file://`).
Lanzar con PowerShell:
```powershell
Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$env:TEMP\ps_server.ps1`"" -WindowStyle Minimized
```
O con Python (si está instalado):
```bash
python -m http.server 8080
```
Acceder en: http://localhost:8080

## Subir cambios a GitHub
```powershell
$env:PATH += ";C:\Program Files\Git\cmd"
git -C "C:\Users\aleja\Desktop\PAGINA MANE" add .
git -C "C:\Users\aleja\Desktop\PAGINA MANE" commit -m "descripción del cambio"
git -C "C:\Users\aleja\Desktop\PAGINA MANE" push
```

## Despliegue
- Hosting: Cloudflare Pages, conectado al repositorio GitHub
- Cada `git push` a `main` despliega automáticamente en producción
- URL de producción: https://torneosmane.org
- **Caché (IMPORTANTE)**: Cloudflare sirve `script.js`/`style.css` con `Cache-Control: max-age=14400` (4 h). Ese valor lo impone un ajuste de **zona** en el panel de Cloudflare (*Caching → Configuration → Browser Cache TTL = 4 horas*), que **sobrescribe** las cabeceras del origen, por lo que el fichero `_headers` del repo **no surte efecto por sí solo**.
  - **Solución activa (sin tocar el panel)**: `index.html` referencia los assets con un parámetro de versión: `script.js?v=N` y `style.css?v=N`. **Al cambiar `script.js` o `style.css` hay que incrementar `N`** (URL nueva → el navegador descarga fresco, ignorando la copia cacheada). Versión actual: `v=16`.
  - **Solución alternativa (un solo cambio en el panel)**: poner *Browser Cache TTL* en **"Respect Existing Headers"**; entonces el `_headers` (ya incluido en el repo, con `no-cache, must-revalidate`) pasa a funcionar y ya no haría falta subir la versión `?v=` en cada cambio.

## Bugs conocidos y soluciones aplicadas (script.js)

### Cola de dispositivos / sincronización
- `buildAndSaveQueue` crasheaba silenciosamente en torneos de bracket porque `groupData.groups` es `undefined` en fase eliminatoria. Solución: `(groupData.groups||[]).forEach(...)`.
- `dispatchNextFromQueue` no llamaba a `buildAndSaveQueue` al terminar si el torneo era solo bracket. Solución: guardia `groupData.groups || state.rounds`.
- El listener de scores usaba `forEach(async ...)`, lo que lanzaba múltiples `dispatchNextFromQueue` concurrentes. Solución: `for...of` con `await`.
- `getNextMatchId()` hacía una transacción Firestore antes de actualizar la UI, generando un delay visible y ventana de doble-clic. Solución: sustituida por `Date.now()` (síncrono). Refinado después con un contador `_lastMatchId` para garantizar IDs estrictamente crecientes (sin colisiones en el mismo milisegundo).
- El listener `onSnapshot(QUEUE_REF())` no se cancelaba antes de crear uno nuevo. Solución: guardado en `unsubscribeQueue` y cancelado en `showAdminView`.
- `updateDeviceUI` no refrescaba el botón de cola en el panel de marcadores del bracket cuando llegaba una actualización externa. Solución: añadido bloque que detecta `_bsp` abierto y reemplaza `#bsp-queue-section`.

### Vista de cola pública (?mode=queue)
- `renderQueueItems` vaciaba el DOM con `innerHTML=''` en cada actualización de Firestore, causando un parpadeo visible y el reinicio de las animaciones CSS. Solución: DOM diffing con `data-key` por partido; los nodos existentes se actualizan en sitio y solo se añaden o eliminan los que cambian.
- Parpadeo de la tarjeta verde ("EN JUEGO") durante transiciones de partido: Firestore emite estados intermedios donde el partido activo aparece como `status:'pending'` (sin live ni queued). Solución: caché de datos `_lastLiveByDev` en `renderQueueItems` — guarda el último item live por dispositivo e inyecta datos sintéticos cuando el estado entrante no tiene ningún partido live, manteniendo el nodo DOM intacto durante la transición.

### Auditoría de código (revisión completa)
- **Vista pública del cuadro (`?mode=bracket`) — fuga de listeners/intervalos**: `renderBracketDisplay` se invoca en cada actualización de Firestore y registraba en cada llamada un listener `resize`, tres `fullscreenchange` y un `setInterval(300ms)`, que nunca se cancelaban → CPU creciente y parpadeo del bracket en torneos largos. Solución: las funciones de reescalado se guardan en `_pubFitScaleAndLines` (variable de módulo) y los listeners/intervalo globales se registran una sola vez (`_pubBracketListenersBound`), apuntando siempre a la versión vigente.
- **Pérdida de resultados de bracket pendientes al cargar torneo**: en `loadTournament`, el bloque de scores pendientes solo aplicaba partidos de grupos pero borraba (`deleteDoc`) **todos** los pendientes, incluidos los de bracket → se perdía el resultado. Solución: filtrar a `type!=='bracket'` (solo se pre-aplican grupos); los de bracket se dejan en Firestore para que el listener `subscribeToSession` los procese con la propagación correcta.
- **Modo dispositivo — recarga por inactividad**: `ipadSave` creaba dos `setInterval` (uno de ellos, `cancelReload`, nunca se limpiaba y se acumulaba por cada partido; además había carrera con la recarga a los 10s). Solución: un único `setTimeout` (`idleReloadTimer`) que `showMatch` cancela en cuanto llega un partido nuevo.
- **Listener de scores pisaba partidos recién despachados**: liberaba el dispositivo (`busy:false`) de forma incondicional, pudiendo sobrescribir un partido recién enviado por una escritura tardía. Solución: solo libera si `currentMatch.matchId` del dispositivo coincide con el `matchId` del resultado (o no tiene partido), comparando con `String()`.
- **Cuadro de 64 con 4 grupos generaba un cuadro de 32**: en `generateProfessionalNames`, el bloque de `nGroups===4` usaba la tabla de seeding fija de 32 jugadores (8 por grupo) también para `n=16` (64 jugadores = 16 por grupo). Esa tabla solo referencia los índices `0..3` y `last-3..last`, así que **descartaba 8 jugadores por grupo (32 en total)** → el cuadro salía de 32. Solución: las tablas fijas de 4 grupos se usan solo para `n===4` y `n===8`; para cualquier otro `n` (p. ej. 16) se delega en el *fallback* genérico L/R, que reparte a los 64 y conserva la regla "1º y 2º de cada grupo solo se cruzan en la final". Verificado con un banco de pruebas en navegador para todas las combinaciones tamaño×grupos.
- **Vista admin del cuadro de 64: tarjetas solapadas, cortadas y diminutas**. Causas: (1) no existía ninguna regla CSS `.size-64` (solo `.size-32`), así que el cuadro no se reducía; (2) `scaleBracket` se **invocaba pero no estaba definida** y solo en pantalla completa, por lo que en modo normal no había ajuste al viewport → el cuadro se salía; (3) `.bracket-dual { min-height: 600px }` con 16 partidos por media columna (posicionados por %) los apelotonaba y solapaba. Solución: se implementó `scaleBracket()` (encoge el cuadro entero para que quepa en `#bracket-outer`, tope en escala 1 — no afecta a cuadros que ya caben), se llama siempre tras render y en `resize`/fullscreen, y se añadieron reglas `.size-64` en `style.css` (sobre todo `min-height: 1240px` en `.bracket-dual` para que los 16 partidos no se solapen). Nota: `scaleBracket` también arregla un `ReferenceError` latente al entrar en pantalla completa (F11) en cualquier cuadro.

### Revisión de seguridad y robustez (oct 2026)
- **XSS**: todos los nombres (jugadores, torneos, grupos, dispositivos) que se meten con `innerHTML` pasan por `esc()` (sección 4.2). Los botones de las listas de torneos y dispositivos usan `addEventListener` en vez de `onclick="...('${id}')"`. **Regla: cualquier texto que venga de Firestore o de la URL se escapa con `esc()` antes de ir a `innerHTML`.**
- **Validación de resultados**: el iPad envía `t1`/`t2` en el score; `scoreTeamsMatch()` comprueba que coinciden con el partido en esa posición antes de aplicarlo (listener y `loadTournament`). En cuadro, el ganador debe ser `t1` o `t2` (antes, si no coincidía, ganaba `t2`). Scores antiguos sin `t1`/`t2` se aceptan.
- **Empate en eliminatoria desde el iPad**: `ipadSave` lo bloquea (antes ganaba la pareja A).
- **Scores de otro torneo**: ya no se borran a los 60 s; solo se borran si el torneo ya no existe.
- **Cola combinada `?mode=queue`**: los listeners por torneo se cancelan al despublicar (`pubQueueUnsubs`).
- **Publicar/despublicar/eliminar**: `arrayUnion`/`arrayRemove` sobre `config/publishedTorneos` (atómico).
- **Setup**: se rechazan nombres repetidos (sin distinguir mayúsculas).
- **"Simular resultados" de grupos** pide confirmación.
- `resetWinner` es null-safe en eliminación simple. SheetJS cargado desde `cdn.sheetjs.com` 0.20.3.
- **Pendiente (fuera del código)**: publicar reglas de Firestore (ver `firestore.rules.propuesta`) y desactivar el registro de usuarios con email en Firebase Auth.

### Edición manual de resultados del cuadro
- Pulsar un partido ya jugado abre el panel en **modo edición** (`_bsp.editing`): precarga el marcador guardado (`match.s1/s2`; si es un resultado antiguo sin marcador, 1-0 para el ganador). Botones: **Actualizar** y **↺ Anular resultado** (`#bsp-clear-btn`, `window.clearBracketScore`). Partidos contra BYE no se editan.
- Mismo ganador → solo se actualiza el marcador. Ganador distinto o anular → `undoBracketMatch(st, bType, ri, mi)` anula el partido y **en cascada** todos los posteriores a los que llegaron su ganador/perdedor (upper siguiente, drop al lower vía `lowerDropTarget`, siguiente lower vía `lowerNextTarget`, gran final / campeón), vaciando esas casillas. `confirmBracketUndo` simula sobre una copia y lista los resultados que se borrarán antes de confirmar.
- `afterBracketUndo` quita de la cola los partidos del cuadro que ya no son válidos y avisa si alguno estaba en juego en un iPad (su resultado se ignorará por `scoreTeamsMatch`).
- Los resultados (panel e iPad) guardan ahora `s1/s2` en el partido del cuadro.
- `resetWinner` usa el mismo motor. Verificado con un banco de pruebas aleatorio (224.000 comprobaciones, tamaños 4–64, doble/simple, con BYEs): tras cualquier secuencia de jugar/anular/cambiar, el cuadro coincide con reconstruirlo desde cero.

### CSS: regla global de box-sizing inactiva (no tocar sin revisar todo)
- `style.css` empieza con un `<style>` literal (línea 1). Eso invalida la primera regla (`*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }`), así que **en toda la web los elementos usan content-box y márgenes por defecto**. El diseño actual está ajustado así; quitar ese `<style>` cambiaría espacios en todas las pantallas.
- Consecuencia: un `input`/`select` con `width:100%` + padding se sale de su caja. Arreglo puntual en setup (solapamiento nombre/grupo): `box-sizing: border-box` explícito en `.team-input-wrap input, .group-select`, `min-width:0` en `.team-input-wrap` y `flex: 0 0 120px` en `.group-select`.

### Pantalla "Nuevo torneo" (una sola página a lo ancho, "opción A")
- `#setup-screen` > `.setup-card.setup-unified`: arriba `.setup-top` (título + resumen `#groups-info`), `.setup-config` en horizontal (nombre, participantes, formato con `#elim-info` como `.setup-hint`, grupos `#step2`; 4 columnas → 2 en ≤1150px → 1 en ≤640px), `.setup-rule`, `.setup-foot` (contador, Importar, Rellenar y `#start-btn` a la derecha) y debajo `#teams-grid` con una tarjeta `.setup-group` por grupo. Elegida por el usuario frente a la versión de dos tarjetas.
- **Pantalla completa sin costuras**: mientras se ve Nuevo torneo (admin), `syncSetupMode()` (un `MutationObserver` sobre el `style` de `#setup-screen` y `#admin-header`) pone `body.setup-mode`: sin foto (`#page-bg` oculto), sin margen del body, fondo `--bg2` común a cabecera y contenido, sin borde de cabecera ni marco de tarjeta. El resto de pantallas no cambia.
- `rebuildTeamInputs()` crea los huecos como `input[data-group=j]` dentro de cada tarjeta (ya no hay `select` de grupo por fila). Conserva los nombres escritos al cambiar tamaño/grupos. `--gcols` (máx. 4) y `--gcols2` (máx. 2, pantallas medianas) fijan las columnas; con >8 por grupo los huecos van en varias columnas (`.many-per-group`). `updateSetupCounts()` mantiene los contadores `escritos/huecos`.
- **Importar con encabezados de grupo** (`planImport`, `GROUP_HEADER_RE`): líneas `Grupo A` / `Grupo 1` / `Grupo B:` (también `Grupo C: Ana; Luis` en la misma línea) asignan los nombres siguientes a ese grupo; huecos sin nombre quedan vacíos (BYE). Avisos (toast largo, 7 s): sobran nombres en un grupo, grupos que no existen en el panel, nombres antes del primer encabezado. Sin ningún encabezado → reparto por orden como antes. Los nombres se siguen separando por línea, `;` y `,`. `toast(msg, ms)` acepta duración.
- `start-btn` lee `input[data-group]` → `{name, groupIdx}` (vacío = BYE). Importar y Rellenar siguen llenando en orden, grupo a grupo. La lógica del torneo no cambia.

### Fase de grupos (admin) como una sola página
- `syncSetupMode()` también pone `body.groups-mode` mientras se ve `#group-screen` (admin): sin foto, sin margen del body, cabecera + `.phase-bar` + `.group-footer` con el mismo fondo `--bg2` y sin bordes.
- Los grupos (`#groups-container.groups-scroll`) pasan de tarjetas de ancho fijo con scroll horizontal a una **cuadrícula a todo el ancho** de hasta 4 columnas (`renderGroups` pone `data-cols` = mín(grupos, 4)), separadas por una línea vertical fina, sin marco; título de grupo con subrayado dorado. 2 columnas en ≤1100px, 1 en ≤640px. Nombres completos (sin recorte), clasificación alineada a la izquierda, letra algo mayor; el panel de marcador permite nombres en dos líneas.
- Solo CSS bajo `body.groups-mode` + `data-cols`: la lógica de grupos no cambia y la vista pública tampoco.

### Formato liga (1 grupo)
- En "Número de grupos" aparece **`Liga`** para tamaños ≤ `LEAGUE_MAX_SIZE` (32). Por defecto sigue seleccionado 2 grupos. El grupo se llama "Liga" (setup, fase, pegatinas, tarjeta pública).
- Todos contra todos (`makeRR`). Al pulsar "Avanzar al cuadro" con 1 grupo **se salta la pantalla de cruces**: confirmación y `launchTournament(title, generateProfessionalNames([[0]]))`.
- Siembra (`generateProfessionalNames`, rama `nGroups===1`): orden estándar duplicando `[1]→[1,2]→[1,4,2,3]→…` (semilla s contra N+1−s); 1º contra último y 1º/2º en mitades opuestas. Los BYE son las últimas semillas → nunca BYE contra BYE. Verificado: 8 → `1-8 4-5 | 2-7 3-6`; 16 con 11 jugadores → BYE para 1º–5º.
- **Jornadas**: la liga se crea con `makeLeagueMatches()` (método de rotación en `leagueRounds()`, solo jugadores reales; si son impares, uno descansa por jornada) y cada partido lleva `jornada`. Los partidos se guardan en orden de jornada (pegatinas y cola salen así). Ligas antiguas sin `jornada`: `ensureJornadas()` la asigna al pintar, sin reordenar (los índices gi/mi no cambian). La vista agrupa por jornada con cabecera `.jornada-lbl` ("Jornada N · Descansa: X · jugados/total"). `matchGroupLabel()` da "Liga · J3" para cola, iPad, ticket y pegatinas. Verificado 2–32 jugadores (pares/impares, con BYE): cada pareja una vez, nadie dos veces por jornada, como mucho uno descansa.
- Vista admin (`groups-mode`, `data-cols="1"`): clasificación a la izquierda (sticky) y partidos en dos columnas a la derecha.

## Setup — opciones del cuadro

### Tamaños disponibles
4, 8, 16, 32, **64** participantes. Variable global `bracketSize` (por defecto 4).

### Formato de eliminación
Variable global `doubleElim` (boolean, por defecto `true`).

| Modo | `doubleElim` | `state.lRounds` | `state.gf` | Campeón |
|------|-------------|-----------------|------------|---------|
| Doble eliminación | `true` | array de rondas | `{t1,t2,winner}` | `state.gf.winner` |
| Eliminación simple | `false` | `null` | `null` | `state.champion` |

- En `launchTournament`: si `doubleElim=false` no se construye lower bracket ni gran final, `state.singleElim=true`
- En `selectWinner`: si `state.singleElim`, no llama a `dropToLower`; si es la final, declara campeón en `state.champion`
- En `renderBracket` y `renderBracketDisplay`: si `state.singleElim`, NO se renderiza lower bracket ni gran final
- El simulador y `updateProgress` son null-safe respecto a `state.gf` y `state.lRounds`
- Al hacer "Nuevo Torneo" (`resetAll`), `doubleElim` vuelve a `true` y el selector UI se resetea

### Clases CSS de tamaño para el cuadro (`renderBracket` y `renderBracketDisplay`)

El contenedor del bracket recibe una clase CSS según el número de equipos para comprimir el layout:

| `numTeams` | Clase CSS | Escala aplicada |
|-----------|-----------|-----------------|
| 64 | `size-64` | `transform: scale(0.6)` en cada `.match` |
| 32 | `size-32` | `transform: scale(0.85)` en cada `.match` |
| ≤16 | _(ninguna)_ | tamaño normal |

**En `renderBracket` (vista admin, ~línea 2481):**
```javascript
if(state.numTeams===64){ c.classList.add('size-64'); c.classList.remove('size-32'); }
else if(state.numTeams===32){ c.classList.add('size-32'); c.classList.remove('size-64'); }
else { c.classList.remove('size-32'); c.classList.remove('size-64'); }
```

**En `renderBracketDisplay` (vista pública, ~línea 2851):**
```javascript
const cls = data.numTeams===64?'size-64':data.numTeams===32?'size-32':'';
```
La variable `cls` se aplica a `upperC.className` y `lowerC.className`.

Las reglas CSS de `size-64` están en `style.css` (sección `64 TEAMS OPTIMIZATION`).
Las reglas CSS de `size-32` también están en `style.css`.

## Header admin — menú desplegable

Los botones de administración están agrupados en un único menú desplegable (`☰ Menú`) en la esquina superior derecha. A su izquierda aparece el contador de dispositivos conectados (`ntfy-mini`).

### Estructura HTML (en `index.html`, dentro de `<header id="admin-header">`)
```html
<div class="ntfy-mini" id="ntfy-mini" onclick="openConnectModal()">...</div>
<div class="admin-menu-wrap" id="admin-menu-wrap">
  <button id="admin-menu-btn" onclick="toggleAdminMenu()">☰ Menú</button>
  <div id="admin-menu-dropdown">
    <!-- botones: Cola, Conectar, Mis Torneos, Nuevo Torneo, Limpiar disp., Cerrar sesión -->
  </div>
</div>
```

### CSS (en el `<style>` inline del `<head>` de `index.html`)
```css
.admin-menu-wrap { position:relative; }
#admin-menu-dropdown { display:none; position:absolute; top:calc(100% + 6px); right:0;
  background:#161620; border:1px solid rgba(255,255,255,0.18); border-radius:8px;
  padding:0.4rem; flex-direction:column; gap:0.3rem; min-width:200px;
  z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,0.5); }
```

### JS — importante
`toggleAdminMenu` está definida en un `<script>` clásico (NO módulo) en el `<head>` de `index.html`, porque `onclick=""` no accede al scope de `<script type="module">`. NO moverla a `script.js`.

```js
function toggleAdminMenu(){
  var dd=document.getElementById('admin-menu-dropdown');
  dd.style.display = dd.style.display==='flex' ? 'none' : 'flex';
  dd.style.flexDirection = 'column';
}
```

El cierre al hacer clic fuera también está en ese mismo `<script>` clásico.

## Patrón crítico: onclick vs. ES modules

`script.js` usa `<script type="module">`. Las funciones definidas dentro **no están en `window`** y no pueden llamarse desde atributos `onclick=""` de HTML.

**Regla:** cualquier función llamada vía `onclick=""` debe estar en un `<script>` clásico (sin `type="module"`) en el `<head>` de `index.html`. Si necesita leer/escribir una variable del módulo, usar un puente `window._nombre`.

### Funciones en el `<script>` clásico del `<head>` (NO mover a script.js)
- `toggleAdminMenu()` — abre/cierra el menú desplegable admin
- `setElimMode(val)` — cambia el modo de eliminación; escribe `window._setDoubleElim(val==='double')`
- Listener de clic-fuera del menú (`document.addEventListener('click', ...)`)

### Puentes módulo ↔ clásico (definidos en script.js)
- `window._setDoubleElim = v => { doubleElim = v; }` — permite que `setElimMode` actualice la variable del módulo
- `window.closeAdminMenu = function(){ ... }` — permite cerrar el menú desde dentro del módulo si hace falta

## Convenciones de código
- Indentación: 2 espacios
- Ficheros separados: HTML, CSS y JS en sus propios ficheros
- Variables y funciones en camelCase; constantes en UPPER_SNAKE_CASE
- Comentarios de sección en JS con `// ═══` (secciones principales) y `// ──` (subsecciones)

## Idioma
Responde siempre en español de España.
