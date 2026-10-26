(function () {
  if (document.body.dataset.page === 'assistant') return;

  const MASCOT_SRC = '/js/assistant-mascot.js?v=3';
  const CORE_SRC = '/js/assistant-core.js?v=18';
  const QUIET_KEY = 'ai-dot-quiet';

  // Invitación según la página; después rota con las generales.
  const PAGE_INVITES = {
    overview: '¿Te doy el resumen del día?',
    inventory: '¿Te ayudo con el inventario?',
    sales: '¿Revisamos las ventas del mes?',
    'post-sales': '¿Te ayudo con taller y refacciones?',
    contabilidad: '¿Analizamos los estados financieros?',
    forecast: '¿Vemos el pronóstico de cierre?',
    seguimiento: '¿Busco el historial de un cliente?',
    'lista-precios': '¿Comparamos precios y planes?',
  };
  const GENERAL_INVITES = [
    '¡Hola! Soy Balvo, tu analista de Balderrama',
    'Pregúntame por modelos o KPIs',
    'Consulto ventas, inventario y EEFF por ti',
  ];
  const page = String(document.body.dataset.page || 'overview').toLowerCase();
  const INVITES = [PAGE_INVITES[page] || PAGE_INVITES.overview, ...GENERAL_INVITES];

  const FIRST_INVITE_MS = 2600;
  const INVITE_EVERY_MS = 38000;
  const INVITE_VISIBLE_MS = 7000;

  const backdrop = document.createElement('div');
  backdrop.className = 'ai-chat-backdrop';
  backdrop.id = 'aiChatBackdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = 'ai-chat-panel';
  panel.id = 'aiChatPanel';
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Balvo, asistente IA');
  panel.innerHTML = `
    <div class="balvo-top">
      <button type="button" class="balvo-top__btn" data-ai="clear" title="Nueva conversación" aria-label="Nueva conversación">
        <span class="material-symbols-outlined">edit_square</span>
      </button>
      <div class="balvo-top__pill">
        <span class="balvo-orb balvo-orb--dot" aria-hidden="true"></span>
        <span class="balvo-top__name">Balvo</span>
        <span class="balvo-source" data-ai="source" data-mode="cloud" title="Nube" aria-label="Conectado a la nube"></span>
        <span class="balvo-top__status" data-ai="status">Verificando…</span>
      </div>
      <div class="balvo-top__end">
        <button type="button" class="balvo-top__btn balvo-top__btn--chat" data-ai="expand" title="Ampliar gráficas" aria-label="Ampliar gráficas">
          <span class="material-symbols-outlined" data-ai="expand-icon">open_in_full</span>
        </button>
        <button type="button" class="balvo-top__btn" id="aiChatClose" title="Cerrar" aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
    <section class="balvo-voice" data-balvo="voice" data-state="idle">
      <div class="balvo-voice__stage">
        <div class="balvo-orb balvo-orb--xl" aria-hidden="true"><span class="balvo-orb__grain"></span></div>
        <button type="button" class="balvo-voice__call" data-balvo="call" aria-label="Hablar con Balvo">
          <span class="material-symbols-outlined" data-balvo="call-icon">call</span>
        </button>
      </div>
      <p class="balvo-voice__caption" data-balvo="caption">Toca para hablar con Balvo</p>
      <button type="button" class="balvo-voice__more" data-balvo="see-chat" hidden>Ver la respuesta completa</button>
    </section>
    <div class="ai-chat-panel__main">
      <div class="ai-chat-panel__chat">
        <div class="ai-chat-panel__body custom-scrollbar">
          <div class="assistant-chat ai-chat-panel__messages" data-ai="messages"></div>
          <div class="ai-chat-panel__prompts" data-ai="prompts"></div>
        </div>
        <form class="ai-chat-panel__composer" data-ai="form">
          <div class="ai-chat-panel__composer-box">
            <button type="button" data-ai="mic" class="ai-chat-panel__mic" title="Dictar" aria-label="Dictar pregunta" aria-pressed="false">
              <span class="material-symbols-outlined">mic</span>
            </button>
            <textarea data-ai="input" class="assistant-input ai-chat-panel__input" rows="1"
              placeholder="Escribe un mensaje…" maxlength="4000" aria-label="Escribe un mensaje"></textarea>
            <button type="submit" data-ai="send" class="ai-chat-panel__send" disabled aria-label="Enviar">
              <span class="material-symbols-outlined">send</span>
            </button>
          </div>
        </form>
      </div>
      <aside class="ai-chat-panel__viz custom-scrollbar" data-ai="viz" hidden></aside>
    </div>
    <nav class="balvo-modes" aria-label="Modo de Balvo">
      <button type="button" class="balvo-modes__btn" data-balvo-mode="voice">Voz</button>
      <button type="button" class="balvo-modes__btn" data-balvo-mode="chat">Chat</button>
    </nav>
  `;

  const bubble = document.createElement('div');
  bubble.className = 'ai-fab';
  bubble.innerHTML = `
    <div class="ai-fab__tooltip ai-fab__tooltip--hidden" id="aiFabTooltip" role="status" aria-live="polite">
      <button type="button" class="ai-fab__tooltip-close" id="aiFabTooltipClose" aria-label="Ocultar invitaciones">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
      <span class="ai-fab__tooltip-kicker"><span class="ai-fab__tooltip-dot"></span>Balvo · Asistente IA</span>
      <span class="ai-fab__tooltip-text" id="aiFabTooltipText">${INVITES[0]}</span>
    </div>
    <div class="ai-fab__trigger">
      <button type="button" class="ai-fab__btn" id="aiFabBtn" aria-label="Abrir a Balvo, asistente IA" aria-expanded="false" aria-controls="aiChatPanel">
        <span class="ai-fab__mascot" data-mascot="fab"></span>
      </button>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);
  document.body.appendChild(bubble);

  const btn = document.getElementById('aiFabBtn');
  const closeBtn = document.getElementById('aiChatClose');
  const expandBtn = panel.querySelector('[data-ai="expand"]');
  const expandIcon = panel.querySelector('[data-ai="expand-icon"]');
  const tooltip = document.getElementById('aiFabTooltip');
  const tooltipText = document.getElementById('aiFabTooltipText');
  const tooltipClose = document.getElementById('aiFabTooltipClose');
  const fabMascotHost = bubble.querySelector('[data-mascot="fab"]');
  const panelMascotHost = panel.querySelector('[data-mascot="panel"]');
  const voiceStage = panel.querySelector('[data-balvo="voice"]');
  const callBtn = panel.querySelector('[data-balvo="call"]');
  const callIcon = panel.querySelector('[data-balvo="call-icon"]');
  const caption = panel.querySelector('[data-balvo="caption"]');
  const seeChatBtn = panel.querySelector('[data-balvo="see-chat"]');
  const modeBtns = [...panel.querySelectorAll('[data-balvo-mode]')];
  const MODE_KEY = 'balvo-mode';
  const IDLE_CAPTION = 'Toca para hablar con Balvo';
  let mode = 'voice';
  try { mode = localStorage.getItem(MODE_KEY) === 'chat' ? 'chat' : 'voice'; } catch { /* sin storage */ }
  let voiceState = 'idle';

  let inviteIndex = 0;
  let inviteTimer = null;
  let inviteHideTimer = null;
  let chatApi = null;
  let panelOpen = false;
  let expanded = false;
  let removed = false;
  let fabMascot = null;
  let panelMascot = null;
  let quiet = false;
  try { quiet = sessionStorage.getItem(QUIET_KEY) === '1'; } catch { /* sin storage */ }

  function loadScript(src, globalName) {
    if (window[globalName]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  const mascotReady = loadScript(MASCOT_SRC, 'AssistantMascot')
    .then(() => {
      if (removed || !window.AssistantMascot) return;
      fabMascot = window.AssistantMascot.create(fabMascotHost, { size: 72 });
      if (panelMascotHost) panelMascot = window.AssistantMascot.create(panelMascotHost, { size: 56, active: false });
    })
    .catch(() => {});

  function eachMascot(fn) {
    if (fabMascot) fn(fabMascot);
    if (panelMascot) fn(panelMascot);
  }

  function loadCoreScript() {
    return mascotReady.then(() => loadScript(CORE_SRC, 'AssistantChat'));
  }

  function initChat() {
    if (chatApi) return chatApi;
    chatApi = window.AssistantChat.init({
      root: panel,
      getExpanded: () => expanded,
      onLoading: (on) => {
        panel.classList.toggle('ai-chat-panel--thinking', on);
        bubble.classList.toggle('ai-fab--thinking', on);
        eachMascot((m) => m.setMood(on ? 'thinking' : 'idle'));
      },
      onReply: ({ ok, reply, hasBlocks }) => {
        eachMascot((m) => m.react(ok ? 'celebrate' : 'oops'));
        if (mode === 'voice' && reply) {
          const short = String(reply).replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
          caption.textContent = short.length > 180 ? `${short.slice(0, 180)}…` : short;
          seeChatBtn.hidden = !(hasBlocks || short.length > 180);
        }
        // Si cerraron el panel mientras pensaba, Balvo avisa que ya está la respuesta.
        if (!panelOpen && ok) showInvite('¡Listo! Ya tengo tu respuesta', { force: true });
      },
      onVoiceState: setVoiceState,
      onVoiceTranscript: (text) => {
        if (text) caption.textContent = `“${text}”`;
      },
      onVoiceError: (message) => {
        caption.textContent = message;
      },
    });
    return chatApi;
  }

  function setVoiceState(state) {
    voiceState = state;
    voiceStage.dataset.state = state;
    panel.dataset.voice = state;
    const active = state === 'listening' || state === 'thinking' || state === 'speaking';
    callIcon.textContent = active ? 'call_end' : 'call';
    callBtn.setAttribute('aria-label', active ? 'Terminar' : 'Hablar con Balvo');
    if (state === 'listening') {
      caption.textContent = 'Te escucho…';
      seeChatBtn.hidden = true;
    } else if (state === 'thinking') {
      caption.textContent = 'Consultando…';
    } else if (state === 'unsupported') {
      caption.textContent = 'Este equipo no permite dictado. Usa el modo Chat.';
    }
  }

  function setMode(next) {
    mode = next === 'chat' ? 'chat' : 'voice';
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* sin storage */ }
    panel.dataset.mode = mode;
    modeBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.balvoMode === mode));
    if (mode === 'voice') {
      if (expanded) setExpanded(false);
      if (voiceState === 'idle') caption.textContent = IDLE_CAPTION;
    } else if (panelOpen) {
      loadCoreScript().then(() => {
        const api = initChat();
        api?.refresh?.();
        api?.scrollToBottom?.();
        api?.focus();
      });
    }
  }

  setMode(mode);

  function updateExpandUi() {
    panel.classList.toggle('ai-chat-panel--expanded', expanded);
    document.body.classList.toggle('ai-chat-expanded', expanded);
    const showBackdrop = expanded || panelOpen;
    backdrop.classList.toggle('ai-chat-backdrop--visible', showBackdrop);
    backdrop.setAttribute('aria-hidden', showBackdrop ? 'false' : 'true');

    if (expandIcon) {
      expandIcon.textContent = expanded ? 'close_fullscreen' : 'open_in_full';
    }
    if (expandBtn) {
      expandBtn.title = expanded ? 'Reducir' : 'Ampliar gráficas';
      expandBtn.setAttribute('aria-label', expanded ? 'Reducir' : 'Ampliar gráficas');
    }
  }

  function setExpanded(state) {
    expanded = Boolean(state);
    updateExpandUi();
    chatApi?.refresh?.();
  }

  function toggleExpanded() {
    setExpanded(!expanded);
  }

  const sourceDot = panel.querySelector('[data-ai="source"]');

  function paintSource(mode) {
    const sql = mode === 'sql';
    if (!sourceDot) return;
    sourceDot.dataset.mode = sql ? 'sql' : 'cloud';
    sourceDot.title = sql ? 'SQL Server' : 'Nube';
    sourceDot.setAttribute('aria-label', sql ? 'Conectado a SQL Server' : 'Conectado a la nube');
  }

  function refreshSource() {
    fetch('/api/data-source', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => paintSource(data?.mode))
      .catch(() => {});
  }

  function openPanel(options = {}) {
    const prompt = typeof options === 'string' ? options : options?.prompt;
    const autoSend = typeof options === 'string' ? true : options?.autoSend !== false;

    panelOpen = true;
    refreshSource();
    panel.classList.add('ai-chat-panel--open');
    backdrop.classList.add('ai-chat-backdrop--visible');
    backdrop.setAttribute('aria-hidden', 'false');
    panel.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('ai-chat-open');
    hideInvite();
    panelMascot?.setActive(true);
    setTimeout(() => panelMascot?.react('wave'), 250);
    if (prompt) setMode('chat');
    loadCoreScript().then(() => {
      panelMascot?.setActive(true);
      const api = initChat();
      if (mode === 'chat') api?.focus();
      api?.scrollToBottom?.();
      // Renueva sugerencias al abrir si el chat está vacío
      const hasMessages = Boolean(panel.querySelector('.assistant-msg--user'));
      if (!hasMessages) api?.refreshSuggestions?.();
      if (prompt && autoSend) {
        api?.sendMessage?.(String(prompt));
      } else if (prompt) {
        const input = panel.querySelector('[data-ai="input"]');
        if (input) {
          input.value = String(prompt);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        }
      }
    });
  }

  function closePanel() {
    chatApi?.stopVoice?.();
    setExpanded(false);
    panelOpen = false;
    panel.classList.remove('ai-chat-panel--open');
    if (!expanded) {
      backdrop.classList.remove('ai-chat-backdrop--visible');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    panel.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('ai-chat-open');
    panelMascot?.setActive(false);
    scheduleInvite(INVITE_EVERY_MS);
  }

  function togglePanel() {
    if (panelOpen) closePanel();
    else openPanel();
  }

  window.AssistantBubble = {
    open(promptOrOpts) {
      openPanel(promptOrOpts);
    },
    close: closePanel,
    isOpen: () => panelOpen,
  };

  /* ---------- Globito de invitación ---------- */

  function showInvite(text, { force = false } = {}) {
    if (removed || panelOpen || document.hidden) return;
    if (quiet && !force) return;
    tooltipText.textContent = text || INVITES[inviteIndex % INVITES.length];
    tooltip.classList.remove('ai-fab__tooltip--hidden');
    tooltip.classList.remove('ai-fab__tooltip--pop');
    void tooltip.offsetWidth;
    tooltip.classList.add('ai-fab__tooltip--pop');
    fabMascot?.react('wave');
    clearTimeout(inviteHideTimer);
    inviteHideTimer = setTimeout(hideInvite, INVITE_VISIBLE_MS);
  }

  function hideInvite() {
    clearTimeout(inviteHideTimer);
    tooltip.classList.add('ai-fab__tooltip--hidden');
  }

  function scheduleInvite(delay) {
    clearTimeout(inviteTimer);
    if (quiet || removed) return;
    inviteTimer = setTimeout(() => {
      if (!panelOpen && !document.hidden) {
        showInvite(INVITES[inviteIndex % INVITES.length]);
        inviteIndex += 1;
      }
      scheduleInvite(INVITE_EVERY_MS);
    }, delay);
  }

  btn.addEventListener('click', togglePanel);
  closeBtn.addEventListener('click', closePanel);
  expandBtn?.addEventListener('click', toggleExpanded);
  backdrop.addEventListener('click', () => {
    if (expanded) setExpanded(false);
    else closePanel();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !panelOpen) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    closePanel();
  });

  const trigger = bubble.querySelector('.ai-fab__trigger');
  trigger.addEventListener('mouseenter', () => {
    fabMascot?.setExcited(true);
    if (!panelOpen && tooltip.classList.contains('ai-fab__tooltip--hidden') && !quiet) {
      tooltipText.textContent = INVITES[0];
      tooltip.classList.remove('ai-fab__tooltip--hidden');
      clearTimeout(inviteHideTimer);
    }
  });
  trigger.addEventListener('mouseleave', () => {
    fabMascot?.setExcited(false);
    clearTimeout(inviteHideTimer);
    inviteHideTimer = setTimeout(hideInvite, 2500);
  });
  btn.addEventListener('focus', () => fabMascot?.setExcited(true));
  btn.addEventListener('blur', () => fabMascot?.setExcited(false));
  modeBtns.forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.balvoMode !== mode) chatApi?.stopVoice?.();
    setMode(b.dataset.balvoMode);
  }));
  seeChatBtn.addEventListener('click', () => setMode('chat'));
  callBtn.addEventListener('click', () => {
    loadCoreScript().then(() => {
      const api = initChat();
      if (!api) return;
      if (voiceState === 'idle' || voiceState === 'unsupported') api.startVoiceTurn();
      else api.stopVoice();
    });
  });

  tooltip.addEventListener('click', (e) => {
    e.stopPropagation();
    openPanel();
  });

  tooltipClose.addEventListener('click', (e) => {
    e.stopPropagation();
    quiet = true;
    try { sessionStorage.setItem(QUIET_KEY, '1'); } catch { /* sin storage */ }
    clearTimeout(inviteTimer);
    hideInvite();
  });

  setTimeout(() => {
    bubble.classList.add('ai-fab--visible');
  }, 900);
  scheduleInvite(FIRST_INVITE_MS);

  let openOnLoad = false;
  try {
    openOnLoad = sessionStorage.getItem('ai-chat-open') === '1';
    if (openOnLoad) sessionStorage.removeItem('ai-chat-open');
  } catch { /* sin storage */ }
  if (openOnLoad) setTimeout(openPanel, 400);
})();
