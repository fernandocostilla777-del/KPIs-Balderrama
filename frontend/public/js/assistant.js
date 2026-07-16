(function () {
  const root = document.getElementById('assistantRoot') || document;
  if (!root.querySelector('[data-ai="messages"]')) return;
  window.AssistantChat?.init({ root });
})();
