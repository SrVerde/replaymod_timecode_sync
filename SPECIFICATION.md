# Especificación Técnica y Funcional: ReplaySync Calculator

**Versión:** 1.0.0  
**Fecha de Actualización:** 27 de Septiembre, 2026  
**Estado:** Arquitectura y CI/CD Validados en Producción; Listo para Implementación de Core  
**Repositorio Remoto:** [github.com/SrVerde/replaymod_timecode_sync](https://github.com/SrVerde/replaymod_timecode_sync)  
**Ruta Local:** `D:\Desktop\replaymod_timecode_sync`  

---

## 1. Resumen Ejecutivo y Alcance

**ReplaySync Calculator** es una aplicación web *single-page* (SPA) de alta precisión diseñada para editores de video que sincronizan grabaciones de pantalla (POV) de Minecraft editadas en **DaVinci Resolve** con grabaciones de cámara cinemática de **ReplayMod**.

### 1.1 El Problema
Las grabaciones de Minecraft frecuentemente sufren de desincronización con el tiempo absoluto de ReplayMod debido a:
1. **Variable Frame Rate (VFR) y caídas de cuadros:** Tirones o lag spikes locales (carga de chunks, redstone masivo) desajustan el avance de cuadros del video capturado respecto a la simulación interna del juego.
2. **Desfase de Reloj (Time of Day):** Los marcadores temporales del POV no coinciden de forma lineal con la línea de tiempo en milisegundos de ReplayMod.
3. **Fallas de la interpolación matemática tradicional:** La pérdida de cuadros ocurre por ráfagas discretas e impredecibles. Cualquier interpolación lineal o spline entre dos puntos distantes desincroniza los cuadros intermedios.

### 1.2 La Solución de Diseño
Un modelo de sincronización **Piecewise (por tramos manuales)** basado en "Match Frames" visuales:
* El editor establece puntos de sincronización ancla (*Sync Points*) en eventos visuales clave (ej. un golpe de espada, un salto, la apertura de un cofre).
* La calculadora calcula el desfase relativo exacto respecto al Sync Point activo seleccionado.
* La experiencia de usuario está optimizada para **teclado puro (Keyboard-First)** y emula la entrada de Timecode de DaVinci Resolve para no interrumpir el flujo de edición.

---

## 2. Decisiones de Diseño y Preferencias del Usuario

| Decisión | Enfoque Adoptado | Justificación |
| :--- | :--- | :--- |
| **Sincronización** | **Piecewise (Por tramos)** en lugar de interpolación continua | Evita errores de interpolación artificial ante pérdidas de cuadros erráticas de Minecraft. |
| **Dependencias** | **Vanilla absoluto (HTML5, CSS3, JS ES6+)** | Cero dependencias npm/pnpm, peso ultra liviano (<100 KB), carga instantánea (<50 ms), sin riesgo de rotura por actualizaciones de librerías. |
| **Configuración** | **JSON nativo** | Sin parsers externos ni wrappers pesados (ej. TOML). Compatible nativamente con `fetch` y `JSON.parse`. |
| **Mapeo Numpad** | **Estilo DaVinci Resolve** con inserción de derecha a izquierda | Memoria muscular nativa para editores. Teclear `125` resulta en `00:00:01:25`. |
| **Control de Frames** | **Rollover automático** (`FF >= FPS`) | Si los frames exceden el framerate del proyecto, se desbordan matemáticamente a segundos, minutos y horas automáticamente. |
| **Formato ReplayMod** | **Milisegundos enteros + Preview legible humano** | ReplayMod usa enteros crudos (ej: `1250000`), pero la UI muestra un preview legible secundario (`20m 50s 000ms`) para validación visual rápida. |
| **Atajo de Cancelación** | **`Esc` estándar** | Quita el foco del elemento activo (`blur()`) o cierra diálogos/modales abiertos, manteniendo el comportamiento estándar de SO y navegadores. |
| **Respaldo** | **Importación / Exportación JSON (`Alt+E` / `Alt+I`)** | Respalda las sesiones de `localStorage` ante limpiezas de caché o cambios de equipo. |

---

## 3. Tech Stack e Infraestructura

### 3.1 Tecnologías del Frontend
* **Estructura:** HTML5 semántico con elementos nativos accesibles (`<dialog>`, `<select>`, `<button>`).
* **Estilos:** CSS3 nativo con CSS Custom Properties (Variables de diseño).
  * Paleta Dark Mode inspirada en interfaces profesionales (zinc neutro `#121316`, `#18181b`, acentos ámbar/cyan para estados `:focus` y `:active`).
  * Tipografía: Fuentes monoespaciadas legibles para campos temporales (`JetBrains Mono`, `Fira Code` o stack de sistema monospace).
* **Lógica:** Vanilla JavaScript ES6+ modular (State Management, Time Engine, Keyboard Router, DOM Controller).
* **Persistencia:** `localStorage` del navegador para estado local persistente.

### 3.2 Infraestructura y Despliegue en la Nube
* **Proveedor:** Cloudflare Workers con **Static Assets** nativo.
* **Archivo de Configuración:** `wrangler.json` en la raíz del repositorio:
  ```json
  {
    "name": "replaymod-timecode-sync",
    "compatibility_date": "2024-09-01",
    "assets": {
      "directory": "."
    }
  }
  ```
* **Integración CI/CD:**
  * Conexión directa del repositorio de GitHub `SrVerde/replaymod_timecode_sync` a Cloudflare.
  * **Build Command:** Vacío / `None` (cero compilación, cero pnpm).
  * **Deploy Command:** `npx wrangler deploy`.
  * Despliegue automático en cada `git push` a la rama `main`.

---

## 4. Modelo de Datos (Data Architecture)

### 4.1 Configuración Global (`config.json`)
Archivo estático cargado al inicializar la SPA:
```json
{
  "video": {
    "default_fps": 60,
    "timeline_start_timecode": "01:00:00:00"
  },
  "app": {
    "auto_copy": true,
    "toast_duration_ms": 2000
  },
  "session": {
    "name_prefix": "Sesion_"
  }
}
```

### 4.2 Esquema de Persistencia (`localStorage` - Key: `replaysync_data_v1`)
```json
{
  "active_session_id": "session_1727480400",
  "sessions": [
    {
      "id": "session_1727480400",
      "name": "Sesion_20260927_1640",
      "created_at": 1727480400000,
      "fps": 60,
      "active_sync_point_id": "sp_1",
      "sync_points": [
        {
          "id": "sp_1",
          "name": "Inicio de combate",
          "pov_timecode": "01:00:00:00",
          "rm_time_index": 1250000,
          "is_default": true
        },
        {
          "id": "sp_2",
          "name": "Post lag-spike Nether",
          "pov_timecode": "01:14:22:15",
          "rm_time_index": 2112340,
          "is_default": false
        }
      ]
    }
  ]
}
```

---

## 5. Especificaciones Funcionales y Lógica Matemática

### 5.1 Motor Matemático Bidireccional
Dado un **Sync Point activo** con anclaje de tiempo:
* $TC_{anchor}$ (en formato `HH:MM:SS:FF`) con valor total en fotogramas $Frames_{anchor}$.
* $MS_{anchor}$ (en milisegundos enteros).
* Framerate del proyecto: $FPS$ (por defecto 60).

#### Modo A: DaVinci Timecode (POV) $\rightarrow$ ReplayMod Time Index
1. Convertir $TC_{input}$ a fotogramas absolutos:
   $$Frames_{input} = (HH \times 3600 + MM \times 60 + SS) \times FPS + FF$$
2. Calcular la diferencia de fotogramas respecto al ancla:
   $$\Delta Frames = Frames_{input} - Frames_{anchor}$$
3. Convertir $\Delta Frames$ a milisegundos:
   $$\Delta MS = \text{round}\left(\frac{\Delta Frames \times 1000}{FPS}\right)$$
4. Calcular el índice de tiempo en ReplayMod:
   $$MS_{result} = MS_{anchor} + \Delta MS$$

#### Modo B: ReplayMod Time Index $\rightarrow$ DaVinci Timecode (POV)
1. Calcular la diferencia en milisegundos:
   $$\Delta MS = MS_{input} - MS_{anchor}$$
2. Convertir $\Delta MS$ a fotogramas con redondeo al entero más cercano:
   $$\Delta Frames = \text{round}\left(\frac{\Delta MS \times FPS}{1000}\right)$$
3. Calcular fotogramas totales del POV:
   $$Frames_{result} = Frames_{anchor} + \Delta Frames$$
4. Formatear $Frames_{result}$ a Timecode con Rollover:
   $$FF = Frames_{result} \pmod{FPS}$$
   $$TotalSec = \lfloor Frames_{result} / FPS \rfloor$$
   $$SS = TotalSec \pmod{60}$$
   $$MM = \lfloor TotalSec / 60 \rfloor \pmod{60}$$
   $$HH = \lfloor TotalSec / 3600 \rfloor$$
   Resultado: `HH:MM:SS:FF`.

### 5.2 Lógica de Entrada Numpad Estilo DaVinci
* El input mantiene internamente un búfer de dígitos numéricos (longitud máxima de 8 dígitos para `HHMMSSFF`).
* Al pulsar un número $0-9$: se inserta al final (a la derecha) desplazando los anteriores a la izquierda.
  * Ejemplo: pulsar `1` $\rightarrow$ `00:00:00:01`
  * Luego pulsar `2` $\rightarrow$ `00:00:00:12`
  * Luego pulsar `5` $\rightarrow$ `00:00:01:25`
  * Luego pulsar `0` $\rightarrow$ `00:00:12:50`
* **Backspace:** Elimina el último dígito ingresado a la derecha, rellenando con `0` por la izquierda.
* **Rollover automático al confirmar/calcular:** Si el valor en la posición de fotogramas es $\ge FPS$ (ej: `00:00:01:75` a 60 fps), el sistema normaliza automáticamente a `00:00:02:15`.

### 5.3 Formateo Legible Humano para ReplayMod
Debajo del campo numérico principal de ReplayMod (milisegundos enteros), se presenta una etiqueta de previsualización no editable:
$$\text{Formato: } HH\text{h } MM\text{m } SS\text{s } mmm\text{ms} \quad \text{o} \quad MM\text{m } SS\text{s } mmm\text{ms}$$
* Ejemplo: `1250000 ms` $\rightarrow$ `20m 50s 000ms`.

---

## 6. Sistema de Interacción Keyboard-First

### 6.1 Matriz Completa de Atajos de Teclado

| Atajo | Contexto | Acción |
| :--- | :--- | :--- |
| **`Alt + 1`** o **`P`** | Global | Enfoca el conversor **POV $\rightarrow$ ReplayMod** (selecciona el contenido del input). |
| **`Alt + 2`** o **`R`** | Global | Enfoca el conversor **ReplayMod $\rightarrow$ POV** (selecciona el contenido del input). |
| **`Enter`** | En input conversor | Valida, ejecuta cálculo, copia resultado al portapapeles y lanza toast. |
| **`Esc`** | Global | Quita el foco del elemento activo (`blur()`) o cierra cualquier modal/diálogo activo. |
| **`Alt + N`** | Global | Abre diálogo para crear una **Nueva Sesión** con placeholder generado automáticamente. |
| **`Alt + S`** | Global | Abre diálogo para agregar un **Nuevo Sync Point** a la sesión actual. |
| **`Alt + E`** | Global | **Exporta** todas las sesiones y configuraciones a un archivo `replaysync_backup.json`. |
| **`Alt + I`** | Global | Abre el selector de archivo nativo para **Importar** sesiones desde un archivo JSON. |
| **`Arriba / Abajo`** | Selector de Sync Points | Cambia rápidamente entre los Sync Points de la sesión actual sin tocar el ratón. |
| **`Tab / Shift+Tab`** | Global | Navegación de foco accesible y secuencial. |

### 6.2 Notificaciones y Portapapeles (Auto-Copy)
* Cuando el usuario pulsa `Enter` en cualquier conversor:
  1. Se calcula el resultado.
  2. Se invoca `navigator.clipboard.writeText(...)`.
  3. Se muestra un **Toast Notification** no intrusivo en la esquina superior derecha (duración 2000 ms configurada en `config.json`).
  4. Mensaje visual: *"Copiado al portapapeles: [Valor]"*.

---

## 7. Síntesis de la Sesión Actual y Estado de Entrega

### 7.1 Lo completado en esta sesión:
1. **Validación del Documento de Diseño y Flujo de Trabajo:**
   * Aprobación del modelo Piecewise, entrada Numpad DaVinci con rollover, y preview secundario.
   * Acuerdos de atajos compatibles con navegadores (`Alt+N`, `Alt+E`, `Alt+I`, `Esc` estándar).
2. **Entorno Local y Repositorio Git:**
   * Ubicación del proyecto en disco de trabajo: [D:\Desktop\replaymod_timecode_sync](file:///D:/Desktop/replaymod_timecode_sync).
   * Repositorio remoto sincronizado: [github.com/SrVerde/replaymod_timecode_sync](https://github.com/SrVerde/replaymod_timecode_sync).
3. **Pipeline de Despliegue en Producción (Cloudflare Workers):**
   * Configuración de **Cloudflare Workers Static Assets** mediante `wrangler.json`.
   * Eliminación de comandos de compilación innecesarios (`pnpm`).
   * Despliegue continuo validado en verde con la plantilla base.

### 7.2 Hoja de Ruta para la Siguiente Sesión:
* **Fase 1 (Módulos Core):**
  * Crear `config.json` con los valores de inicialización.
  * Implementar el motor de tiempo `timeUtils.js` (cálculo de frames, rollover, milisegundos, formato legible).
  * Implementar el controlador de input `numpadInput.js` (buffer de derecha a izquierda, backspace y rollover).
* **Fase 2 (Interfaz y Estilos):**
  * Construir el layout completo en `index.html` (header con estado de sesión, selector de Sync Points, paneles bidireccionales, contenedor de toasts, modales `<dialog>`).
  * Implementar el sistema de diseño en `style.css` (Dark theme profesional, estados de foco de alto contraste, tipografía monoespaciada).
* **Fase 3 (Integración y Persistencia):**
  * Implementar `app.js` con el gestor de estado (`localStorage`), enrutador global de teclado, import/export de JSON y portapapeles.
* **Fase 4 (Validación E2E y Release):**
  * Pruebas de cálculo numpad, rollover y shortcuts en navegador.
  * Git commit y despliegue final en producción.
