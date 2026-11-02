'use strict';

// Binds the I18n dictionaries to the page and provides the language switcher.
//   data-i18n="key"        -> element text
//   data-i18n-title="key"  -> title + aria-label (icon-only buttons)
//   data-i18n-aria="key"   -> aria-label only
//   data-shortcut="action" -> the action's current key goes into the title ("({key})" in the
//                             message, or the whole title for text buttons); see shortcut-settings.js
// The chosen language is remembered in localStorage; otherwise the browser language is used.
(() => {
  const { $ } = App;

  const STORAGE_KEY = 'zcreenshot.locale';

  function readStoredLocale() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (err) { // storage can be blocked (private mode, file:// in some browsers)
      return null;
    }
  }

  function storeLocale(code) {
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch (err) {
      console.warn('could not remember the language', err);
    }
  }

  function applyTranslations() {
    document.documentElement.lang = I18n.getLocale();
    $('lang-select').value = I18n.getLocale();
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = I18n.t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const text = el.dataset.shortcut
        ? App.shortcutTitle(el.dataset.i18nTitle, el.dataset.shortcut)
        : I18n.t(el.dataset.i18nTitle);
      el.title = text;
      el.setAttribute('aria-label', text);
    });
    document.querySelectorAll('[data-shortcut]:not([data-i18n-title])').forEach((el) => {
      el.title = App.shortcutHint(el.dataset.shortcut);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', I18n.t(el.dataset.i18nAria));
    });
  }

  function buildLanguageSelect() {
    const select = $('lang-select');
    select.replaceChildren(...I18n.LOCALES.map(({ code, name }) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = name;
      return option;
    }));
    select.value = I18n.getLocale();
    select.addEventListener('change', () => {
      if (!I18n.setLocale(select.value)) return;
      storeLocale(select.value);
    });
  }

  function setupLocalization() {
    const stored = readStoredLocale();
    I18n.setLocale(I18n.resolveLocale([stored, ...(navigator.languages || [navigator.language])]));
    I18n.subscribe(applyTranslations);
    buildLanguageSelect();
    applyTranslations();
  }

  Object.assign(App, { setupLocalization, applyTranslations });
})();
