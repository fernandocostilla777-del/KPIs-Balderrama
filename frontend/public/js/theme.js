/**
 * Tema Balderrama: light | dark | system
 * Preferencia en localStorage; data-theme en <html> = tema resuelto.
 */
(function (global) {
  const STORAGE_KEY = 'balderrama-theme';
  const PREFS = ['system', 'light', 'dark'];
  const LABELS = {
    system: 'Sistema',
    light: 'Claro',
    dark: 'Oscuro',
  };
  const ICONS = {
    system: 'brightness_auto',
    light: 'light_mode',
    dark: 'dark_mode',
  };

  let mediaQuery = null;
  let mediaHandler = null;

  function readPref() {
    try {
      const raw = String(localStorage.getItem(STORAGE_KEY) || 'system').toLowerCase();
      return PREFS.includes(raw) ? raw : 'system';
    } catch {
      return 'system';
    }
  }

  function systemIsDark() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  }

  function resolve(pref) {
    const p = PREFS.includes(pref) ? pref : 'system';
    if (p === 'system') return systemIsDark() ? 'dark' : 'light';
    return p;
  }

  function apply(pref) {
    const preference = PREFS.includes(pref) ? pref : readPref();
    const resolved = resolve(preference);
    const root = document.documentElement;
    root.setAttribute('data-theme-pref', preference);
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* ignore */
    }
    bindSystemListener(preference);
    global.dispatchEvent(new CustomEvent('balderrama:theme', {
      detail: { preference, resolved },
    }));
    return { preference, resolved };
  }

  function bindSystemListener(pref) {
    if (mediaQuery && mediaHandler) {
      mediaQuery.removeEventListener('change', mediaHandler);
      mediaQuery = null;
      mediaHandler = null;
    }
    if (pref !== 'system') return;
    try {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaHandler = () => apply('system');
      mediaQuery.addEventListener('change', mediaHandler);
    } catch {
      /* ignore */
    }
  }

  function boot() {
    apply(readPref());
  }

  boot();

  global.BalderramaTheme = {
    STORAGE_KEY,
    PREFS,
    LABELS,
    ICONS,
    getPreference: readPref,
    getResolved: () => resolve(readPref()),
    setPreference: apply,
    resolve,
    boot,
  };
})(typeof window !== 'undefined' ? window : globalThis);
