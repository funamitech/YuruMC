/**
 * YuruMC shared UI (same as YuruMirror's): theme toggle, mobile menu,
 * dropdowns, active-link highlighting and copy-to-clipboard buttons for
 * server addresses. Loaded with `defer` on every page.
 */
(function() {
  'use strict';

  var root = document.documentElement;

  /* Theme toggle (system preference by default, explicit choice persisted) */
  var themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function() {
      var dark = root.dataset.theme === 'dark' ||
        (root.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
      var next = dark ? 'light' : 'dark';
      root.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch (e) { /* storage unavailable */ }
    });
  }

  /* Mobile menu */
  var menuToggle = document.getElementById('menu-toggle');
  var mobileMenu = document.getElementById('mobile-menu');
  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', function() {
      var open = mobileMenu.hidden;
      mobileMenu.hidden = !open;
      menuToggle.setAttribute('aria-expanded', String(open));
      menuToggle.querySelector('[data-icon-open]').hidden = open;
      menuToggle.querySelector('[data-icon-close]').hidden = !open;
    });
  }

  /* Dropdown menus (click to open, Escape or outside click to close) */
  document.querySelectorAll('[data-dropdown]').forEach(function(dropdown) {
    var button = dropdown.querySelector('button[aria-expanded]');
    var panel = dropdown.querySelector('.dropdown-panel');
    if (!button || !panel) return;

    function setOpen(open) {
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    }

    button.addEventListener('click', function() {
      setOpen(panel.hidden);
    });
    document.addEventListener('click', function(event) {
      if (!panel.hidden && !dropdown.contains(event.target)) setOpen(false);
    });
    dropdown.addEventListener('keydown', function(event) {
      if (event.key === 'Escape' && !panel.hidden) {
        setOpen(false);
        button.focus();
      }
    });
  });

  /* Copy-to-clipboard for server addresses (buttons stay hidden without JS/clipboard) */
  if (navigator.clipboard && window.isSecureContext) {
    var copyStatus = document.createElement('div');
    copyStatus.className = 'sr-only';
    copyStatus.setAttribute('aria-live', 'polite');
    document.body.appendChild(copyStatus);

    document.querySelectorAll('button[data-copy]').forEach(function(button) {
      button.hidden = false;
      button.addEventListener('click', function() {
        navigator.clipboard.writeText(button.dataset.copy).then(function() {
          copyStatus.textContent = '';
          copyStatus.textContent = 'Copied ' + button.dataset.copy + ' to clipboard';
          button.classList.add('is-copied');
          button.querySelector('[data-copy-icon]').hidden = true;
          button.querySelector('[data-copied-icon]').hidden = false;
          setTimeout(function() {
            button.classList.remove('is-copied');
            button.querySelector('[data-copy-icon]').hidden = false;
            button.querySelector('[data-copied-icon]').hidden = true;
          }, 1500);
        }).catch(function() { /* clipboard denied */ });
      });
    });
  }

  /* Highlight the current page in navigation menus */
  var path = location.pathname;
  document.querySelectorAll('a.menu-item[href], a.nav-link[href]').forEach(function(link) {
    var href = link.getAttribute('href');
    if (!href || href === '/' || href.charAt(0) !== '/') return;
    if (path === href || (href.charAt(href.length - 1) === '/' && path.indexOf(href) === 0)) {
      link.classList.add('is-active');
    }
  });
})();
