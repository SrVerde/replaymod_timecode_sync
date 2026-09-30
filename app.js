/**
 * ReplaySync Calculator - app.js
 * Orquestador principal, gestión de estado, enrutador de teclado e interfaz de usuario.
 */

import { parseTimecode, framesToTimecode, normalizeTimecode, povToReplayMod, replayModToPov, formatReplayModTime } from './timeUtils.js';
import { NumpadInput } from './numpadInput.js';

// Clave de almacenamiento local
const STORAGE_KEY = 'replaysync_data_v1';

// Estado global de la aplicación
const state = {
  config: {
    video: { default_fps: 60, timeline_start_timecode: '01:00:00:00' },
    app: { auto_copy: true, toast_duration_ms: 2000 },
    session: { name_prefix: 'Sesion_' }
  },
  data: {
    active_session_id: null,
    sessions: []
  },
  numpadPov: null,
  activeDeleteCallback: null
};

// ==========================================================================
// Inicialización
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  loadData();
  setupInputs();
  setupEventListeners();
  setupGlobalShortcuts();
  renderAll();
});

/**
 * Carga el archivo config.json estático con fallback a valores por defecto.
 */
async function loadConfig() {
  try {
    const res = await fetch('config.json');
    if (res.ok) {
      const cfg = await res.json();
      state.config = { ...state.config, ...cfg };
    }
  } catch (err) {
    console.warn('Usando configuración fallback por defecto:', err);
  }
}

/**
 * Carga los datos desde localStorage o inicializa una sesión inicial de muestra.
 */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state.data = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error cargando localStorage:', err);
  }

  // Si no hay sesiones válidas, crear la sesión inicial por defecto
  if (!state.data || !Array.isArray(state.data.sessions) || state.data.sessions.length === 0) {
    const now = new Date();
    const dateStr = formatDateForSession(now);
    const initialSessionId = `session_${Date.now()}`;
    const initialSpId = `sp_${Date.now()}`;

    state.data = {
      active_session_id: initialSessionId,
      sessions: [
        {
          id: initialSessionId,
          name: `${state.config.session.name_prefix}${dateStr}`,
          created_at: Date.now(),
          fps: state.config.video.default_fps,
          active_sync_point_id: initialSpId,
          sync_points: [
            {
              id: initialSpId,
              name: 'Punto de Inicio',
              pov_timecode: state.config.video.timeline_start_timecode,
              rm_time_index: 1250000,
              is_default: true
            }
          ]
        }
      ]
    };
    saveData();
  }
}

/**
 * Guarda el estado actual en localStorage.
 */
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  } catch (err) {
    console.error('Error guardando en localStorage:', err);
  }
}

/**
 * Retorna la sesión activa actual.
 */
function getActiveSession() {
  return state.data.sessions.find(s => s.id === state.data.active_session_id) || state.data.sessions[0];
}

/**
 * Retorna el Sync Point activo de la sesión actual.
 */
function getActiveSyncPoint() {
  const session = getActiveSession();
  if (!session || !session.sync_points || session.sync_points.length === 0) return null;
  return session.sync_points.find(sp => sp.id === session.active_sync_point_id) || session.sync_points[0];
}

// ==========================================================================
// Configuración de Controladores e Inputs
// ==========================================================================

function setupInputs() {
  const session = getActiveSession();
  const fps = session ? session.fps : state.config.video.default_fps;

  // Controlador Numpad para Modo A (POV)
  const povInputEl = document.getElementById('input-pov-tc');
  state.numpadPov = new NumpadInput(povInputEl, {
    fps: fps,
    onEnter: () => {
      calculateModeA();
    }
  });

  // Input Modo B (ReplayMod ms)
  const rmInputEl = document.getElementById('input-rm-ms');
  rmInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      calculateModeB();
    }
  });

  // Previsualización en vivo mientras teclea en Modo B
  rmInputEl.addEventListener('input', () => {
    const val = parseInt(rmInputEl.value, 10);
    const previewEl = document.getElementById('input-rm-preview-inline');
    if (!isNaN(val)) {
      previewEl.textContent = formatReplayModTime(val);
    } else {
      previewEl.textContent = '00m 00s 000ms';
    }
  });
}

// ==========================================================================
// Event Listeners y Botones
// ==========================================================================

function setupEventListeners() {
  // Selector de Sesión
  const sessionSelect = document.getElementById('session-select');
  sessionSelect.addEventListener('change', (e) => {
    state.data.active_session_id = e.target.value;
    saveData();
    updateFpsForSession();
    renderAll();
  });

  // Selector de FPS
  const fpsSelect = document.getElementById('fps-select');
  fpsSelect.addEventListener('change', (e) => {
    const newFps = parseInt(e.target.value, 10) || 60;
    const session = getActiveSession();
    if (session) {
      session.fps = newFps;

      // Re-normalizar los sync points existentes de la sesión al nuevo framerate
      if (Array.isArray(session.sync_points)) {
        session.sync_points.forEach(sp => {
          if (sp.pov_timecode) {
            sp.pov_timecode = normalizeTimecode(sp.pov_timecode, newFps);
          }
        });
      }

      saveData();
      state.numpadPov.setFps(newFps);
      renderSessionSelector();
      renderSyncBanner();
      renderSyncPointsTable();
      calculateModeA(false);
      calculateModeB(false);
      showToast(`Framerate de la sesión: ${newFps} fps`);
    }
  });

  // Selector de Sync Point Activo
  const spSelect = document.getElementById('sync-point-select');
  spSelect.addEventListener('change', (e) => {
    const session = getActiveSession();
    if (session) {
      session.active_sync_point_id = e.target.value;
      saveData();
      renderSyncBanner();
      renderSyncPointsTable();
      calculateModeA(false);
      calculateModeB(false);
    }
  });

  // Botones de Cálculo
  document.getElementById('btn-calc-mode-a').addEventListener('click', () => calculateModeA());
  document.getElementById('btn-calc-mode-b').addEventListener('click', () => calculateModeB());

  // Botones de Copiar en Resultados
  document.getElementById('btn-copy-result-a').addEventListener('click', () => {
    const rawVal = document.getElementById('result-a-ms').dataset.raw;
    if (rawVal !== undefined) {
      copyToClipboard(rawVal, `${formatNumber(rawVal)} ms`);
    }
  });

  document.getElementById('btn-copy-result-b').addEventListener('click', () => {
    const tcVal = document.getElementById('result-b-tc').textContent.trim();
    if (tcVal) {
      copyToClipboard(tcVal, tcVal);
    }
  });

  // Botón Nueva Sesión
  document.getElementById('btn-new-session').addEventListener('click', () => openNewSessionModal());

  // Formulario Nueva Sesión
  document.getElementById('form-session').addEventListener('submit', (e) => {
    e.preventDefault();
    handleCreateSession();
  });

  // Botones Sync Point (Nuevo, Editar, Eliminar)
  document.getElementById('btn-new-sp').addEventListener('click', () => openSyncPointModal(null));
  document.getElementById('btn-add-sp-table').addEventListener('click', () => openSyncPointModal(null));
  document.getElementById('btn-edit-sp').addEventListener('click', () => {
    const currentSp = getActiveSyncPoint();
    if (currentSp) openSyncPointModal(currentSp);
  });
  document.getElementById('btn-delete-sp').addEventListener('click', () => {
    const currentSp = getActiveSyncPoint();
    if (currentSp) confirmDeleteSyncPoint(currentSp.id);
  });

  // Formulario Sync Point (Crear / Editar)
  document.getElementById('form-syncpoint').addEventListener('submit', (e) => {
    e.preventDefault();
    handleSaveSyncPoint();
  });

  // Previsualización en vivo en modal Sync Point
  const spMsInput = document.getElementById('sp-ms-input');
  spMsInput.addEventListener('input', () => {
    const val = parseInt(spMsInput.value, 10);
    document.getElementById('sp-ms-preview').textContent = !isNaN(val) ? formatReplayModTime(val) : '00m 00s 000ms';
  });

  // Botón de confirmación de eliminación
  document.getElementById('btn-confirm-delete-action').addEventListener('click', () => {
    if (state.activeDeleteCallback) {
      state.activeDeleteCallback();
      state.activeDeleteCallback = null;
    }
    closeDialog(document.getElementById('modal-confirm'));
  });

  // Botones para cerrar dialogs
  document.querySelectorAll('[data-close-dialog]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dialog = btn.closest('dialog');
      if (dialog) closeDialog(dialog);
    });
  });

  // Exportar e Importar
  document.getElementById('btn-export').addEventListener('click', () => exportData());
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-import-input').click();
  });
  document.getElementById('file-import-input').addEventListener('change', (e) => handleImportFile(e));
}

// ==========================================================================
// Enrutador Global de Atajos de Teclado
// ==========================================================================

function setupGlobalShortcuts() {
  window.addEventListener('keydown', (e) => {
    // Si hay un diálogo modal abierto, Escape lo cierra nativamente
    const activeDialog = document.querySelector('dialog[open]');
    if (e.key === 'Escape') {
      if (activeDialog) {
        closeDialog(activeDialog);
        e.preventDefault();
        return;
      }
      if (document.activeElement) {
        document.activeElement.blur();
      }
      return;
    }

    // Detectar si el usuario está tipeando activamente en un input de texto o número
    const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

    // Alt + 1 o P (Global fuera de inputs): Enfocar conversor POV -> RM
    if ((e.altKey && e.key === '1') || (!isTyping && !e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'p' || e.key === 'P'))) {
      e.preventDefault();
      const povInput = document.getElementById('input-pov-tc');
      povInput.focus();
      povInput.select();
      return;
    }

    // Alt + 2 o R (Global fuera de inputs): Enfocar conversor RM -> POV
    if ((e.altKey && e.key === '2') || (!isTyping && !e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'r' || e.key === 'R'))) {
      e.preventDefault();
      const rmInput = document.getElementById('input-rm-ms');
      rmInput.focus();
      rmInput.select();
      return;
    }

    // Alt + N: Nueva Sesión
    if (e.altKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      openNewSessionModal();
      return;
    }

    // Alt + S: Nuevo Sync Point
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      openSyncPointModal(null);
      return;
    }

    // Alt + E: Exportar
    if (e.altKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      exportData();
      return;
    }

    // Alt + I: Importar
    if (e.altKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      document.getElementById('file-import-input').click();
      return;
    }

    // Flechas Arriba / Abajo para alternar Sync Points (cuando no se está en un input de texto)
    if (!isTyping && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      navigateSyncPoints(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
  });
}

/**
 * Navega cíclicamente por los Sync Points de la sesión actual.
 * @param {number} direction -1 para arriba, 1 para abajo
 */
function navigateSyncPoints(direction) {
  const session = getActiveSession();
  if (!session || !session.sync_points || session.sync_points.length <= 1) return;

  const currentIndex = session.sync_points.findIndex(sp => sp.id === session.active_sync_point_id);
  let nextIndex = currentIndex + direction;

  if (nextIndex < 0) nextIndex = session.sync_points.length - 1;
  if (nextIndex >= session.sync_points.length) nextIndex = 0;

  session.active_sync_point_id = session.sync_points[nextIndex].id;
  saveData();
  renderSyncBanner();
  renderSyncPointsTable();
  calculateModeA(false);
  calculateModeB(false);
  showToast(`Ancla activa: ${session.sync_points[nextIndex].name}`);
}

// ==========================================================================
// Lógica de Cálculo de Conversión
// ==========================================================================

/**
 * Modo A: Convierte Timecode POV de DaVinci a milisegundos de ReplayMod.
 * @param {boolean} triggerAutoCopy Si debe copiar al portapapeles y lanzar toast
 */
function calculateModeA(triggerAutoCopy = true) {
  const session = getActiveSession();
  const anchor = getActiveSyncPoint();
  if (!session || !anchor) return;

  const fps = session.fps || 60;
  // Asegurar que el input aplique rollover
  state.numpadPov.commit();
  const povTc = state.numpadPov.getValue();

  const result = povToReplayMod(povTc, anchor.pov_timecode, anchor.rm_time_index, fps);

  // Renderizar resultado
  const msEl = document.getElementById('result-a-ms');
  msEl.textContent = formatNumber(result.ms);
  msEl.dataset.raw = result.ms;

  document.getElementById('result-a-human').textContent = result.humanReadable;

  // Delta tag
  const deltaSign = result.deltaMs >= 0 ? '+' : '';
  const deltaFramesSign = result.deltaFrames >= 0 ? '+' : '';
  document.getElementById('result-a-delta').textContent = `Δ ${deltaSign}${formatNumber(result.deltaMs)} ms (${deltaFramesSign}${result.deltaFrames} frames)`;

  // Badge de advertencia de valor negativo
  const warnEl = document.getElementById('warning-a-negative');
  warnEl.style.display = result.deltaMs < 0 || result.isNegative ? 'inline-flex' : 'none';

  if (triggerAutoCopy && state.config.app.auto_copy) {
    copyToClipboard(result.ms.toString(), `${formatNumber(result.ms)} ms`);
  }
}

/**
 * Modo B: Convierte milisegundos de ReplayMod a Timecode POV de DaVinci.
 * @param {boolean} triggerAutoCopy Si debe copiar al portapapeles y lanzar toast
 */
function calculateModeB(triggerAutoCopy = true) {
  const session = getActiveSession();
  const anchor = getActiveSyncPoint();
  if (!session || !anchor) return;

  const fps = session.fps || 60;
  const rmInputEl = document.getElementById('input-rm-ms');
  const inputMs = parseInt(rmInputEl.value, 10) || 0;

  const result = replayModToPov(inputMs, anchor.pov_timecode, anchor.rm_time_index, fps);

  // Renderizar resultado
  document.getElementById('result-b-tc').textContent = result.timecode;
  document.getElementById('result-b-frames').textContent = `Total: ${formatNumber(result.totalFrames)} frames @ ${fps}fps`;

  // Delta tag
  const deltaFramesSign = result.deltaFrames >= 0 ? '+' : '';
  const deltaMsSign = result.deltaMs >= 0 ? '+' : '';
  document.getElementById('result-b-delta').textContent = `Δ ${deltaFramesSign}${result.deltaFrames} frames (${deltaMsSign}${formatNumber(result.deltaMs)} ms)`;

  // Badge de advertencia de valor negativo
  const warnEl = document.getElementById('warning-b-negative');
  warnEl.style.display = result.deltaMs < 0 || result.isNegative ? 'inline-flex' : 'none';

  if (triggerAutoCopy && state.config.app.auto_copy) {
    copyToClipboard(result.timecode, result.timecode);
  }
}

// ==========================================================================
// Renderizado de UI
// ==========================================================================

function renderAll() {
  renderSessionSelector();
  updateFpsForSession();
  renderSyncBanner();
  renderSyncPointsTable();
  // Sincronizar inputs iniciales con el ancla activa
  const anchor = getActiveSyncPoint();
  if (anchor) {
    state.numpadPov.setTimecode(anchor.pov_timecode);
    document.getElementById('input-rm-ms').value = anchor.rm_time_index;
    document.getElementById('input-rm-preview-inline').textContent = formatReplayModTime(anchor.rm_time_index);
  }
  calculateModeA(false);
  calculateModeB(false);
}

function renderSessionSelector() {
  const select = document.getElementById('session-select');
  select.innerHTML = '';
  state.data.sessions.forEach(sess => {
    const opt = document.createElement('option');
    opt.value = sess.id;
    opt.textContent = `${sess.name} (${sess.fps} fps)`;
    if (sess.id === state.data.active_session_id) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

function updateFpsForSession() {
  const session = getActiveSession();
  const fpsSelect = document.getElementById('fps-select');
  if (session && session.fps) {
    fpsSelect.value = session.fps.toString();
    state.numpadPov.setFps(session.fps);
  }
}

function renderSyncBanner() {
  const session = getActiveSession();
  const spSelect = document.getElementById('sync-point-select');
  spSelect.innerHTML = '';

  if (!session || !session.sync_points || session.sync_points.length === 0) {
    document.getElementById('anchor-pov-display').textContent = '--:--:--:--';
    document.getElementById('anchor-rm-display').textContent = '-- ms';
    document.getElementById('anchor-rm-human').textContent = '--';
    return;
  }

  session.sync_points.forEach(sp => {
    const opt = document.createElement('option');
    opt.value = sp.id;
    opt.textContent = `${sp.name} [${sp.pov_timecode} ⟷ ${formatNumber(sp.rm_time_index)} ms]`;
    if (sp.id === session.active_sync_point_id) {
      opt.selected = true;
    }
    spSelect.appendChild(opt);
  });

  const anchor = getActiveSyncPoint();
  if (anchor) {
    document.getElementById('anchor-pov-display').textContent = anchor.pov_timecode;
    document.getElementById('anchor-rm-display').textContent = `${formatNumber(anchor.rm_time_index)} ms`;
    document.getElementById('anchor-rm-human').textContent = formatReplayModTime(anchor.rm_time_index);
  }
}

function renderSyncPointsTable() {
  const session = getActiveSession();
  const tbody = document.getElementById('sync-points-tbody');
  const badgeCount = document.getElementById('sp-count-badge');
  tbody.innerHTML = '';

  if (!session || !session.sync_points || session.sync_points.length === 0) {
    badgeCount.textContent = '0 puntos';
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">No hay puntos de sincronización en esta sesión.</td></tr>';
    return;
  }

  badgeCount.textContent = `${session.sync_points.length} ${session.sync_points.length === 1 ? 'punto' : 'puntos'}`;

  session.sync_points.forEach(sp => {
    const isActive = sp.id === session.active_sync_point_id;
    const tr = document.createElement('tr');
    if (isActive) tr.classList.add('active-row');

    tr.innerHTML = `
      <td style="text-align: center;">
        <input type="radio" name="active-sp-radio" class="active-radio" ${isActive ? 'checked' : ''} title="Establecer como ancla activa">
      </td>
      <td>
        <span class="sp-row-name">${escapeHtml(sp.name)}</span>
      </td>
      <td class="font-mono">${sp.pov_timecode}</td>
      <td class="font-mono">${formatNumber(sp.rm_time_index)} ms</td>
      <td class="font-mono" style="color: var(--cyan-light); font-size: 0.85rem;">${formatReplayModTime(sp.rm_time_index)}</td>
      <td>
        <div class="sp-row-actions">
          <button class="btn btn-secondary btn-sm btn-icon btn-edit-sp-row" title="Editar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </button>
          <button class="btn btn-danger btn-sm btn-icon btn-del-sp-row" title="Eliminar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </td>
    `;

    // Evento activar al hacer clic en radio o fila
    tr.querySelector('.active-radio').addEventListener('change', () => {
      session.active_sync_point_id = sp.id;
      saveData();
      renderSyncBanner();
      renderSyncPointsTable();
      calculateModeA(false);
      calculateModeB(false);
      showToast(`Ancla activa: ${sp.name}`);
    });

    // Evento editar
    tr.querySelector('.btn-edit-sp-row').addEventListener('click', (e) => {
      e.stopPropagation();
      openSyncPointModal(sp);
    });

    // Evento eliminar
    tr.querySelector('.btn-del-sp-row').addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDeleteSyncPoint(sp.id);
    });

    tbody.appendChild(tr);
  });
}

// ==========================================================================
// Gestión de Modales (Dialogs)
// ==========================================================================

function openDialog(dialog) {
  if (dialog && !dialog.open) {
    dialog.showModal();
  }
}

function closeDialog(dialog) {
  if (dialog && dialog.open) {
    dialog.close();
  }
}

function openNewSessionModal() {
  const modal = document.getElementById('modal-session');
  const now = new Date();
  const dateStr = formatDateForSession(now);
  document.getElementById('session-name-input').value = `${state.config.session.name_prefix}${dateStr}`;
  const currFps = getActiveSession()?.fps || 60;
  document.getElementById('session-fps-input').value = currFps.toString();
  openDialog(modal);
}

function handleCreateSession() {
  const nameInput = document.getElementById('session-name-input').value.trim();
  const fpsInput = parseInt(document.getElementById('session-fps-input').value, 10) || 60;
  if (!nameInput) return;

  const newSessionId = `session_${Date.now()}`;
  const newSpId = `sp_${Date.now()}`;

  const newSession = {
    id: newSessionId,
    name: nameInput,
    created_at: Date.now(),
    fps: fpsInput,
    active_sync_point_id: newSpId,
    sync_points: [
      {
        id: newSpId,
        name: 'Punto de Inicio',
        pov_timecode: state.config.video.timeline_start_timecode,
        rm_time_index: 0,
        is_default: true
      }
    ]
  };

  state.data.sessions.push(newSession);
  state.data.active_session_id = newSessionId;
  saveData();
  closeDialog(document.getElementById('modal-session'));
  renderAll();
  showToast(`Sesión creada: ${nameInput}`);
}

function openSyncPointModal(spToEdit = null) {
  const modal = document.getElementById('modal-syncpoint');
  const title = document.getElementById('modal-syncpoint-title');
  const saveBtn = document.getElementById('btn-save-syncpoint');
  const editId = document.getElementById('sp-edit-id');
  const nameInput = document.getElementById('sp-name-input');
  const tcInput = document.getElementById('sp-tc-input');
  const msInput = document.getElementById('sp-ms-input');
  const preview = document.getElementById('sp-ms-preview');

  if (spToEdit) {
    title.textContent = 'Editar Sync Point';
    saveBtn.textContent = 'Guardar Cambios';
    editId.value = spToEdit.id;
    nameInput.value = spToEdit.name;
    tcInput.value = spToEdit.pov_timecode;
    msInput.value = spToEdit.rm_time_index;
    preview.textContent = formatReplayModTime(spToEdit.rm_time_index);
  } else {
    title.textContent = 'Nuevo Sync Point';
    saveBtn.textContent = 'Crear Punto';
    editId.value = '';
    const session = getActiveSession();
    const count = (session?.sync_points?.length || 0) + 1;
    nameInput.value = `Sync Point ${count}`;
    tcInput.value = state.numpadPov ? state.numpadPov.getValue() : '01:00:00:00';
    const rmVal = document.getElementById('input-rm-ms').value || '1250000';
    msInput.value = rmVal;
    preview.textContent = formatReplayModTime(parseInt(rmVal, 10) || 0);
  }

  openDialog(modal);
}

function handleSaveSyncPoint() {
  const session = getActiveSession();
  if (!session) return;

  const editId = document.getElementById('sp-edit-id').value;
  const name = document.getElementById('sp-name-input').value.trim() || 'Sync Point';
  const rawTc = document.getElementById('sp-tc-input').value.trim();
  const normalizedTc = normalizeTimecode(rawTc, session.fps);
  const ms = parseInt(document.getElementById('sp-ms-input').value, 10) || 0;

  if (editId) {
    // Editar existente
    const sp = session.sync_points.find(p => p.id === editId);
    if (sp) {
      sp.name = name;
      sp.pov_timecode = normalizedTc;
      sp.rm_time_index = ms;
      showToast(`Punto actualizado: ${name}`);
    }
  } else {
    // Crear nuevo
    const newSp = {
      id: `sp_${Date.now()}`,
      name,
      pov_timecode: normalizedTc,
      rm_time_index: ms,
      is_default: false
    };
    session.sync_points.push(newSp);
    session.active_sync_point_id = newSp.id;
    showToast(`Punto creado y activado: ${name}`);
  }

  saveData();
  closeDialog(document.getElementById('modal-syncpoint'));
  renderSyncBanner();
  renderSyncPointsTable();
  calculateModeA(false);
  calculateModeB(false);
}

function confirmDeleteSyncPoint(spId) {
  const session = getActiveSession();
  if (!session) return;

  if (session.sync_points.length <= 1) {
    showToast('⚠️ No puedes eliminar el único Sync Point de la sesión');
    return;
  }

  const sp = session.sync_points.find(p => p.id === spId);
  const confirmModal = document.getElementById('modal-confirm');
  document.getElementById('confirm-message').textContent = `¿Deseas eliminar el punto de sincronización "${sp?.name || spId}"?`;

  state.activeDeleteCallback = () => {
    session.sync_points = session.sync_points.filter(p => p.id !== spId);
    if (session.active_sync_point_id === spId) {
      session.active_sync_point_id = session.sync_points[0].id;
    }
    saveData();
    renderSyncBanner();
    renderSyncPointsTable();
    calculateModeA(false);
    calculateModeB(false);
    showToast('Sync Point eliminado');
  };

  openDialog(confirmModal);
}

// ==========================================================================
// Portapapeles y Notificaciones (Toast)
// ==========================================================================

async function copyToClipboard(text, displayLabel) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Copiado al portapapeles: ${displayLabel}`);
  } catch (err) {
    console.warn('Fallo navigator.clipboard, usando fallback textarea:', err);
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showToast(`Copiado al portapapeles: ${displayLabel}`);
    } catch (e) {
      showToast('Error al copiar al portapapeles');
    }
    document.body.removeChild(textarea);
  }
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span class="toast-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
    </span>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  const duration = state.config.app.toast_duration_ms || 2000;
  setTimeout(() => {
    toast.classList.add('toast-hide');
    setTimeout(() => {
      if (toast.parentNode === container) {
        container.removeChild(toast);
      }
    }, 200);
  }, duration);
}

// ==========================================================================
// Respaldo JSON: Exportar / Importar
// ==========================================================================

function exportData() {
  const exportPayload = {
    ...state.data,
    exported_at: new Date().toISOString(),
    app_version: '1.0.0'
  };

  const jsonStr = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `replaysync_backup_${formatDateForFilename(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Respaldo exportado exitosamente');
}

function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed && Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
        state.data = {
          active_session_id: parsed.active_session_id || parsed.sessions[0].id,
          sessions: parsed.sessions
        };
        saveData();
        renderAll();
        showToast('Datos importados exitosamente');
      } else {
        alert('El archivo JSON importado no tiene una estructura de sesiones válida.');
      }
    } catch (err) {
      alert('Error leyendo archivo JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ==========================================================================
// Utilidades Auxiliares
// ==========================================================================

function formatNumber(num) {
  if (isNaN(num)) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatDateForSession(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${mins}`;
}

function formatDateForFilename(d) {
  return formatDateForSession(d);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
