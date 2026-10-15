(() => {
  const desktopApi = window.nineGridDesktop;
  const hostStylesheet = document.querySelector('link[data-ninegrid-titlebar]');
  const shadowStylesheet = hostStylesheet?.dataset.shadowStylesheet;
  if (!desktopApi || !hostStylesheet || !shadowStylesheet) {
    document.querySelector('ninegrid-titlebar')?.remove();
    return;
  }

  document.documentElement.classList.add('ninegrid-desktop');

  class NineGridTitlebar extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
      this.shadowRoot.innerHTML = `
        <header class="bar">
          <div class="brand" data-drag-region>
            <svg class="mark" viewBox="0 0 30 30" aria-hidden="true">
              <rect x="1" y="1" width="8" height="8" rx="1"/><rect x="11" y="1" width="8" height="8" rx="1"/>
              <rect x="21" y="1" width="8" height="8" rx="1"/><rect x="1" y="11" width="8" height="8" rx="1"/>
              <rect x="11" y="11" width="8" height="8" rx="1"/><rect x="21" y="11" width="8" height="8" rx="1"/>
              <rect x="1" y="21" width="8" height="8" rx="1"/><rect x="11" y="21" width="8" height="8" rx="1"/>
              <rect x="21" y="21" width="8" height="8" rx="1"/>
            </svg>
            <strong>九格行动1.0测试版</strong>
          </div>
          <div class="drag-space" data-drag-region aria-hidden="true"></div>
          <div class="actions" data-no-drag>
            <button class="icon-button" type="button" data-action="settings" aria-label="打开桌面设置" title="设置与数据">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="m19.4 13.5 1.1.8-1.1 1.9-1.3-.5a7.7 7.7 0 0 1-1.4.8l-.2 1.4h-2.2l-.3-1.4a7.7 7.7 0 0 1-1.5 0l-.8 1.2-1.9-1.1.5-1.3a7.7 7.7 0 0 1-.8-1.4l-1.4-.2v-2.2l1.4-.3a7.7 7.7 0 0 1 0-1.5l-1.2-.8 1.1-1.9 1.3.5a7.7 7.7 0 0 1 1.4-.8l.2-1.4h2.2l.3 1.4a7.7 7.7 0 0 1 1.5 0l.8-1.2 1.9 1.1-.5 1.3a7.7 7.7 0 0 1 .8 1.4l1.4.2v2.2l-1.4.3a7.7 7.7 0 0 1 .1 1.5Z"/></svg>
            </button>
            <button class="more-button" type="button" data-menu-toggle aria-expanded="false" aria-haspopup="menu" aria-label="更多" title="更多">更多</button>
          </div>
          <section class="menu" role="menu" aria-label="更多" hidden>
            <button type="button" role="menuitem" data-action="app-settings">学习与连接设置</button>
            <button type="button" role="menuitem" data-action="zoom-in">界面放大 <kbd>Ctrl +</kbd></button>
            <button type="button" role="menuitem" data-action="zoom-out">界面缩小 <kbd>Ctrl −</kbd></button>
            <button type="button" role="menuitem" data-action="zoom-reset">恢复默认缩放 <kbd>Ctrl 0</kbd></button>
            <hr>
            <button type="button" role="menuitem" data-action="backup">立即备份</button>
            <button type="button" role="menuitem" data-action="logs">打开日志目录</button>
            <p class="version" data-version aria-live="polite">读取版本信息…</p>
            <p class="status" data-status role="status" aria-live="polite"></p>
          </section>
        </header>`;
      const styleLink = document.createElement('link');
      styleLink.rel = 'stylesheet';
      styleLink.href = new URL(shadowStylesheet, document.baseURI).href;
      this.shadowRoot.prepend(styleLink);

      const menu = this.shadowRoot.querySelector('.menu');
      const toggle = this.shadowRoot.querySelector('[data-menu-toggle]');
      const status = this.shadowRoot.querySelector('[data-status]');
      const connectionSettingsItem = this.shadowRoot.querySelector('[data-action="app-settings"]');
      const closeMenu = () => {
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      };
      const openMenu = () => {
        menu.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        menu.querySelector('[role="menuitem"]:not([hidden])')?.focus();
      };

      toggle.addEventListener('click', () => menu.hidden ? openMenu() : closeMenu());
      this.shadowRoot.querySelector('[data-action="settings"]').addEventListener('click', () => {
        void run(() => desktopApi.openSettings());
      });
      const syncConnectionSettingsVisibility = () => {
        connectionSettingsItem.hidden = location.protocol !== 'http:' || !document.querySelector('.app-shell');
      };
      syncConnectionSettingsVisibility();
      this.appShellObserver = new MutationObserver(syncConnectionSettingsVisibility);
      this.appShellObserver.observe(document.body, { childList: true, subtree: true });
      this.shadowRoot.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          closeMenu();
          toggle.focus();
          return;
        }
        if (!['ArrowDown', 'ArrowUp'].includes(event.key) || menu.hidden) return;
        const items = [...menu.querySelectorAll('[role="menuitem"]:not([hidden])')];
        const index = items.indexOf(this.shadowRoot.activeElement);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + delta + items.length) % items.length]?.focus();
        event.preventDefault();
      });
      this.onDocumentPointerDown = event => {
        if (!event.composedPath().includes(this)) closeMenu();
      };
      document.addEventListener('pointerdown', this.onDocumentPointerDown);

      const run = async action => {
        try {
          status.textContent = '正在执行…';
          const result = await action();
          status.textContent = typeof result === 'string' ? result.split('\n')[0] : '操作已完成。';
        } catch (error) {
          status.textContent = `操作失败：${error instanceof Error ? error.message : '请查看日志。'}`;
        }
      };
      const actionNames = ['app-settings', 'zoom-in', 'zoom-out', 'zoom-reset', 'backup', 'logs'];
      for (const name of actionNames) {
        this.shadowRoot.querySelector(`[data-action="${name}"]`).addEventListener('click', () => {
          if (name === 'app-settings') {
            window.dispatchEvent(new CustomEvent('ninegrid:open-app-settings'));
            closeMenu();
            return;
          }
          if (name.startsWith('zoom-')) {
            void run(async () => {
              const current = await desktopApi.getSettings();
              const next = name === 'zoom-reset' ? 1 : name === 'zoom-in' ? Math.min(1.6, current.zoom + 0.1) : Math.max(0.7, current.zoom - 0.1);
              return desktopApi.setZoom(next);
            });
          } else if (name === 'backup') void run(() => desktopApi.createBackup());
          else if (name === 'logs') void run(() => desktopApi.openLogs());
        });
      }

      void desktopApi.getSettings().then(settings => {
        this.shadowRoot.querySelector('[data-version]').textContent = `${settings.version} · ${settings.commit}`;
      }).catch(() => {
        this.shadowRoot.querySelector('[data-version]').textContent = '版本信息暂不可用';
      });
    }

    disconnectedCallback() {
      this.appShellObserver?.disconnect();
      if (this.onDocumentPointerDown) document.removeEventListener('pointerdown', this.onDocumentPointerDown);
    }
  }

  customElements.define('ninegrid-titlebar', NineGridTitlebar);
})();
