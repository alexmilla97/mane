# Gestor de Torneos

## Descripción
Aplicación web de una sola página (SPA) para gestionar torneos completos. Incluye fase de grupos, emparejamientos y cuadro de eliminatorias con doble eliminación (bracket superior e inferior) y gran final. Todo en un único fichero `index.html`.

## Tecnologías
- HTML5 / CSS3 / JavaScript vanilla (sin frameworks)
- Fuentes: Barlow Condensed + Barlow (Google Fonts)
- Librería externa: qrcodejs (para códigos QR)

## Funcionalidades implementadas
- Pantalla de configuración: nombre del torneo, número de equipos, grupos
- Fase de grupos: clasificaciones en tiempo real, marcadores, indicadores de partido en directo / en cola
- Sistema multi-dispositivo: enviar partidos a pantallas externas
- Pantalla de emparejamientos: asignación de cruces entre grupos
- Cuadro de eliminatorias: bracket con doble eliminación, escalado automático al viewport
- Modo pantalla completa (F11)
- Códigos QR para acceso desde móvil
- Vistas especiales: `IS_DISPLAY`, `IS_BRACKET`, `IS_QUEUE`, `IS_DEVICE`

## Diseño visual
- Tema oscuro: fondo `#0E0E12`, acentos en dorado `#D4A017`
- Variables CSS centralizadas en `:root`
- Diseño responsive con scroll horizontal para los grupos

## Estructura del proyecto
- `index.html` — fichero principal
- `CLAUDE.md` — instrucciones para Claude Code

## Convenciones
- Indentación: 2 espacios
- Todo el código (HTML, CSS, JS) en un único fichero
- Variables y funciones en camelCase; constantes en UPPER_SNAKE_CASE
- Comentarios de sección con `/* ── NOMBRE ── */`

## Idioma
Responde siempre en español de España.
