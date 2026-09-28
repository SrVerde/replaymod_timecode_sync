/**
 * ReplaySync Calculator - timeUtils.js
 * Motor matemático bidireccional de sincronización temporal entre DaVinci Resolve POV y ReplayMod.
 */

/**
 * Rellena un número con ceros a la izquierda.
 * @param {number} num 
 * @param {number} size 
 * @returns {string}
 */
export function pad(num, size = 2) {
  let s = Math.abs(Math.floor(num)).toString();
  while (s.length < size) s = '0' + s;
  return s;
}

/**
 * Convierte una cadena de Timecode (HH:MM:SS:FF) a fotogramas absolutos.
 * Soporta signos negativos (-HH:MM:SS:FF) y rollover en entrada.
 * @param {string} tcString 
 * @param {number} fps 
 * @returns {{ hours: number, minutes: number, seconds: number, frames: number, totalFrames: number, isNegative: boolean }}
 */
export function parseTimecode(tcString, fps = 60) {
  if (typeof tcString !== 'string') {
    tcString = '00:00:00:00';
  }

  const trimmed = tcString.trim();
  const isNegative = trimmed.startsWith('-');
  const cleanStr = isNegative ? trimmed.slice(1) : trimmed;

  // Extraer partes separadas por : o ;
  const parts = cleanStr.split(/[:;]/).map(p => parseInt(p, 10) || 0);

  let hh = 0, mm = 0, ss = 0, ff = 0;
  if (parts.length >= 4) {
    [hh, mm, ss, ff] = parts;
  } else if (parts.length === 3) {
    [hh, mm, ss] = parts;
  } else if (parts.length === 2) {
    [mm, ss] = parts;
  } else if (parts.length === 1) {
    [ss] = parts;
  }

  const absFrames = ((hh * 3600 + mm * 60 + ss) * fps) + ff;
  const totalFrames = isNegative ? -absFrames : absFrames;

  return {
    hours: hh,
    minutes: mm,
    seconds: ss,
    frames: ff,
    totalFrames,
    isNegative
  };
}

/**
 * Convierte un número total de fotogramas a formato Timecode (HH:MM:SS:FF).
 * Realiza rollover matemático automático de frames a segundos, minutos y horas.
 * @param {number} totalFrames 
 * @param {number} fps 
 * @returns {string}
 */
export function framesToTimecode(totalFrames, fps = 60) {
  const isNegative = totalFrames < 0;
  const absFrames = Math.abs(Math.round(totalFrames));

  const ff = absFrames % fps;
  const totalSec = Math.floor(absFrames / fps);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);

  const sign = isNegative ? '-' : '';
  return `${sign}${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/**
 * Normaliza un timecode aplicando rollover si los frames exceden el framerate o los segundos exceden 59.
 * @param {string} tcString 
 * @param {number} fps 
 * @returns {string}
 */
export function normalizeTimecode(tcString, fps = 60) {
  const parsed = parseTimecode(tcString, fps);
  return framesToTimecode(parsed.totalFrames, fps);
}

/**
 * Modo A: Convierte Timecode POV de DaVinci a Time Index en milisegundos de ReplayMod.
 * @param {string} povTc Timecode POV ingresado (ej. "01:00:10:00")
 * @param {string} anchorTc Timecode ancla del Sync Point (ej. "01:00:00:00")
 * @param {number} anchorMs Milisegundos ancla de ReplayMod (ej. 1250000)
 * @param {number} fps Framerate del proyecto (ej. 60)
 * @returns {{ ms: number, isNegative: boolean, deltaFrames: number, deltaMs: number, humanReadable: string }}
 */
export function povToReplayMod(povTc, anchorTc, anchorMs, fps = 60) {
  const framesInput = parseTimecode(povTc, fps).totalFrames;
  const framesAnchor = parseTimecode(anchorTc, fps).totalFrames;

  const deltaFrames = framesInput - framesAnchor;
  const deltaMs = Math.round((deltaFrames * 1000) / fps);
  const resultMs = Math.round(anchorMs + deltaMs);

  return {
    ms: resultMs,
    isNegative: resultMs < 0,
    deltaFrames,
    deltaMs,
    humanReadable: formatReplayModTime(resultMs)
  };
}

/**
 * Modo B: Convierte Time Index en milisegundos de ReplayMod a Timecode POV de DaVinci.
 * @param {number} inputMs Milisegundos de ReplayMod ingresados (ej. 1260000)
 * @param {string} anchorTc Timecode ancla del Sync Point (ej. "01:00:00:00")
 * @param {number} anchorMs Milisegundos ancla de ReplayMod (ej. 1250000)
 * @param {number} fps Framerate del proyecto (ej. 60)
 * @returns {{ timecode: string, isNegative: boolean, totalFrames: number, deltaFrames: number, deltaMs: number }}
 */
export function replayModToPov(inputMs, anchorTc, anchorMs, fps = 60) {
  const deltaMs = inputMs - anchorMs;
  const deltaFrames = Math.round((deltaMs * fps) / 1000);

  const framesAnchor = parseTimecode(anchorTc, fps).totalFrames;
  const resultFrames = framesAnchor + deltaFrames;
  const resultTc = framesToTimecode(resultFrames, fps);

  return {
    timecode: resultTc,
    isNegative: resultFrames < 0,
    totalFrames: resultFrames,
    deltaFrames,
    deltaMs
  };
}

/**
 * Formatea un valor en milisegundos a un formato legible por humanos:
 * "HHh MMm SSs mmmms" o "MMm SSs mmmms"
 * Soporta valores negativos.
 * @param {number} ms 
 * @returns {string}
 */
export function formatReplayModTime(ms) {
  if (isNaN(ms) || ms === null || ms === undefined) {
    return '00m 00s 000ms';
  }

  const isNeg = ms < 0;
  const absMs = Math.abs(Math.round(ms));

  const hours = Math.floor(absMs / 3600000);
  const minutes = Math.floor((absMs % 3600000) / 60000);
  const seconds = Math.floor((absMs % 60000) / 1000);
  const remMs = absMs % 1000;

  const sign = isNeg ? '-' : '';

  if (hours > 0) {
    return `${sign}${hours}h ${pad(minutes)}m ${pad(seconds)}s ${pad(remMs, 3)}ms`;
  }
  return `${sign}${pad(minutes)}m ${pad(seconds)}s ${pad(remMs, 3)}ms`;
}
