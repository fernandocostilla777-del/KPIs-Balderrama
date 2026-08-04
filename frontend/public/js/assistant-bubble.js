(function () {
  if (document.body.dataset.page === 'assistant') return;

  const MESSAGES = [
    '¿Cuántos Aveo se vendieron?',
    'Pregúntame por modelos o KPIs',
    'Consulto ventas, inventario y EEFF',
    'Abre el chat aquí ↓',
  ];

  const backdrop = document.createElement('div');
  backdrop.className = 'ai-chat-backdrop';
  backdrop.id = 'aiChatBackdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = 'ai-chat-panel';
  panel.id = 'aiChatPanel';
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = `
    <div class="ai-chat-panel__header">
      <div class="ai-chat-panel__title-wrap">
        <span class="material-symbols-outlined ai-chat-panel__logo">smart_toy</span>
        <div>
          <h2 class="ai-chat-panel__title">Analista BALDERRAMA</h2>
          <span class="ai-chat-panel__status" data-ai="status">Verificando…</span>
        </div>
      </div>
      <div class="ai-chat-panel__actions">
        <button type="button" class="ai-chat-panel__icon-btn" data-ai="expand" title="Expandir visualizaciones">
          <span class="material-symbols-outlined" data-ai="expand-icon">open_in_full</span>
        </button>
        <button type="button" class="ai-chat-panel__icon-btn" data-ai="clear" title="Nueva conversación">
          <span class="material-symbols-outlined">delete_sweep</span>
        </button>
        <button type="button" class="ai-chat-panel__icon-btn" id="aiChatClose" title="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
    <div class="ai-chat-panel__main">
      <div class="ai-chat-panel__chat">
        <div class="ai-chat-panel__body custom-scrollbar">
          <div class="ai-chat-panel__prompts" data-ai="prompts"></div>
          <div class="assistant-chat ai-chat-panel__messages" data-ai="messages"></div>
        </div>
        <form class="ai-chat-panel__composer" data-ai="form">
          <textarea data-ai="input" class="assistant-input ai-chat-panel__input" rows="1"
            placeholder="Ej. ¿Cuántos Aveo se vendieron en el año?" maxlength="4000"></textarea>
          <button type="submit" data-ai="send" class="btn-glass btn-primary assistant-send" disabled>
            <span class="material-symbols-outlined">send</span>
          </button>
        </form>
      </div>
      <aside class="ai-chat-panel__viz custom-scrollbar" data-ai="viz" hidden></aside>
    </div>
  `;

  const bubble = document.createElement('div');
  bubble.className = 'ai-fab';
  bubble.innerHTML = `
    <div class="ai-fab__tooltip" id="aiFabTooltip" role="status" aria-live="polite">
      <span class="ai-fab__tooltip-dot"></span>
      <span class="ai-fab__tooltip-text" id="aiFabTooltipText">${MESSAGES[0]}</span>
    </div>
    <div class="ai-fab__trigger">
      <span class="ai-fab__pulse" aria-hidden="true"></span>
      <span class="ai-fab__pulse ai-fab__pulse--delay" aria-hidden="true"></span>
      <button type="button" class="ai-fab__btn" id="aiFabBtn" aria-label="Abrir asistente IA" aria-expanded="false" aria-controls="aiChatPanel">
        <span class="material-symbols-outlined ai-fab__icon">smart_toy</span>
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
  let msgIndex = 0;
  let cycleTimer = null;
  let hidden = false;
  let chatApi = null;
  let panelOpen = false;
  let expanded = false;

  function loadCoreScript() {
    if (window.AssistantChat) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/js/assistant-core.js?v=9';
      s.onload = resolve;
      s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  function initChat() {
    if (chatApi) return chatApi;
    chatApi = window.AssistantChat.init({
      root: panel,
      getExpanded: () => expanded,
    });
    return chatApi;
  }

  function updateExpandUi() {
    panel.classList.toggle('ai-chat-panel--expanded', expanded);
    document.body.classList.toggle('ai-chat-expanded', expanded);
    backdrop.classList.toggle('ai-chat-backdrop--visible', expanded);
    backdrop.setAttribute('aria-hidden', expanded ? 'false' : 'true');

    if (expandIcon) {
      expandIcon.textContent = expanded ? 'close_fullscreen' : 'open_in_full';
    }
    if (expandBtn) {
      expandBtn.title = expanded ? 'Salir de pantalla ampliada' : 'Expandir visualizaciones';
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

  function openPanel(options = {}) {
    const prompt = typeof options === 'string' ? options : options?.prompt;
    const autoSend = typeof options === 'string' ? true : options?.autoSend !== false;

    panelOpen = true;
    panel.classList.add('ai-chat-panel--open');
    panel.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('ai-chat-open');
    hideTooltip();
    loadCoreScript().then(() => {
      const api = initChat();
      api?.focus();
      api?.scrollToBottom?.();
      // Renueva sugerencias al abrir si el chat está vacío
      const hasMessages = Boolean(panel.querySelector('.assistant-msg'));
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
    setExpanded(false);
    panelOpen = false;
    panel.classList.remove('ai-chat-panel--open');
    panel.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('ai-chat-open');
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

  function cycleMessage() {
    if (hidden || panelOpen) return;
    tooltipText.classList.add('ai-fab__tooltip-text--out');
    setTimeout(() => {
      msgIndex = (msgIndex + 1) % MESSAGES.length;
      tooltipText.textContent = MESSAGES[msgIndex];
      tooltipText.classList.remove('ai-fab__tooltip-text--out');
    }, 280);
  }

  function startCycle() {
    if (cycleTimer) clearInterval(cycleTimer);
    cycleTimer = setInterval(cycleMessage, 3800);
  }

  function hideTooltip() {
    hidden = true;
    tooltip.classList.add('ai-fab__tooltip--hidden');
    if (cycleTimer) clearInterval(cycleTimer);
  }

  function showTooltip() {
    if (panelOpen) return;
    hidden = false;
    tooltip.classList.remove('ai-fab__tooltip--hidden');
    startCycle();
  }

  btn.addEventListener('click', togglePanel);
  closeBtn.addEventListener('click', closePanel);
  expandBtn?.addEventListener('click', toggleExpanded);
  backdrop.addEventListener('click', () => setExpanded(false));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !panelOpen) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    closePanel();
  });

  btn.addEventListener('mouseenter', showTooltip);
  bubble.querySelector('.ai-fab__trigger')?.addEventListener('mouseenter', showTooltip);
  bubble.addEventListener('mouseleave', () => {
    if (!panelOpen && !tooltip.classList.contains('ai-fab__tooltip--dismissed')) {
      tooltip.classList.remove('ai-fab__tooltip--hidden');
    }
  });

  tooltip.addEventListener('click', (e) => {
    e.stopPropagation();
    openPanel();
  });

  setTimeout(() => {
    bubble.classList.add('ai-fab--visible');
    startCycle();
  }, 1200);

  setTimeout(() => {
    if (!hidden && !panelOpen) tooltip.classList.add('ai-fab__tooltip--attention');
  }, 2500);

  if (sessionStorage.getItem('ai-chat-open') === '1') {
    sessionStorage.removeItem('ai-chat-open');
    setTimeout(openPanel, 400);
  }
})();
