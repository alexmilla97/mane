# Gestor de Torneos

## Descripción
Aplicación web de una sola página (SPA) para gestionar torneos completos. Incluye fase de grupos, emparejamientos y cuadro de eliminatorias con doble eliminación (bracket superior e inferior) y gran final.

## Tecnologías
- HTML5 / CSS3 / JavaScript vanilla (sin frameworks)
- Firebase (Firestore + Auth) para persistencia y sincronización en tiempo real
- Fuentes: Barlow Condensed + Barlow (Google Fonts)
- Librerías externas: qrcodejs (QR), jsPDF (pegatinas PDF), SheetJS (importar Excel)

## Funcionalidades implementadas
- Pantalla de configuración: nombre del torneo, número de equipos, grupos
- Fase de grupos: clasificaciones en tiempo real, marcadores, indicadores de partido en directo / en cola
- Sistema multi-dispositivo: enviar partidos a pantallas externas vía Firebase
- Pantalla de emparejamientos: asignación de cruces entre grupos
- Cuadro de eliminatorias: bracket con doble eliminación, escalado automático al viewport
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

## Estructura del proyecto
```
Proyecto 1/
├── index.html    — HTML y estructura de pantallas
├── style.css     — Todo el CSS
├── script.js     — Toda la lógica JavaScript (con índice de secciones al inicio)
└── CLAUDE.md     — Instrucciones para Claude Code
```

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
git -C "C:\Users\GEAMA\Desktop\Proyecto 1" add .
git -C "C:\Users\GEAMA\Desktop\Proyecto 1" commit -m "descripción del cambio"
git -C "C:\Users\GEAMA\Desktop\Proyecto 1" push
```

## Convenciones de código
- Indentación: 2 espacios
- Ficheros separados: HTML, CSS y JS en sus propios ficheros
- Variables y funciones en camelCase; constantes en UPPER_SNAKE_CASE
- Comentarios de sección en JS con `// ═══` (secciones principales) y `// ──` (subsecciones)

## Idioma
Responde siempre en español de España.
