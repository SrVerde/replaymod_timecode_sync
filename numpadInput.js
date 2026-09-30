/**
 * ReplaySync Calculator - numpadInput.js
 * Controlador de entrada de Timecode estilo DaVinci Resolve (inserción derecha a izquierda).
 */

import { normalizeTimecode, pad, applyOffsetToTimecode } from './timeUtils.js';

export class NumpadInput {
  /**
   * @param {HTMLInputElement} inputElement 
   * @param {Object} options 
   * @param {number} options.fps Framerate del proyecto
   * @param {function(string): void} [options.onChange] Callback al cambiar valor
   * @param {function(string): void} [options.onEnter] Callback al pulsar Enter
   * @param {function(Object): void} [options.onOffsetStateChange] Callback de estado de modo calculadora
   */
  constructor(inputElement, options = {}) {
    this.input = inputElement;
    this.fps = options.fps || 60;
    this.onChange = options.onChange || null;
    this.onEnter = options.onEnter || null;
    this.onOffsetStateChange = options.onOffsetStateChange || null;
    this.onUndo = options.onUndo || null;
    this.onRedo = options.onRedo || null;

    // Buffer de 8 dígitos: HH MM SS FF
    this.buffer = '00000000';
    this.bufferHistory = [];
    this.isNegative = false;

    // Estado del Modo Calculadora (Offset Mode)
    this.isOffsetMode = false;
    this.offsetOp = '+';
    this.baseTimecode = '';
    this.offsetBuffer = '';

    this._bindEvents();
    this.render();
  }

  /**
   * Vincula los listeners de teclado, paste y focus.
   */
  _bindEvents() {
    this.input.addEventListener('keydown', (e) => this._handleKeyDown(e));
    this.input.addEventListener('paste', (e) => this._handlePaste(e));
    this.input.addEventListener('focus', () => {
      if (!this.isOffsetMode) {
        this.input.select();
        this.bufferHistory = [this.buffer];
      }
    });
  }

  /**
   * Manejador de eventos de teclado.
   * @param {KeyboardEvent} e 
   */
  _handleKeyDown(e) {
    // Interceptar Undo (Ctrl+Z) y Redo (Ctrl+Shift+Z / Ctrl+Y)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (this.isOffsetMode) {
        if (this.offsetBuffer.length > 0) {
          this.offsetBuffer = this.offsetBuffer.slice(0, -1);
          this.renderOffsetFormula();
          this._notifyOffset();
        } else {
          this.exitOffsetMode(false);
        }
        return;
      }
      if (this.bufferHistory && this.bufferHistory.length > 1) {
        this.bufferHistory.pop();
        this.buffer = this.bufferHistory[this.bufferHistory.length - 1];
        this.render();
        if (this.onChange) this.onChange(this.getValue());
        return;
      }
      if (this.onUndo) {
        this.onUndo();
        return;
      }
    }

    if (((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
        ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y'))) {
      e.preventDefault();
      if (this.onRedo) {
        this.onRedo();
        return;
      }
    }

    // Permitir atajos con modificadores Ctrl, Alt, Meta (salvo Ctrl+V que se maneja en paste)
    if (e.altKey || e.ctrlKey || e.metaKey) {
      return;
    }

    // Tecla Enter
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.isOffsetMode) {
        this.exitOffsetMode(true);
      } else {
        this.commit();
      }
      if (this.onEnter) {
        this.onEnter(this.getValue());
      }
      return;
    }

    // Tecla Escape (cancelar modo calculadora o quitar foco)
    if (e.key === 'Escape') {
      if (this.isOffsetMode) {
        e.preventDefault();
        e.stopPropagation();
        this.exitOffsetMode(false);
        return;
      }
      this.input.blur();
      return;
    }

    // Teclas + o - para activar/conmutar Modo Calculadora (Offset)
    if (e.key === '+' || e.key === 'Add' || e.key === '-' || e.key === 'Subtract') {
      e.preventDefault();
      const op = (e.key === '-' || e.key === 'Subtract') ? '-' : '+';
      if (!this.isOffsetMode) {
        this.isOffsetMode = true;
        this.offsetOp = op;
        this.baseTimecode = this.getValue();
        this.offsetBuffer = '';
        this.renderOffsetFormula();
        this._notifyOffset();
      } else {
        // Conmutar entre + y -
        this.offsetOp = (this.offsetOp === '+') ? '-' : '+';
        this.renderOffsetFormula();
        this._notifyOffset();
      }
      return;
    }

    // ======================================================================
    // Manejo cuando está en MODO CALCULADORA (Offset Mode)
    // ======================================================================
    if (this.isOffsetMode) {
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (this.offsetBuffer.length > 0) {
          this.offsetBuffer = this.offsetBuffer.slice(0, -1);
          this.renderOffsetFormula();
          this._notifyOffset();
        } else {
          // Si el buffer ya está vacío, salir del modo offset y restaurar base
          this.exitOffsetMode(false);
        }
        return;
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        this.offsetBuffer = '';
        this.renderOffsetFormula();
        this._notifyOffset();
        return;
      }

      // Permitir dígitos 0-9 y letras f, m, s (case-insensitive) y dos puntos si lo desean
      if (/^[0-9fms:;]$/i.test(e.key)) {
        e.preventDefault();
        this.offsetBuffer += e.key;
        this.renderOffsetFormula();
        this._notifyOffset();
        return;
      }

      // Permitir navegación
      if (['Tab', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        return;
      }

      if (e.key.length === 1) {
        e.preventDefault();
      }
      return;
    }

    // ======================================================================
    // Manejo normal Numpad (derecha a izquierda)
    // ======================================================================

    // Tecla Backspace (eliminar último dígito ingresado a la derecha)
    if (e.key === 'Backspace') {
      e.preventDefault();
      this.buffer = '0' + this.buffer.slice(0, 7);
      this.render();
      if (this.onChange) this.onChange(this.getValue());
      return;
    }

    // Tecla Delete (resetear a ceros)
    if (e.key === 'Delete') {
      e.preventDefault();
      this.buffer = '00000000';
      this.isNegative = false;
      this.render();
      if (this.onChange) this.onChange(this.getValue());
      return;
    }

    // Dígitos 0 al 9
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      // Desplazamiento hacia la izquierda: entra por la derecha
      this.buffer = this.buffer.slice(1) + e.key;
      if (this.bufferHistory) {
        this.bufferHistory.push(this.buffer);
        if (this.bufferHistory.length > 30) this.bufferHistory.shift();
      }
      this.render();
      if (this.onChange) this.onChange(this.getValue());
      return;
    }

    // Teclas de navegación permitidas (Tab, flechas)
    if (['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      return;
    }

    // Bloquear cualquier otra tecla alfanumérica
    if (e.key.length === 1) {
      e.preventDefault();
    }
  }

  /**
   * Notifica a la interfaz los cambios en el cálculo en vivo del offset.
   */
  _notifyOffset() {
    let previewTc = this.baseTimecode;
    let valid = false;
    let deltaMs = 0;
    let deltaFrames = 0;

    if (this.offsetBuffer.trim()) {
      const res = applyOffsetToTimecode(this.baseTimecode, this.offsetOp, this.offsetBuffer, this.fps);
      if (res.valid) {
        previewTc = res.resultTc;
        valid = true;
        deltaMs = res.deltaMs;
        deltaFrames = res.deltaFrames;
      }
    }

    if (this.onOffsetStateChange) {
      this.onOffsetStateChange({
        isOffsetMode: this.isOffsetMode,
        operator: this.offsetOp,
        baseTimecode: this.baseTimecode,
        offsetBuffer: this.offsetBuffer,
        previewTc,
        valid,
        deltaMs,
        deltaFrames
      });
    }
  }

  /**
   * Sale del Modo Calculadora, aplicando o descartando el resultado.
   * @param {boolean} apply 
   */
  exitOffsetMode(apply = true) {
    if (!this.isOffsetMode) return;

    if (apply && this.offsetBuffer.trim()) {
      const res = applyOffsetToTimecode(this.baseTimecode, this.offsetOp, this.offsetBuffer, this.fps);
      if (res.valid) {
        this.setTimecode(res.resultTc);
      } else {
        this.setTimecode(this.baseTimecode);
      }
    } else {
      this.setTimecode(this.baseTimecode);
    }

    this.isOffsetMode = false;
    this.offsetBuffer = '';
    this.render();

    if (this.onOffsetStateChange) {
      this.onOffsetStateChange({
        isOffsetMode: false,
        operator: '+',
        baseTimecode: this.getValue(),
        offsetBuffer: '',
        previewTc: this.getValue(),
        valid: false
      });
    }
  }

  /**
   * Manejador de pegado de portapapeles (Ctrl+V).
   * @param {ClipboardEvent} e 
   */
  _handlePaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (!text.trim()) return;

    this.setTimecode(text.trim());
    if (this.onChange) this.onChange(this.getValue());
  }

  /**
   * Establece un timecode en el buffer desde una cadena (ej. "01:14:22:15" o "1142215").
   * @param {string} tcString 
   */
  setTimecode(tcString) {
    if (typeof tcString !== 'string') return;
    const trimmed = tcString.trim();
    this.isNegative = trimmed.startsWith('-');
    const cleanStr = this.isNegative ? trimmed.slice(1) : trimmed;

    // Si contiene dos puntos o punto y coma
    if (cleanStr.includes(':') || cleanStr.includes(';')) {
      const parts = cleanStr.split(/[:;]/).map(p => p.trim());
      let hh = '00', mm = '00', ss = '00', ff = '00';
      if (parts.length >= 4) {
        hh = pad(parseInt(parts[0], 10) || 0);
        mm = pad(parseInt(parts[1], 10) || 0);
        ss = pad(parseInt(parts[2], 10) || 0);
        ff = pad(parseInt(parts[3], 10) || 0);
      } else if (parts.length === 3) {
        hh = pad(parseInt(parts[0], 10) || 0);
        mm = pad(parseInt(parts[1], 10) || 0);
        ss = pad(parseInt(parts[2], 10) || 0);
        ff = '00';
      } else if (parts.length === 2) {
        mm = pad(parseInt(parts[0], 10) || 0);
        ss = pad(parseInt(parts[1], 10) || 0);
      } else if (parts.length === 1) {
        ss = pad(parseInt(parts[0], 10) || 0);
      }
      this.buffer = `${hh}${mm}${ss}${ff}`;
    } else {
      // Solo dígitos numéricos
      const digitsOnly = cleanStr.replace(/\D/g, '');
      if (digitsOnly.length > 8) {
        this.buffer = digitsOnly.slice(-8);
      } else {
        this.buffer = digitsOnly.padStart(8, '0');
      }
    }

    this.render();
  }

  /**
   * Aplica normalización de rollover (si frames >= fps) y sincroniza el buffer.
   */
  commit() {
    const current = this.getValue();
    const normalized = normalizeTimecode(current, this.fps);
    this.setTimecode(normalized);
  }

  /**
   * Renderiza la fórmula completa en el input cuando está en modo offset.
   * Ej: "01:00:00:00 + 15f" o "01:00:00:00 + "
   */
  renderOffsetFormula() {
    if (this.isOffsetMode) {
      this.input.value = `${this.baseTimecode} ${this.offsetOp} ${this.offsetBuffer}`;
    } else {
      this.render();
    }
  }

  /**
   * Actualiza el valor mostrado en el elemento input.
   */
  render() {
    this.input.value = this.getValue();
  }

  /**
   * Retorna el timecode actual formateado como [signo]HH:MM:SS:FF.
   * @returns {string}
   */
  getValue() {
    const hh = this.buffer.slice(0, 2);
    const mm = this.buffer.slice(2, 4);
    const ss = this.buffer.slice(4, 6);
    const ff = this.buffer.slice(6, 8);
    const sign = this.isNegative ? '-' : '';
    return `${sign}${hh}:${mm}:${ss}:${ff}`;
  }

  /**
   * Actualiza el framerate de trabajo.
   * @param {number} newFps 
   */
  setFps(newFps) {
    if (newFps > 0) {
      this.fps = newFps;
      this.commit();
    }
  }

  /**
   * Resetea el input a 00:00:00:00.
   */
  reset() {
    this.buffer = '00000000';
    this.isNegative = false;
    this.render();
  }
}
