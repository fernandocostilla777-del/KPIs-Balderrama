/**
 * El tablero queda en claro. Ya no hay selector de apariencia.
 */
(function (global) {
  const root = document.documentElement;
  root.setAttribute('data-theme', 'light');
  root.setAttribute('data-theme-pref', 'light');
  root.style.colorScheme = 'light';
  try {
    localStorage.removeItem('balderrama-theme');
  } catch {
    /* ignore */
  }

  global.BalderramaTheme = {
    getPreference: () => 'light',
    getResolved: () => 'light',
    setPreference() {
      return { preference: 'light', resolved: 'light' };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
