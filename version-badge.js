'use strict';

// Version badge in the toolbar; press and hold it (or press Enter/Space) to see the changelog.
(() => {
  const { $ } = App;

  const HOLD_MS = 600; // press-and-hold duration on the version badge to open the changelog
  const versionBtn = $('version-badge');
  const changelogEl = $('changelog');
  const changelogList = $('changelog-list');

  const isChangelogOpen = () => !changelogEl.hidden;

  function renderChangelog() {
    const locale = I18n.getLocale();
    changelogList.replaceChildren(...Version.CHANGELOG.map((release) => {
      const section = document.createElement('section');
      const title = document.createElement('h3');
      title.textContent = `${Version.formatVersion(release.version)} · ${release.date}`;
      const ul = document.createElement('ul');
      ul.append(...(release.changes[locale] || release.changes[I18n.DEFAULT_LOCALE]).map((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        return li;
      }));
      section.append(title, ul);
      return section;
    }));
  }

  function openChangelog() {
    renderChangelog();
    changelogEl.hidden = false;
    $('changelog-close').focus();
  }

  function closeChangelog() {
    changelogEl.hidden = true;
    versionBtn.focus();
  }

  function setupVersionBadge() {
    versionBtn.textContent = Version.formatVersion(Version.VERSION);
    let holdTimer = null;
    const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };

    versionBtn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      cancelHold();
      holdTimer = setTimeout(() => { holdTimer = null; openChangelog(); }, HOLD_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => versionBtn.addEventListener(t, cancelHold));
    versionBtn.addEventListener('contextmenu', (e) => e.preventDefault()); // touch long-press
    // keyboard users cannot "hold", so Enter/Space opens it directly
    versionBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openChangelog(); }
    });

    I18n.subscribe(() => { if (isChangelogOpen()) renderChangelog(); });
    $('changelog-close').addEventListener('click', closeChangelog);
    changelogEl.addEventListener('pointerdown', (e) => { if (e.target === changelogEl) closeChangelog(); });
  }

  Object.assign(App, { setupVersionBadge, isChangelogOpen, closeChangelog });
})();
