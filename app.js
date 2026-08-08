(() => {
  'use strict';

  /* ---------------------------------------------------------------
   * Storage & state
   * ------------------------------------------------------------- */
  const STORAGE_KEY = 'bh_state_v1';
  const DAY_NAMES = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const SNOOZE_LIMIT = 3;
  const SNOOZE_MINUTES = 5;
  const HOLD_MS = 1200;

  function uid() {
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function defaultState() {
    const gymId = uid();
    const eatEventId = uid();
    return {
      settings: { muted: false, onboardingSeen: false },
      events: [
        { id: eatEventId, icon: '🍽️', name: 'Acabo de comer', lastTriggeredAt: null }
      ],
      tasks: [
        {
          id: gymId, icon: '💪', name: 'Ir al gimnasio', type: 'fixed',
          time: '18:00', windowStart: '13:00', windowEnd: '15:00',
          eventId: eatEventId, delay: 20,
          days: [1, 2, 3, 4, 5], enforce: true,
          completions: {}, snoozedUntil: null, snoozeCount: {}
        },
        {
          id: uid(), icon: '🦷', name: 'Ponerme el Invisalign', type: 'event',
          time: '08:00', windowStart: '13:00', windowEnd: '15:00',
          eventId: eatEventId, delay: 20,
          days: [0, 1, 2, 3, 4, 5, 6], enforce: true,
          completions: {}, snoozedUntil: null, snoozeCount: {}
        },
        {
          id: uid(), icon: '💧', name: 'Beber un vaso de agua', type: 'window',
          time: '08:00', windowStart: '09:00', windowEnd: '11:00',
          eventId: eatEventId, delay: 20,
          days: [0, 1, 2, 3, 4, 5, 6], enforce: false,
          completions: {}, snoozedUntil: null, snoozeCount: {}
        }
      ]
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed.tasks || !parsed.events) return defaultState();
      return parsed;
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  let state = loadState();

  /* ---------------------------------------------------------------
   * Date/time helpers
   * ------------------------------------------------------------- */
  function pad2(n) { return String(n).padStart(2, '0'); }
  function todayKey(d = new Date()) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function dateKeyDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return todayKey(d);
  }
  function timeStrToMinutes(str) {
    const [h, m] = str.split(':').map(Number);
    return h * 60 + m;
  }
  function fmtHM(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }
  function fmtCountdown(ms) {
    if (ms <= 0) return '0:00';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${pad2(s)}`;
  }
  function isActiveDay(task, date) {
    return task.days.includes(date.getDay());
  }

  /* ---------------------------------------------------------------
   * Task due-state computation
   * ------------------------------------------------------------- */
  function computeDue(task, now) {
    const d = new Date(now);
    if (!isActiveDay(task, d)) return { status: 'inactive' };
    const key = todayKey(d);
    const doneToday = !!task.completions[key];
    const nowMin = d.getHours() * 60 + d.getMinutes();

    if (task.type === 'fixed') {
      const trigMin = timeStrToMinutes(task.time);
      if (doneToday) return { status: 'done' };
      if (nowMin < trigMin) return { status: 'upcoming', label: `Hoy a las ${task.time}` };
      if (task.snoozedUntil && now < task.snoozedUntil) return { status: 'snoozed', until: task.snoozedUntil };
      const trigDate = new Date(d); trigDate.setHours(Math.floor(trigMin / 60), trigMin % 60, 0, 0);
      return { status: 'due', sinceTs: trigDate.getTime() };
    }

    if (task.type === 'window') {
      const startMin = timeStrToMinutes(task.windowStart);
      const endMin = timeStrToMinutes(task.windowEnd);
      if (doneToday) return { status: 'done' };
      if (nowMin < startMin) return { status: 'upcoming', label: `Entre ${task.windowStart} y ${task.windowEnd}` };
      if (task.snoozedUntil && now < task.snoozedUntil) return { status: 'snoozed', until: task.snoozedUntil };
      const startDate = new Date(d); startDate.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
      return { status: 'due', sinceTs: startDate.getTime(), overdue: nowMin > endMin };
    }

    if (task.type === 'event') {
      const ev = state.events.find(e => e.id === task.eventId);
      if (!ev || !ev.lastTriggeredAt) return { status: 'idle', label: `Se activa con "${ev ? ev.name : '?'}"` };
      const dueAt = ev.lastTriggeredAt + task.delay * 60000;
      const doneAfterTrigger = Object.values(task.completions).some(ts => ts >= ev.lastTriggeredAt);
      if (doneAfterTrigger) return { status: 'done' };
      if (now < dueAt) return { status: 'waiting', at: dueAt };
      if (task.snoozedUntil && now < task.snoozedUntil) return { status: 'snoozed', until: task.snoozedUntil };
      return { status: 'due', sinceTs: dueAt };
    }
    return { status: 'inactive' };
  }

  function markComplete(task, ts = Date.now()) {
    task.completions[todayKey(new Date(ts))] = ts;
    task.snoozedUntil = null;
    saveState();
  }

  function toggleQuickComplete(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const key = todayKey();
    if (task.completions[key]) {
      delete task.completions[key];
    } else {
      markComplete(task);
    }
    saveState();
    renderCurrentTab();
  }

  function getDueQueue(now) {
    const list = [];
    for (const t of state.tasks) {
      if (!t.enforce) continue;
      const info = computeDue(t, now);
      if (info.status === 'due') list.push({ task: t, info });
    }
    list.sort((a, b) => a.info.sinceTs - b.info.sinceTs);
    return list;
  }

  /* ---------------------------------------------------------------
   * Streaks / stats
   * ------------------------------------------------------------- */
  function streakFor(task) {
    let streak = 0;
    const d = new Date();
    for (let i = 0; i < 365; i++) {
      const key = todayKey(d);
      const active = isActiveDay(task, d);
      if (active) {
        if (task.completions[key]) {
          streak++;
        } else if (i === 0) {
          // today, not completed yet: don't break the streak, just don't count it
        } else {
          break;
        }
      }
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function weekCompletion(task) {
    const arr = [];
    for (let i = 6; i >= 0; i--) {
      const key = dateKeyDaysAgo(i);
      const d = new Date();
      d.setDate(d.getDate() - i);
      arr.push({ key, active: isActiveDay(task, d), done: !!task.completions[key] });
    }
    return arr;
  }

  /* ---------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------- */
  const tabContent = document.getElementById('tabContent');
  let currentTab = 'hoy';

  function typeLabel(task) {
    if (task.type === 'fixed') return `⏰ ${task.time}`;
    if (task.type === 'window') return `🕒 ${task.windowStart}–${task.windowEnd}`;
    if (task.type === 'event') {
      const ev = state.events.find(e => e.id === task.eventId);
      return `⚡ ${task.delay} min tras "${ev ? ev.name : '?'}"`;
    }
    return '';
  }

  function daysLabel(task) {
    if (task.days.length === 7) return 'Todos los días';
    return task.days.slice().sort((a,b)=>{
      const order = [1,2,3,4,5,6,0];
      return order.indexOf(a) - order.indexOf(b);
    }).map(d => DAY_NAMES[d]).join(' ');
  }

  function badgeForStatus(info) {
    switch (info.status) {
      case 'due': return `<span class="badge due">${info.overdue ? 'Atrasada' : 'PENDIENTE AHORA'}</span>`;
      case 'snoozed': return `<span class="badge due">Pospuesta</span>`;
      case 'done': return `<span class="badge done">Hecha ✓</span>`;
      case 'waiting': return `<span class="badge">En ${fmtCountdown(info.at - Date.now())}</span>`;
      case 'upcoming': return `<span class="badge">${info.label}</span>`;
      case 'idle': return `<span class="badge">Esperando evento</span>`;
      default: return `<span class="badge">Inactiva hoy</span>`;
    }
  }

  function renderHoy() {
    const now = Date.now();
    const rows = state.tasks.map(t => ({ t, info: computeDue(t, now) }));

    let html = '';
    if (!state.settings.onboardingSeen) {
      html += `
        <div class="note-box" id="onboardingNote">
          💡 <strong>Esto es un prototipo web</strong> para probar el concepto. Bloquea la
          pantalla dentro del navegador, pero no puede impedir cambiar de app o apagar el móvil
          como sí lograría una app nativa de Android. Úsalo para validar la idea antes de construir
          la versión real. <button class="btn-link" id="dismissOnboarding" style="margin-left:4px;">Entendido</button>
        </div>`;
    }

    html += `<div class="section-title">Hoy · ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</div>`;

    if (rows.length === 0) {
      html += `<div class="empty-hint">Aún no tienes tareas. Ve a la pestaña "Tareas" para crear tu primera alarma.</div>`;
    } else {
      html += `<div class="card">`;
      rows
        .sort((a, b) => (a.info.status === 'due' ? -1 : 1) - (b.info.status === 'due' ? -1 : 1))
        .forEach(({ t, info }) => {
          const doneToday = !!t.completions[todayKey()];
          html += `
          <div class="task-row">
            <div class="task-emoji">${t.icon}</div>
            <div class="task-main">
              <div class="task-name">${escapeHtml(t.name)}</div>
              <div class="task-meta">${typeLabel(t)} · ${daysLabel(t)}</div>
              <div class="task-badges">
                ${badgeForStatus(info)}
                ${t.enforce ? '<span class="badge enforce">🔒 Bloquea</span>' : ''}
              </div>
            </div>
            <div class="task-actions">
              <button class="chip-btn ${doneToday ? 'primary' : ''}" data-action="quick-toggle" data-id="${t.id}" title="Marcar hecho">${doneToday ? '✓' : '☐'}</button>
            </div>
          </div>`;
        });
      html += `</div>`;
    }

    tabContent.innerHTML = html;

    const dismiss = document.getElementById('dismissOnboarding');
    if (dismiss) dismiss.addEventListener('click', () => {
      state.settings.onboardingSeen = true;
      saveState();
      renderCurrentTab();
    });
    tabContent.querySelectorAll('[data-action="quick-toggle"]').forEach(btn => {
      btn.addEventListener('click', () => toggleQuickComplete(btn.dataset.id));
    });
  }

  function renderTareas() {
    let html = `<div class="section-title">Tus tareas</div>`;
    if (state.tasks.length === 0) {
      html += `<div class="empty-hint">No hay tareas todavía.</div>`;
    } else {
      html += `<div class="card">`;
      state.tasks.forEach(t => {
        const streak = streakFor(t);
        html += `
        <div class="task-row" data-action="edit-task" data-id="${t.id}" style="cursor:pointer;">
          <div class="task-emoji">${t.icon}</div>
          <div class="task-main">
            <div class="task-name">${escapeHtml(t.name)}</div>
            <div class="task-meta">${typeLabel(t)} · ${daysLabel(t)}</div>
            <div class="task-badges">
              ${t.enforce ? '<span class="badge enforce">🔒 Bloquea</span>' : '<span class="badge">🔔 Solo recuerda</span>'}
              ${streak > 0 ? `<span class="streak-pill">🔥 ${streak}</span>` : ''}
            </div>
          </div>
          <div class="task-actions">
            <button class="chip-btn" data-action="edit-task" data-id="${t.id}">✏️</button>
          </div>
        </div>`;
      });
      html += `</div>`;
    }
    html += `<button class="btn btn-primary fab" id="btnNewTask">+ Nueva tarea</button>`;
    tabContent.innerHTML = html;

    tabContent.querySelectorAll('[data-action="edit-task"]').forEach(el => {
      el.addEventListener('click', () => openTaskModal(el.dataset.id));
    });
    document.getElementById('btnNewTask').addEventListener('click', () => openTaskModal(null));
  }

  function renderEventos() {
    let html = `<div class="section-title">Eventos</div>
      <div class="note-box">Un evento es algo que ocurre a una hora que no sabes de antemano
      (como "comer"). Púlsalo en el momento y las tareas vinculadas se activarán X minutos después.</div>`;

    state.events.forEach(ev => {
      const linked = state.tasks.filter(t => t.type === 'event' && t.eventId === ev.id);
      const lastStr = ev.lastTriggeredAt
        ? `Última vez: hoy a las ${fmtHM(new Date(ev.lastTriggeredAt))}`
        : 'Todavía no lo has marcado hoy';
      html += `
        <div class="card event-card">
          <button class="event-tap" data-action="trigger-event" data-id="${ev.id}">
            <span style="font-size:1.4rem;">${ev.icon}</span>
            <span>
              ${escapeHtml(ev.name)}
              <div class="event-last">${lastStr}${linked.length ? ` · ${linked.length} tarea(s) vinculada(s)` : ''}</div>
            </span>
          </button>
        </div>`;
    });

    html += `<button class="btn btn-primary fab" id="btnNewEvent">+ Nuevo evento</button>`;
    tabContent.innerHTML = html;

    tabContent.querySelectorAll('[data-action="trigger-event"]').forEach(btn => {
      btn.addEventListener('click', () => triggerEvent(btn.dataset.id));
    });
    document.getElementById('btnNewEvent').addEventListener('click', () => openEventModal());
  }

  function renderProgreso() {
    const totalCompletionsWeek = state.tasks.reduce((sum, t) => {
      return sum + weekCompletion(t).filter(d => d.done).length;
    }, 0);
    const bestStreak = state.tasks.reduce((max, t) => Math.max(max, streakFor(t)), 0);
    const activeTasks = state.tasks.length;

    let html = `<div class="section-title">Tu progreso</div>
      <div class="stat-grid">
        <div class="stat-box"><div class="stat-num">${totalCompletionsWeek}</div><div class="stat-label">Hechas esta semana</div></div>
        <div class="stat-box"><div class="stat-num">🔥${bestStreak}</div><div class="stat-label">Mejor racha</div></div>
        <div class="stat-box"><div class="stat-num">${activeTasks}</div><div class="stat-label">Tareas activas</div></div>
      </div>
      <div class="section-title">Últimos 7 días</div>
      <div class="card">`;

    if (state.tasks.length === 0) {
      html += `<div class="empty-hint">Crea tareas para ver tu progreso aquí.</div>`;
    } else {
      state.tasks.forEach(t => {
        const week = weekCompletion(t);
        const doneCount = week.filter(d => d.done).length;
        const activeCount = week.filter(d => d.active).length || 1;
        const pct = Math.round((doneCount / activeCount) * 100);
        html += `
          <div class="bar-row">
            <div class="bar-label">${t.icon} ${escapeHtml(truncate(t.name, 10))}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
            <div class="bar-val">${doneCount}/${activeCount}</div>
          </div>`;
      });
    }
    html += `</div>`;
    tabContent.innerHTML = html;
  }

  function truncate(str, n) { return str.length > n ? str.slice(0, n - 1) + '…' : str; }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  }

  function renderCurrentTab() {
    if (currentTab === 'hoy') renderHoy();
    else if (currentTab === 'tareas') renderTareas();
    else if (currentTab === 'eventos') renderEventos();
    else if (currentTab === 'progreso') renderProgreso();
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      renderCurrentTab();
    });
  });

  /* ---------------------------------------------------------------
   * Event trigger
   * ------------------------------------------------------------- */
  function triggerEvent(eventId) {
    const ev = state.events.find(e => e.id === eventId);
    if (!ev) return;
    ev.lastTriggeredAt = Date.now();
    saveState();
    renderCurrentTab();
    showToast(`"${ev.name}" registrado a las ${fmtHM(new Date())}`);
    tick();
  }

  /* ---------------------------------------------------------------
   * Task modal (add/edit)
   * ------------------------------------------------------------- */
  const modalOverlay = document.getElementById('modalOverlay');
  const taskForm = document.getElementById('taskForm');
  const taskType = document.getElementById('taskType');
  const fieldsFixed = document.getElementById('fieldsFixed');
  const fieldsWindow = document.getElementById('fieldsWindow');
  const fieldsEvent = document.getElementById('fieldsEvent');
  const taskEventId = document.getElementById('taskEventId');
  const taskDeleteBtn = document.getElementById('taskDelete');
  let selectedDays = new Set([0, 1, 2, 3, 4, 5, 6]);

  function refreshTypeFields() {
    const v = taskType.value;
    fieldsFixed.classList.toggle('hidden', v !== 'fixed');
    fieldsWindow.classList.toggle('hidden', v !== 'window');
    fieldsEvent.classList.toggle('hidden', v !== 'event');
  }
  taskType.addEventListener('change', refreshTypeFields);

  document.getElementById('daysRow').addEventListener('click', (e) => {
    const chip = e.target.closest('.day-chip');
    if (!chip) return;
    const d = Number(chip.dataset.day);
    if (selectedDays.has(d)) selectedDays.delete(d); else selectedDays.add(d);
    chip.classList.toggle('active');
  });

  function populateEventSelect() {
    taskEventId.innerHTML = state.events.map(e => `<option value="${e.id}">${e.icon} ${escapeHtml(e.name)}</option>`).join('');
  }

  function openTaskModal(taskId) {
    populateEventSelect();
    const task = taskId ? state.tasks.find(t => t.id === taskId) : null;
    document.getElementById('modalTitle').textContent = task ? 'Editar tarea' : 'Nueva tarea';
    document.getElementById('taskId').value = task ? task.id : '';
    document.getElementById('taskIcon').value = task ? task.icon : '✅';
    document.getElementById('taskName').value = task ? task.name : '';
    taskType.value = task ? task.type : 'fixed';
    document.getElementById('taskTime').value = task ? task.time : '08:00';
    document.getElementById('taskWindowStart').value = task ? task.windowStart : '13:00';
    document.getElementById('taskWindowEnd').value = task ? task.windowEnd : '15:00';
    document.getElementById('taskDelay').value = task ? task.delay : 20;
    if (task && task.eventId) taskEventId.value = task.eventId;
    document.getElementById('taskEnforce').checked = task ? task.enforce : true;
    taskDeleteBtn.classList.toggle('hidden', !task);

    selectedDays = new Set(task ? task.days : [0, 1, 2, 3, 4, 5, 6]);
    document.querySelectorAll('#daysRow .day-chip').forEach(chip => {
      chip.classList.toggle('active', selectedDays.has(Number(chip.dataset.day)));
    });

    refreshTypeFields();
    modalOverlay.classList.remove('hidden');
  }

  function closeTaskModal() { modalOverlay.classList.add('hidden'); }
  document.getElementById('modalClose').addEventListener('click', closeTaskModal);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeTaskModal(); });

  taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('taskId').value;
    if (selectedDays.size === 0) { showToast('Selecciona al menos un día'); return; }
    const data = {
      icon: document.getElementById('taskIcon').value.trim() || '✅',
      name: document.getElementById('taskName').value.trim(),
      type: taskType.value,
      time: document.getElementById('taskTime').value,
      windowStart: document.getElementById('taskWindowStart').value,
      windowEnd: document.getElementById('taskWindowEnd').value,
      eventId: taskEventId.value,
      delay: Number(document.getElementById('taskDelay').value) || 0,
      days: Array.from(selectedDays),
      enforce: document.getElementById('taskEnforce').checked
    };
    if (!data.name) return;

    if (id) {
      const task = state.tasks.find(t => t.id === id);
      Object.assign(task, data);
    } else {
      state.tasks.push({ id: uid(), completions: {}, snoozedUntil: null, snoozeCount: {}, ...data });
    }
    saveState();
    closeTaskModal();
    renderCurrentTab();
  });

  taskDeleteBtn.addEventListener('click', () => {
    const id = document.getElementById('taskId').value;
    if (!id) return;
    if (!confirm('¿Eliminar esta tarea?')) return;
    state.tasks = state.tasks.filter(t => t.id !== id);
    saveState();
    closeTaskModal();
    renderCurrentTab();
  });

  /* ---------------------------------------------------------------
   * Event modal (add)
   * ------------------------------------------------------------- */
  const eventModalOverlay = document.getElementById('eventModalOverlay');
  const eventForm = document.getElementById('eventForm');
  function openEventModal() {
    document.getElementById('eventIcon').value = '⚡';
    document.getElementById('eventName').value = '';
    eventModalOverlay.classList.remove('hidden');
  }
  function closeEventModal() { eventModalOverlay.classList.add('hidden'); }
  document.getElementById('eventModalClose').addEventListener('click', closeEventModal);
  eventModalOverlay.addEventListener('click', (e) => { if (e.target === eventModalOverlay) closeEventModal(); });
  eventForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('eventName').value.trim();
    if (!name) return;
    state.events.push({
      id: uid(),
      icon: document.getElementById('eventIcon').value.trim() || '⚡',
      name,
      lastTriggeredAt: null
    });
    saveState();
    closeEventModal();
    renderCurrentTab();
  });

  /* ---------------------------------------------------------------
   * Toast
   * ------------------------------------------------------------- */
  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  /* ---------------------------------------------------------------
   * Lock screen
   * ------------------------------------------------------------- */
  const lockScreen = document.getElementById('lockScreen');
  const lockIcon = document.getElementById('lockIcon');
  const lockTaskName = document.getElementById('lockTaskName');
  const lockSubtitle = document.getElementById('lockSubtitle');
  const lockTimer = document.getElementById('lockTimer');
  const lockQueueEl = document.getElementById('lockQueue');
  const btnComplete = document.getElementById('btnComplete');
  const btnCompleteFill = document.getElementById('btnCompleteFill');
  const btnSnooze = document.getElementById('btnSnooze');
  const btnMute = document.getElementById('btnMute');
  const snoozeInfo = document.getElementById('snoozeInfo');
  const lockWarning = document.getElementById('lockWarning');

  let lockedTaskId = null;
  let escapeAttempts = 0;

  function isLockOpen() { return !lockScreen.classList.contains('hidden'); }

  function openLock(task) {
    lockedTaskId = task.id;
    lockIcon.textContent = task.icon;
    lockTaskName.textContent = task.name;
    lockSubtitle.textContent = task.type === 'event'
      ? 'Ha pasado el tiempo previsto tras el evento. Complétala para poder seguir usando el móvil.'
      : 'Es la hora. Complétala para poder seguir usando el móvil.';
    lockWarning.textContent = '';
    escapeAttempts = 0;
    updateSnoozeUI(task);
    lockScreen.classList.remove('hidden');
    tryEnterFullscreen();
    startAlarmSound();
  }

  function closeLock() {
    lockedTaskId = null;
    lockScreen.classList.add('hidden');
    stopAlarmSound();
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  function updateSnoozeUI(task) {
    const used = task.snoozeCount[todayKey()] || 0;
    const remaining = SNOOZE_LIMIT - used;
    btnSnooze.style.display = remaining > 0 ? 'inline' : 'none';
    snoozeInfo.textContent = remaining > 0
      ? `Te quedan ${remaining} aplazamiento(s) de ${SNOOZE_MINUTES} min hoy.`
      : 'Ya no puedes posponer más esta tarea hoy.';
  }

  function updateLockScreenLive() {
    if (!lockedTaskId) return;
    const task = state.tasks.find(t => t.id === lockedTaskId);
    if (!task) { closeLock(); return; }
    const now = Date.now();
    const info = computeDue(task, now);
    if (info.status === 'due' && info.sinceTs) {
      lockTimer.textContent = `Llevas ${fmtCountdown(now - info.sinceTs)} esperando`;
    } else {
      lockTimer.textContent = '';
    }
    const queue = getDueQueue(now);
    if (queue.length > 1) {
      lockQueueEl.textContent = `+ ${queue.length - 1} tarea(s) más pendientes después de esta`;
    } else {
      lockQueueEl.textContent = '';
    }
  }

  function refreshLockDriver() {
    const now = Date.now();
    const queue = getDueQueue(now);

    if (queue.length === 0) {
      if (isLockOpen()) closeLock();
      return;
    }
    const top = queue[0].task;
    if (!isLockOpen()) {
      openLock(top);
    } else if (lockedTaskId !== top.id) {
      // current locked task got resolved/snoozed, move to next
      lockIcon.textContent = top.icon;
      lockTaskName.textContent = top.name;
      lockedTaskId = top.id;
      updateSnoozeUI(top);
    }
    updateLockScreenLive();
  }

  function completeLockedTask() {
    if (!lockedTaskId) return;
    const task = state.tasks.find(t => t.id === lockedTaskId);
    if (!task) return;
    markComplete(task);
    showToast(`"${task.name}" completada ✅`);
    resetHoldFill();
    refreshLockDriver();
    renderCurrentTab();
  }

  function snoozeLockedTask() {
    if (!lockedTaskId) return;
    const task = state.tasks.find(t => t.id === lockedTaskId);
    if (!task) return;
    const key = todayKey();
    const used = task.snoozeCount[key] || 0;
    if (used >= SNOOZE_LIMIT) return;
    task.snoozeCount[key] = used + 1;
    task.snoozedUntil = Date.now() + SNOOZE_MINUTES * 60000;
    saveState();
    refreshLockDriver();
    renderCurrentTab();
  }

  btnSnooze.addEventListener('click', snoozeLockedTask);
  btnMute.addEventListener('click', () => {
    state.settings.muted = !state.settings.muted;
    btnMute.textContent = state.settings.muted ? '🔇 Activar sonido' : '🔊 Silenciar';
    saveState();
    if (state.settings.muted) stopAlarmSound(); else startAlarmSound();
  });

  /* ---- hold-to-complete button ---- */
  let holdRAF = null, holdStart = null;
  function startHold() {
    if (holdRAF) return;
    btnComplete.classList.add('filling');
    holdStart = performance.now();
    const step = (t) => {
      const elapsed = t - holdStart;
      const pct = Math.min(100, (elapsed / HOLD_MS) * 100);
      btnCompleteFill.style.width = pct + '%';
      if (pct >= 100) {
        resetHoldFill();
        completeLockedTask();
        return;
      }
      holdRAF = requestAnimationFrame(step);
    };
    holdRAF = requestAnimationFrame(step);
  }
  function resetHoldFill() {
    if (holdRAF) cancelAnimationFrame(holdRAF);
    holdRAF = null;
    btnCompleteFill.style.width = '0%';
    btnComplete.classList.remove('filling');
  }
  ['pointerdown'].forEach(ev => btnComplete.addEventListener(ev, (e) => { e.preventDefault(); startHold(); }));
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btnComplete.addEventListener(ev, resetHoldFill));

  /* ---- fullscreen ---- */
  function tryEnterFullscreen() {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    }
  }
  document.body.addEventListener('click', tryEnterFullscreen, { once: true });

  /* ---- visibility nag ---- */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && lockedTaskId) {
      escapeAttempts++;
      lockWarning.textContent = escapeAttempts === 1
        ? 'Has vuelto a la app. La tarea sigue pendiente.'
        : `Sigues sin completarla (intento #${escapeAttempts} de salir).`;
      if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
      tryEnterFullscreen();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (lockedTaskId) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ---- alarm sound ---- */
  let audioCtx = null;
  let alarmInterval = null;
  function beep() {
    if (state.settings.muted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.value = 0.05;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.18);
    } catch (e) { /* audio not available yet, ignore */ }
  }
  function startAlarmSound() {
    stopAlarmSound();
    beep();
    alarmInterval = setInterval(beep, 900);
  }
  function stopAlarmSound() {
    if (alarmInterval) clearInterval(alarmInterval);
    alarmInterval = null;
  }

  /* ---------------------------------------------------------------
   * Main loop
   * ------------------------------------------------------------- */
  const clockNow = document.getElementById('clockNow');
  function tick() {
    clockNow.textContent = fmtHM(new Date());
    refreshLockDriver();
  }

  let renderCounter = 0;
  setInterval(() => {
    tick();
    renderCounter++;
    if (renderCounter % 2 === 0) renderCurrentTab();
  }, 1000);

  /* ---------------------------------------------------------------
   * Init
   * ------------------------------------------------------------- */
  btnMute.textContent = state.settings.muted ? '🔇 Activar sonido' : '🔊 Silenciar';
  renderCurrentTab();
  tick();
})();
