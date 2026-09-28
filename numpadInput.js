/**
 * ReplaySync Calculator - numpadInput.js
 * Controlador de entrada de Timecode estilo DaVinci Resolve (inserción derecha a izquierda).
 */

import { normalizeTimecode, pad } from './timeUtils.js';

export class NumpadInput {
  /**
   * @param {HTMLInputElement} inputElement 
   * @param {Object} options 
   * @param {number} options.fps Framerate del proyecto
   * @param {function(string): void} [options.onChange] Callback al cambiar valor
   * @param {function(string): void} [options.onEnter] Callback al pulsar Enter
   */
  constructor(inputElement, options = {}) {
    this.input = inputElement;
    this.fps = options.fps || 60;
    this.onChange = options.onChange || null;
    this.onEnter = options.onEnter || null;

    // Buffer de 8 dígitos: HH MM SS FF
    this.buffer = '00000000';
    this.isNegative = false;

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
      // Al enfocar, seleccionar todo para comodidad visual
      this.input.select();
    });
  }

  /**
   * Manejador de eventos de teclado.
   * @param {KeyboardEvent} e 
   */
  _handleKeyDown(e) {
    // Permitir atajos con modificadores Ctrl, Alt, Meta (salvo Ctrl+V que se maneja en paste)
    if (e.altKey || e.ctrlKey || e.metaKey) {
      return;
    }

    // Tecla Enter
    if (e.key === 'Enter') {
      e.preventDefault();
      this.commit();
      if (this.onEnter) {
        this.onEnter(this.getValue());
      }
      return;
    }

    // Tecla Escape (quitar foco)
    if (e.key === 'Escape') {
      this.input.blur();
      return;
    }

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

    // Tecla de signo menos para conmutar negativo
    if (e.key === '-' || e.key === 'Subtract') {
      e.preventDefault();
      this.isNegative = !this.isNegative;
      this.render();
      if (this.onChange) this.onChange(this.getValue());
      return;
    }

    // Dígitos 0 al 9
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      // Desplazamiento hacia la izquierda: entra por la derecha
      this.buffer = this.buffer.slice(1) + e.key;
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
