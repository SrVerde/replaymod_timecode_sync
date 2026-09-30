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

/**
 * Parsea un operando según las reglas:
 * 1. Si termina en 'ms' -> milisegundos (ej. '500ms', '1500ms')
 * 2. Si termina en 'f' -> frames (ej. '15f', '60f')
 * 3. Si termina en 's' -> segundos (ej. '2s', '1.5s')
 * 4. Por defecto (sin sufijo de unidad) -> Timecode estilo DaVinci sin dos puntos (ej. '100' = 00:00:01:00, '25' = 00:00:00:25)
 * @param {string} operandStr 
 * @param {number} fps 
 * @returns {{ type: 'ms'|'frames'|'seconds'|'timecode'|'empty'|'unknown', raw: any, frames: number, ms: number, valid: boolean }}
 */
export function parseOperand(operandStr, fps = 60) {
  if (typeof operandStr !== 'string') {
    return { type: 'unknown', raw: 0, frames: 0, ms: 0, valid: false };
  }

  const str = operandStr.trim().toLowerCase();
  if (!str) {
    return { type: 'empty', raw: 0, frames: 0, ms: 0, valid: false };
  }

  // 1. Milisegundos: termina en 'ms'
  if (str.endsWith('ms')) {
    const val = parseFloat(str.slice(0, -2).trim());
    if (!isNaN(val)) {
      const ms = Math.round(val);
      const frames = Math.round((ms * fps) / 1000);
      return { type: 'ms', raw: val, frames, ms, valid: true };
    }
  }

  // 2. Frames: termina en 'f'
  if (str.endsWith('f')) {
    const val = parseFloat(str.slice(0, -1).trim());
    if (!isNaN(val)) {
      const frames = Math.round(val);
      const ms = Math.round((frames * 1000) / fps);
      return { type: 'frames', raw: val, frames, ms, valid: true };
    }
  }

  // 3. Segundos: termina en 's'
  if (str.endsWith('s')) {
    const val = parseFloat(str.slice(0, -1).trim());
    if (!isNaN(val)) {
      const ms = Math.round(val * 1000);
      const frames = Math.round(val * fps);
      return { type: 'seconds', raw: val, frames, ms, valid: true };
    }
  }

  // 4. Timecode por defecto (sin necesidad de escribir dos puntos)
  // Si contiene ':' o ';' es timecode estándar
  if (str.includes(':') || str.includes(';')) {
    const parsed = parseTimecode(str, fps);
    const ms = Math.round((parsed.totalFrames * 1000) / fps);
    return { type: 'timecode', raw: str, frames: parsed.totalFrames, ms, valid: true };
  }

  // Si son solo dígitos: interpretar de derecha a izquierda como HH:MM:SS:FF
  const digitsOnly = str.replace(/\D/g, '');
  if (digitsOnly.length > 0) {
    const padded = digitsOnly.padStart(8, '0').slice(-8);
    const hh = parseInt(padded.slice(0, 2), 10);
    const mm = parseInt(padded.slice(2, 4), 10);
    const ss = parseInt(padded.slice(4, 6), 10);
    const ff = parseInt(padded.slice(6, 8), 10);

    const tcStr = `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
    const parsed = parseTimecode(tcStr, fps);
    const ms = Math.round((parsed.totalFrames * 1000) / fps);
    return { type: 'timecode', raw: tcStr, frames: parsed.totalFrames, ms, valid: true };
  }

  return { type: 'unknown', raw: operandStr, frames: 0, ms: 0, valid: false };
}

/**
 * Aplica una operación de suma o resta a un Timecode base.
 * @param {string} baseTc Timecode base (ej. "01:00:00:00")
 * @param {'+'|'-'} operator 
 * @param {string} operandStr Valor a sumar/restar (ej. "15f", "500ms", "100")
 * @param {number} fps 
 * @returns {{ resultTc: string, deltaFrames: number, deltaMs: number, valid: boolean, parsed: any }}
 */
export function applyOffsetToTimecode(baseTc, operator, operandStr, fps = 60) {
  const parsed = parseOperand(operandStr, fps);
  if (!parsed.valid) {
    return { resultTc: baseTc, deltaFrames: 0, deltaMs: 0, valid: false, parsed };
  }

  const baseFrames = parseTimecode(baseTc, fps).totalFrames;
  const deltaFrames = operator === '-' ? -parsed.frames : parsed.frames;
  const deltaMs = operator === '-' ? -parsed.ms : parsed.ms;
  const newTotalFrames = baseFrames + deltaFrames;
  const resultTc = framesToTimecode(newTotalFrames, fps);

  return {
    resultTc,
    deltaFrames,
    deltaMs,
    valid: true,
    parsed
  };
}

/**
 * Aplica una operación de suma o resta a un valor base en milisegundos.
 * @param {number} baseMs Milisegundos base (ej. 1250000)
 * @param {'+'|'-'} operator 
 * @param {string} operandStr Valor a sumar/restar (ej. "15f", "500ms", "100")
 * @param {number} fps 
 * @returns {{ resultMs: number, deltaMs: number, deltaFrames: number, valid: boolean, parsed: any }}
 */
export function applyOffsetToMs(baseMs, operator, operandStr, fps = 60) {
  const parsed = parseOperand(operandStr, fps);
  if (!parsed.valid) {
    return { resultMs: baseMs, deltaMs: 0, deltaFrames: 0, valid: false, parsed };
  }

  const deltaMs = operator === '-' ? -parsed.ms : parsed.ms;
  const deltaFrames = operator === '-' ? -parsed.frames : parsed.frames;
  const resultMs = Math.round(baseMs + deltaMs);

  return {
    resultMs,
    deltaMs,
    deltaFrames,
    valid: true,
    parsed
  };
}

