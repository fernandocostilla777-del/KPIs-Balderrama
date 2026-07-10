(function () {
  if (document.body.dataset.page === 'assistant') return;

  const MESSAGES = [
    '¿Necesitas algún dato?',
    '¿Quieres ver una gráfica?',
    '¿Tienes alguna consulta?',
    'Pregúntame sobre ventas, inventario o KPIs',
  ];

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
      <button type="button" class="ai-fab__btn" id="aiFabBtn" aria-label="Abrir asistente IA">
        <span class="material-symbols-outlined ai-fab__icon">smart_toy</span>
      </button>
    </div>
  `;
  document.body.appendChild(bubble);

  const btn = document.getElementById('aiFabBtn');
  const tooltip = document.getElementById('aiFabTooltip');
  const tooltipText = document.getElementById('aiFabTooltipText');
  let msgIndex = 0;
  let cycleTimer = null;
  let hidden = false;

  function cycleMessage() {
    if (hidden) return;
    tooltipText.classList.add('ai-fab__tooltip-text--out');
    setTimeout(() => {
      msgIndex = (msgIndex + 1) % MESSAGES.length;
      tooltipText.textContent = MESSAGES[msgIndex];
      tooltipText.classList.remove('ai-fab__tooltip-text--out');
    }, 280);
  }

  function startCycle() {
    cycleTimer = setInterval(cycleMessage, 3800);
  }

  function hideTooltip() {
    hidden = true;
    tooltip.classList.add('ai-fab__tooltip--hidden');
    if (cycleTimer) clearInterval(cycleTimer);
  }

  function showTooltip() {
    hidden = false;
    tooltip.classList.remove('ai-fab__tooltip--hidden');
    startCycle();
  }

  btn.addEventListener('click', () => {
    window.location.href = '/assistant.html';
  });

  btn.addEventListener('mouseenter', showTooltip);
  bubble.querySelector('.ai-fab__trigger')?.addEventListener('mouseenter', showTooltip);
  bubble.addEventListener('mouseleave', () => {
    if (!tooltip.classList.contains('ai-fab__tooltip--dismissed')) {
      tooltip.classList.remove('ai-fab__tooltip--hidden');
    }
  });

  tooltip.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = '/assistant.html';
  });

  setTimeout(() => {
    bubble.classList.add('ai-fab--visible');
    startCycle();
  }, 1200);

  setTimeout(() => {
    if (!hidden) tooltip.classList.add('ai-fab__tooltip--attention');
  }, 2500);
})();
