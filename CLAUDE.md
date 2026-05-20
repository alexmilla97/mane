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

## Bugs conocidos y soluciones aplicadas (script.js)

### Cola de dispositivos / sincronización
- `buildAndSaveQueue` crasheaba silenciosamente en torneos de bracket porque `groupData.groups` es `undefined` en fase eliminatoria. Solución: `(groupData.groups||[]).forEach(...)`.
- `dispatchNextFromQueue` no llamaba a `buildAndSaveQueue` al terminar si el torneo era solo bracket. Solución: guardia `groupData.groups || state.rounds`.
- El listener de scores usaba `forEach(async ...)`, lo que lanzaba múltiples `dispatchNextFromQueue` concurrentes. Solución: `for...of` con `await`.
- `getNextMatchId()` hacía una transacción Firestore antes de actualizar la UI, generando un delay visible y ventana de doble-clic. Solución: sustituida por `Date.now()` (síncrono).
- El listener `onSnapshot(QUEUE_REF())` no se cancelaba antes de crear uno nuevo. Solución: guardado en `unsubscribeQueue` y cancelado en `showAdminView`.
- `updateDeviceUI` no refrescaba el botón de cola en el panel de marcadores del bracket cuando llegaba una actualización externa. Solución: añadido bloque que detecta `_bsp` abierto y reemplaza `#bsp-queue-section`.

### Vista de cola pública (?mode=queue)
- `renderQueueItems` vaciaba el DOM con `innerHTML=''` en cada actualización de Firestore, causando un parpadeo visible y el reinicio de las animaciones CSS. Solución: DOM diffing con `data-key` por partido; los nodos existentes se actualizan en sitio y solo se añaden o eliminan los que cambian.
- Parpadeo de la tarjeta verde ("EN JUEGO") durante transiciones de partido: Firestore emite estados intermedios donde el partido activo aparece como `status:'pending'` (sin live ni queued). Solución: caché de datos `_lastLiveByDev` en `renderQueueItems` — guarda el último item live por dispositivo e inyecta datos sintéticos cuando el estado entrante no tiene ningún partido live, manteniendo el nodo DOM intacto durante la transición.

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
- El simulador y `updateProgress` son null-safe respecto a `state.gf` y `state.lRounds`
- Al hacer "Nuevo Torneo" (`resetAll`), `doubleElim` vuelve a `true` y el selector UI se resetea

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

## Convenciones de código
- Indentación: 2 espacios
- Ficheros separados: HTML, CSS y JS en sus propios ficheros
- Variables y funciones en camelCase; constantes en UPPER_SNAKE_CASE
- Comentarios de sección en JS con `// ═══` (secciones principales) y `// ──` (subsecciones)

## Idioma
Responde siempre en español de España.
