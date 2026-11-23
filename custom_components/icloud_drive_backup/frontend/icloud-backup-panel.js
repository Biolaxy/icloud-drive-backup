/*
 * iCloud Backup panel for the "iCloud Drive Backup" integration.
 * One place for status, folder explorer, notifications and settings.
 * Plain web component (no build step). Talks to the integration via the
 * admin-only WebSocket commands "icloud_drive_backup/*".
 */

const INTEGRATION_URL = "/config/integrations/integration/icloud_drive_backup";
const BACKUP_SETTINGS_URL = "/config/backup/settings";

const I18N = {
  de: {
    title: "iCloud Backup",
    account: "Konto",
    tabs: { folders: "Ordner", notify: "Benachrichtigungen", settings: "Einstellungen" },
    // status card
    connected: "Verbunden",
    notLoadedState: "Nicht verbunden",
    reauthTitle: "Anmeldung abgelaufen",
    reauthText: "Apple hat die iCloud-Sitzung beendet. Bis du dich neu anmeldest, werden keine Backups in iCloud gespeichert.",
    reauthButton: "Jetzt neu anmelden",
    notLoadedText: "Die Integration ist gerade nicht verbunden. Details findest du bei der Integration.",
    openIntegration: "Integration öffnen",
    folder: "Backup-Ordner",
    lastBackup: "Letztes Backup in iCloud",
    noBackupYet: "Noch keins",
    backupCount: "Backups in iCloud",
    statusError: "iCloud nicht erreichbar",
    ago: (v, u) => `vor ${v} ${u}`,
    units: { m: ["Minute", "Minuten"], h: ["Stunde", "Stunden"], d: ["Tag", "Tagen"] },
    justNow: "gerade eben",
    // folders
    search: "Ordner suchen",
    searching: "Durchsuche Ordner …",
    noResults: "Keine Ordner gefunden.",
    truncated: "Es werden nur die ersten Ebenen durchsucht.",
    loading: "Lade …",
    current: "Das ist dein aktueller Backup-Ordner",
    currentShort: "Aktueller Backup-Ordner",
    folders: "Ordner",
    noFolders: "Keine Unterordner.",
    items: (n) => `${n} Element${n === 1 ? "" : "e"}`,
    backupsTitle: "Backups in diesem Ordner",
    noBackups: "Noch keine Home-Assistant-Backups in diesem Ordner.",
    otherFiles: (n) => `Außerdem ${n} weitere Datei${n === 1 ? "" : "en"}.`,
    colName: "Backup",
    colDate: "Datum",
    colSize: "Größe",
    noMeta: "ohne Metadaten",
    newFolder: "Neuer Unterordner",
    newFolderPh: "Name für neuen Unterordner",
    create: "Anlegen",
    created: (n) => `Ordner „${n}“ angelegt`,
    selected: "Ausgewählt",
    use: "Als Backup-Ordner verwenden",
    saved: (p) => `Backup-Ordner geändert: ${p}`,
    missing: "Der Backup-Ordner existiert nicht (er wird beim nächsten Backup angelegt).",
    rootHint: "Wähle oder lege einen Ordner an. Backups können nicht direkt in der obersten Ebene liegen.",
    foldersUnavailable: "Der Ordner-Explorer ist verfügbar, sobald die Integration verbunden ist.",
    refresh: "Neu laden",
    // notify
    notifyIntro: "Etwa alle 2 Monate beendet Apple die iCloud-Sitzung und du musst dich neu anmelden. Lege fest, wie du davon erfährst.",
    notifyPersistent: "Hinweis in Home Assistant",
    notifyPersistentHint: "Erscheint unter der Glocke in der Seitenleiste.",
    notifyPush: "Push-Nachricht an diese Geräte",
    notifyPushHint: "Ein Tipp auf die Nachricht öffnet die Integration (Home-Assistant-App).",
    noServices: "Keine Push-Dienste gefunden. Installiere die Home-Assistant-App auf deinem Handy, dann erscheint sie hier.",
    sendTest: "Testnachricht senden",
    testSent: "Testnachricht gesendet",
    save: "Speichern",
    savedSettings: "Einstellungen gespeichert",
    // settings
    sidebar: "In der Seitenleiste anzeigen",
    sidebarHint: "Ausgeblendet erreichst du dieses Fenster über Einstellungen → Geräte & Dienste → iCloud Drive Backup → Konfigurieren.",
    sidebarOn: "Wird in der Seitenleiste angezeigt",
    sidebarOff: "Aus der Seitenleiste ausgeblendet",
    checkTitle: "Ordner prüfen",
    checkHint: "Liest den Backup-Ordner und legt eine kleine Testdatei an, die sofort wieder gelöscht wird (sie landet kurz in „Zuletzt gelöscht“).",
    check: "Jetzt prüfen",
    checking: "Prüfe Ordner …",
    checkOk: (n) => `Ordner gefunden und lesbar (${n} Backup${n === 1 ? "" : "s"})`,
    writeOk: "Schreibtest erfolgreich",
    writeFail: "Schreibtest fehlgeschlagen",
    links: "Weitere Einstellungen",
    linkBackup: "Backup-Einstellungen von Home Assistant",
    linkBackupHint: "Zeitplan, Aufbewahrung und Speicherorte",
    linkAccount: "Konto & Anmeldung",
    linkAccountHint: "Apple-ID, erneute Anmeldung, Integration entfernen",
    version: "Version",
    noEntries: "Es ist noch kein iCloud-Konto eingerichtet.",
  },
  en: {
    title: "iCloud Backup",
    account: "Account",
    tabs: { folders: "Folders", notify: "Notifications", settings: "Settings" },
    connected: "Connected",
    notLoadedState: "Not connected",
    reauthTitle: "Sign-in expired",
    reauthText: "Apple ended the iCloud session. No backups are stored in iCloud until you sign in again.",
    reauthButton: "Sign in again",
    notLoadedText: "The integration is not connected right now. See the integration for details.",
    openIntegration: "Open integration",
    folder: "Backup folder",
    lastBackup: "Last backup in iCloud",
    noBackupYet: "None yet",
    backupCount: "Backups in iCloud",
    statusError: "iCloud not reachable",
    ago: (v, u) => `${v} ${u} ago`,
    units: { m: ["minute", "minutes"], h: ["hour", "hours"], d: ["day", "days"] },
    justNow: "just now",
    search: "Search folders",
    searching: "Searching folders …",
    noResults: "No folders found.",
    truncated: "Only the first levels are searched.",
    loading: "Loading …",
    current: "This is your current backup folder",
    currentShort: "Current backup folder",
    folders: "Folders",
    noFolders: "No subfolders.",
    items: (n) => `${n} item${n === 1 ? "" : "s"}`,
    backupsTitle: "Backups in this folder",
    noBackups: "No Home Assistant backups in this folder yet.",
    otherFiles: (n) => `Plus ${n} other file${n === 1 ? "" : "s"}.`,
    colName: "Backup",
    colDate: "Date",
    colSize: "Size",
    noMeta: "no metadata",
    newFolder: "New subfolder",
    newFolderPh: "Name of the new subfolder",
    create: "Create",
    created: (n) => `Folder "${n}" created`,
    selected: "Selected",
    use: "Use as backup folder",
    saved: (p) => `Backup folder changed: ${p}`,
    missing: "The backup folder does not exist (it will be created on the next backup).",
    rootHint: "Pick or create a folder. Backups cannot be stored directly in the top level.",
    foldersUnavailable: "The folder explorer is available once the integration is connected.",
    refresh: "Reload",
    notifyIntro: "About every 2 months Apple ends the iCloud session and you have to sign in again. Choose how you want to be told.",
    notifyPersistent: "Notification in Home Assistant",
    notifyPersistentHint: "Shows up under the bell in the sidebar.",
    notifyPush: "Push message to these devices",
    notifyPushHint: "Tapping the message opens the integration (Home Assistant app).",
    noServices: "No push services found. Install the Home Assistant app on your phone and it will show up here.",
    sendTest: "Send test message",
    testSent: "Test message sent",
    save: "Save",
    savedSettings: "Settings saved",
    sidebar: "Show in sidebar",
    sidebarHint: "When hidden, open this page via Settings → Devices & services → iCloud Drive Backup → Configure.",
    sidebarOn: "Shown in the sidebar",
    sidebarOff: "Hidden from the sidebar",
    checkTitle: "Check folder",
    checkHint: "Reads the backup folder and creates a small test file that is deleted right away (it briefly sits in “Recently Deleted”).",
    check: "Check now",
    checking: "Checking folder …",
    checkOk: (n) => `Folder found and readable (${n} backup${n === 1 ? "" : "s"})`,
    writeOk: "Write test passed",
    writeFail: "Write test failed",
    links: "More settings",
    linkBackup: "Home Assistant backup settings",
    linkBackupHint: "Schedule, retention and locations",
    linkAccount: "Account & sign-in",
    linkAccountHint: "Apple ID, re-authentication, remove integration",
    version: "Version",
    noEntries: "No iCloud account is set up yet.",
  },
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const join = (base, name) => (base ? `${base}/${name}` : name);
const parentOf = (p) => p.split("/").slice(0, -1).join("/");
const ancestors = (p) => {
  const segs = p ? p.split("/") : [];
  return segs.map((_, i) => segs.slice(0, i).join("/"));
};
const pretty = (p) => ["iCloud Drive", ...(p ? p.split("/") : [])].join(" › ");

class ICloudBackupPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._started = false;
    this._tab = "folders";
    this._entries = [];
    this._entryId = null;
    this._status = null;
    this._current = "";
    this._cache = new Map(); // path -> browse result
    this._loading = new Set();
    this._open = new Set([""]);
    this._sel = "";
    this._query = "";
    this._tree = null;
    this._treeLoading = false;
    this._banner = null; // {kind, lines}
    this._busy = false;
    this._notifyDraft = null; // {notify_persistent, notify_services}
    this._checkResult = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._started) {
      this._started = true;
      this._t = I18N[(hass.language || "en").startsWith("de") ? "de" : "en"];
      try {
        this._tab = localStorage.getItem("icloud-backup-tab") || "folders";
      } catch (_) {}
      this._shell();
      this._init();
    }
  }

  set narrow(narrow) {
    this._narrow = narrow;
    const btn = this.shadowRoot.querySelector("#menu");
    if (btn) btn.hidden = !narrow;
  }

  set panel(panel) {
    this._panel = panel;
  }

  // ------------------------------------------------------------ data

  _ws(type, data = {}) {
    return this._hass.callWS({ type: `icloud_drive_backup/${type}`, entry_id: this._entryId, ...data });
  }

  _err(err) {
    return err?.message || err?.code || String(err);
  }

  _toast(message) {
    this.dispatchEvent(new CustomEvent("hass-notification", { detail: { message }, bubbles: true, composed: true }));
  }

  _navigate(path) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }

  get _entry() {
    return this._entries.find((e) => e.entry_id === this._entryId);
  }

  async _init() {
    try {
      this._entries = await this._hass.callWS({ type: "icloud_drive_backup/entries" });
    } catch (err) {
      this._banner = { kind: "error", lines: [this._err(err)] };
      return this._render();
    }
    const loaded = this._entries.find((e) => e.loaded) || this._entries[0];
    await this._selectEntry(loaded ? loaded.entry_id : null);
  }

  async _selectEntry(entryId) {
    this._entryId = entryId;
    this._cache.clear();
    this._open = new Set([""]);
    this._tree = null;
    this._query = "";
    this._status = null;
    this._notifyDraft = null;
    this._checkResult = null;
    const search = this.shadowRoot.querySelector("#search");
    if (search) search.value = "";
    this._banner = null;
    const entry = this._entry;
    if (!entry) {
      this._banner = { kind: "info", lines: [this._t.noEntries] };
      return this._render();
    }
    this._loadStatus();
    if (!entry.loaded) return this._render();
    this._current = entry.folder || "";
    await this._goto(this._current);
  }

  async _loadStatus() {
    try {
      this._status = await this._ws("status");
      if (this._status.loaded && this._status.folder) this._current = this._status.folder;
    } catch (err) {
      this._status = { error: this._err(err) };
    }
    this._render();
  }

  async _load(path, force = false) {
    if (!force && this._cache.has(path)) return this._cache.get(path);
    this._loading.add(path);
    this._render();
    try {
      const res = await this._ws("browse", { path });
      this._cache.set(path, res);
      if (res.current) this._current = res.current;
      return res;
    } finally {
      this._loading.delete(path);
    }
  }

  async _goto(path) {
    this._sel = path;
    for (const a of ancestors(path)) this._open.add(a);
    this._open.add(path);
    this._render();
    try {
      for (const a of ancestors(path)) await this._load(a);
      await this._load(path);
    } catch (err) {
      if (err?.code === "folder_not_found" && path) {
        this._banner = { kind: "warn", lines: [this._t.missing] };
        return this._goto(parentOf(path));
      }
      if (err?.code === "auth") this._loadStatus();
      this._banner = { kind: "error", lines: [this._err(err)] };
    }
    this._render();
  }

  async _toggle(path) {
    if (this._open.has(path) && path !== "") {
      this._open.delete(path);
      return this._render();
    }
    this._open.add(path);
    try {
      await this._load(path);
    } catch (err) {
      this._banner = { kind: "error", lines: [this._err(err)] };
    }
    this._render();
  }

  async _search(q) {
    this._query = q.trim();
    if (this._query && !this._tree && !this._treeLoading) {
      this._treeLoading = true;
      this._render();
      try {
        this._tree = await this._ws("tree");
      } catch (err) {
        this._banner = { kind: "error", lines: [this._err(err)] };
      }
      this._treeLoading = false;
    }
    this._render();
  }

  async _createFolder() {
    const input = this.shadowRoot.querySelector("#newname");
    const name = (input?.value || "").trim();
    if (!name) return input?.focus();
    this._busy = true;
    this._render();
    try {
      const res = await this._ws("create_folder", { path: this._sel, name });
      this._tree = null;
      await this._load(this._sel, true);
      this._toast(this._t.created(name));
      this._busy = false;
      await this._goto(res.path);
    } catch (err) {
      this._busy = false;
      this._banner = { kind: "error", lines: [this._err(err)] };
      this._render();
    }
  }

  async _use() {
    if (!this._sel || this._sel === this._current) return;
    this._busy = true;
    this._render();
    try {
      const res = await this._ws("set_folder", { path: this._sel });
      this._current = res.folder;
      this._banner = null;
      this._toast(this._t.saved(res.folder));
      // The integration reloads with the new folder; refresh list + status afterwards.
      setTimeout(async () => {
        try {
          this._entries = await this._hass.callWS({ type: "icloud_drive_backup/entries" });
        } catch (_) {}
        this._loadStatus();
      }, 3000);
    } catch (err) {
      this._banner = { kind: "error", lines: [this._err(err)] };
    }
    this._busy = false;
    this._render();
  }

  async _check() {
    this._busy = true;
    this._checkResult = { kind: "info", lines: [this._t.checking] };
    this._render();
    try {
      const r = await this._ws("check", { write_test: true });
      const t = this._t;
      if (r.error && !r.exists) this._checkResult = { kind: "error", lines: [r.error] };
      else if (!r.exists) this._checkResult = { kind: "warn", lines: [t.missing] };
      else {
        const lines = [`✓ ${t.checkOk(r.backups ?? 0)}`];
        lines.push(r.write_ok ? `✓ ${t.writeOk}` : `✗ ${t.writeFail}${r.error ? `: ${r.error}` : ""}`);
        this._checkResult = { kind: r.write_ok ? "ok" : "error", lines, title: pretty(r.path) };
      }
      this._cache.delete(this._current);
    } catch (err) {
      this._checkResult = { kind: "error", lines: [this._err(err)] };
    }
    this._busy = false;
    this._render();
  }

  _draft() {
    if (!this._notifyDraft && this._status?.options) {
      this._notifyDraft = {
        notify_persistent: this._status.options.notify_persistent,
        notify_services: [...this._status.options.notify_services],
      };
    }
    return this._notifyDraft;
  }

  _notifyDirty() {
    const d = this._notifyDraft;
    const o = this._status?.options;
    if (!d || !o) return false;
    return (
      d.notify_persistent !== o.notify_persistent ||
      [...d.notify_services].sort().join() !== [...o.notify_services].sort().join()
    );
  }

  async _saveNotify() {
    this._busy = true;
    this._render();
    try {
      const opts = await this._ws("set_options", this._notifyDraft);
      this._status.options = opts;
      this._notifyDraft = null;
      this._toast(this._t.savedSettings);
    } catch (err) {
      this._banner = { kind: "error", lines: [this._err(err)] };
    }
    this._busy = false;
    this._render();
  }

  async _testNotify() {
    this._busy = true;
    this._render();
    try {
      await this._ws("test_notify", this._draft());
      this._toast(this._t.testSent);
    } catch (err) {
      this._banner = { kind: "error", lines: [this._err(err)] };
    }
    this._busy = false;
    this._render();
  }

  async _setSidebar(show) {
    try {
      const opts = await this._ws("set_options", { show_panel: show });
      this._status.options = opts;
      this._toast(show ? this._t.sidebarOn : this._t.sidebarOff);
    } catch (err) {
      this._banner = { kind: "error", lines: [this._err(err)] };
    }
    this._render();
  }

  // ---------------------------------------------------------- render

  _shell() {
    const t = this._t;
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div class="toolbar">
        <button id="menu" class="icon-btn" title="Menu" ${this._narrow ? "" : "hidden"}><ha-icon icon="mdi:menu"></ha-icon></button>
        <div class="title"><ha-icon icon="mdi:cloud-upload-outline"></ha-icon><span>${t.title}</span></div>
        <select id="account" aria-label="${t.account}" hidden></select>
      </div>
      <div class="content">
        <section id="status" aria-live="polite"></section>
        <div class="tabs" role="tablist">
          ${["folders", "notify", "settings"]
            .map((k) => `<button class="tab" role="tab" data-tab="${k}">${t.tabs[k]}</button>`)
            .join("")}
        </div>
        <div id="banner"></div>
        <section class="pane" data-pane="folders">
          <div class="card">
            <div class="cardbar">
              <div class="search-wrap"><ha-icon icon="mdi:magnify"></ha-icon>
                <input id="search" type="search" placeholder="${t.search}" aria-label="${t.search}"></div>
            </div>
            <div class="grid">
              <nav class="tree" id="tree" aria-label="${t.folders}"></nav>
              <section class="main" id="main"></section>
            </div>
            <div class="footer" id="footer"></div>
          </div>
        </section>
        <section class="pane" data-pane="notify"><div class="card padded" id="notify"></div></section>
        <section class="pane" data-pane="settings"><div class="card padded" id="settings"></div></section>
      </div>`;
    const root = this.shadowRoot;
    root.querySelector("#menu").addEventListener("click", () =>
      this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }))
    );
    root.querySelector("#account").addEventListener("change", (e) => this._selectEntry(e.target.value));
    let timer;
    root.querySelector("#search").addEventListener("input", (e) => {
      // Read the value now: inside a shadow root the event target is reset after dispatch.
      const value = e.currentTarget.value;
      clearTimeout(timer);
      timer = setTimeout(() => this._search(value), 250);
    });
    root.addEventListener("click", (e) => this._onClick(e));
    root.addEventListener("change", (e) => this._onChange(e));
    root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.id === "newname") this._createFolder();
      if ((e.key === "Enter" || e.key === " ") && e.target.classList?.contains("node")) {
        e.preventDefault();
        e.target.click();
      }
    });
  }

  _onClick(e) {
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      this._tab = tab.dataset.tab;
      try {
        localStorage.setItem("icloud-backup-tab", this._tab);
      } catch (_) {}
      return this._render();
    }
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const { act, path } = el.dataset;
    switch (act) {
      case "toggle":
        e.stopPropagation();
        return this._toggle(path);
      case "go":
        return this._goto(path);
      case "show-folder":
        this._tab = "folders";
        return this._goto(this._current);
      case "create":
        return this._createFolder();
      case "use":
        return this._use();
      case "check":
        return this._check();
      case "save-notify":
        return this._saveNotify();
      case "test-notify":
        return this._testNotify();
      case "nav":
        e.preventDefault();
        return this._navigate(el.dataset.href);
      case "refresh":
        this._loadStatus();
        return this._load(this._sel, true).then(
          () => this._render(),
          (err) => {
            this._banner = { kind: "error", lines: [this._err(err)] };
            this._render();
          }
        );
      case "dismiss":
        this._banner = null;
        return this._render();
    }
  }

  _onChange(e) {
    const el = e.target;
    if (el.id === "np") {
      this._draft().notify_persistent = el.checked;
      return this._render();
    }
    if (el.dataset?.service) {
      const d = this._draft();
      const set = new Set(d.notify_services);
      el.checked ? set.add(el.dataset.service) : set.delete(el.dataset.service);
      d.notify_services = [...set];
      return this._render();
    }
    if (el.id === "sidebar") return this._setSidebar(el.checked);
  }

  _renderAccounts() {
    const sel = this.shadowRoot.querySelector("#account");
    if (!sel) return;
    sel.hidden = this._entries.length < 2;
    sel.innerHTML = this._entries
      .map((e) => `<option value="${esc(e.entry_id)}" ${e.entry_id === this._entryId ? "selected" : ""}>${esc(e.title)}</option>`)
      .join("");
  }

  _render() {
    const root = this.shadowRoot;
    if (!root.querySelector("#tree")) return;
    this._renderAccounts();
    root.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === this._tab)));
    root.querySelectorAll(".pane").forEach((p) => (p.hidden = p.dataset.pane !== this._tab));
    root.querySelector("#banner").innerHTML = this._banner
      ? `<div class="banner ${this._banner.kind}"><div>${this._banner.lines.map(esc).join("<br>")}</div>
           <button class="icon-btn small" data-act="dismiss" title="OK"><ha-icon icon="mdi:close"></ha-icon></button></div>`
      : "";
    this._renderStatus();
    if (this._tab === "folders") {
      this._renderTree();
      this._renderMain();
      this._renderFooter();
    } else if (this._tab === "notify") {
      this._renderNotify();
    } else {
      this._renderSettings();
    }
  }

  _renderStatus() {
    const t = this._t;
    const el = this.shadowRoot.querySelector("#status");
    const s = this._status;
    const entry = this._entry;
    if (!entry) {
      el.innerHTML = "";
      return;
    }
    if (s?.reauth_needed || (s && !s.loaded)) {
      const reauth = !!s.reauth_needed;
      el.innerHTML = `
        <div class="status-card alert">
          <ha-icon icon="${reauth ? "mdi:account-key-outline" : "mdi:cloud-off-outline"}"></ha-icon>
          <div class="grow">
            <div class="status-title">${reauth ? t.reauthTitle : t.notLoadedState}</div>
            <div class="muted">${reauth ? t.reauthText : t.notLoadedText}</div>
            <div class="muted small">${esc(s.account || entry.title)}</div>
          </div>
          <button class="btn primary" data-act="nav" data-href="${INTEGRATION_URL}">
            <ha-icon icon="mdi:login"></ha-icon>${reauth ? t.reauthButton : t.openIntegration}</button>
        </div>`;
      return;
    }
    const last = s?.last_backup;
    const pill = !s
      ? `<span class="pill">${t.loading}</span>`
      : s.error
        ? `<span class="pill bad"><ha-icon icon="mdi:alert-circle-outline"></ha-icon>${t.statusError}</span>`
        : `<span class="pill good"><ha-icon icon="mdi:check-circle"></ha-icon>${t.connected}</span>`;
    el.innerHTML = `
      <div class="status-card">
        <div class="status-head">
          <div class="who"><ha-icon icon="mdi:apple-icloud"></ha-icon><span>${esc(s?.account || entry.title)}</span></div>
          ${pill}
        </div>
        ${s?.error ? `<div class="muted small">${esc(s.error)}</div>` : ""}
        <div class="stats">
          <button class="stat link-stat" data-act="show-folder" title="${t.tabs.folders}">
            <span class="label">${t.folder}</span>
            <span class="value"><ha-icon icon="mdi:folder"></ha-icon>${esc(pretty(s?.folder ?? this._current))}</span>
          </button>
          <div class="stat">
            <span class="label">${t.lastBackup}</span>
            <span class="value">${
              last
                ? `${this._ago(last.date)}<small>${this._date(last.date)} · ${this._size(last.size)}</small>`
                : s && s.backups === 0
                  ? t.noBackupYet
                  : "–"
            }</span>
          </div>
          <div class="stat">
            <span class="label">${t.backupCount}</span>
            <span class="value num">${s?.backups ?? "–"}</span>
          </div>
        </div>
      </div>`;
  }

  _renderTree() {
    const t = this._t;
    const el = this.shadowRoot.querySelector("#tree");
    if (!this._entry?.loaded) {
      el.innerHTML = "";
      return;
    }
    if (this._query) {
      if (this._treeLoading || !this._tree) {
        el.innerHTML = `<div class="muted pad">${t.searching}</div>`;
        return;
      }
      const q = this._query.toLowerCase();
      const hits = this._tree.paths.filter((p) => p.toLowerCase().includes(q)).slice(0, 150);
      el.innerHTML =
        (hits.length
          ? hits
              .map((p) => {
                const segs = p.split("/");
                const last = segs.pop();
                return `<div class="node hit ${p === this._sel ? "sel" : ""}" tabindex="0" data-act="go" data-path="${esc(p)}">
                  <ha-icon icon="mdi:folder"></ha-icon>
                  <span class="hit-text"><b>${esc(last)}</b>${segs.length ? `<small>${esc(segs.join(" › "))}</small>` : ""}</span>
                  ${p === this._current ? `<span class="dot" title="${t.currentShort}"></span>` : ""}
                </div>`;
              })
              .join("")
          : `<div class="muted pad">${t.noResults}</div>`) +
        (this._tree.truncated ? `<div class="muted pad small">${t.truncated}</div>` : "");
      return;
    }
    const nodeHtml = (path, name, depth, isRoot = false) => {
      const data = this._cache.get(path);
      const open = this._open.has(path);
      const loading = this._loading.has(path);
      const leaf = data && data.folders.length === 0;
      const twisty = leaf
        ? `<span class="tw"></span>`
        : `<span class="tw" data-act="toggle" data-path="${esc(path)}">${
            loading ? `<span class="spin"></span>` : `<ha-icon icon="mdi:chevron-${open ? "down" : "right"}"></ha-icon>`
          }</span>`;
      let html = `<div class="node ${path === this._sel ? "sel" : ""}" tabindex="0" data-act="go" data-path="${esc(path)}"
          style="padding-left:${4 + depth * 16}px">${twisty}
          <ha-icon icon="${isRoot ? "mdi:cloud-outline" : open && data ? "mdi:folder-open" : "mdi:folder"}"></ha-icon>
          <span class="label">${esc(name)}</span>
          ${path === this._current ? `<span class="dot" title="${t.currentShort}"></span>` : ""}
        </div>`;
      if (open && data) html += data.folders.map((f) => nodeHtml(join(path, f.name), f.name, depth + 1)).join("");
      return html;
    };
    el.innerHTML = nodeHtml("", "iCloud Drive", 0, true);
  }

  _renderMain() {
    const t = this._t;
    const el = this.shadowRoot.querySelector("#main");
    if (!this._entry?.loaded) {
      el.innerHTML = `<div class="muted">${t.foldersUnavailable}</div>`;
      return;
    }
    const segs = this._sel ? this._sel.split("/") : [];
    const crumbs = ["iCloud Drive", ...segs]
      .map((s, i) =>
        i === segs.length
          ? `<b>${esc(s)}</b>`
          : `<button class="link" data-act="go" data-path="${esc(segs.slice(0, i).join("/"))}">${esc(s)}</button><ha-icon class="sep" icon="mdi:chevron-right"></ha-icon>`
      )
      .join("");
    const data = this._cache.get(this._sel);
    const loading = this._loading.has(this._sel);
    let body = "";
    if (!data) {
      body = `<div class="muted">${loading ? t.loading : ""}</div>`;
    } else {
      const tiles = data.folders.length
        ? `<div class="tiles">${data.folders
            .map(
              (f) => `<button class="tile" data-act="go" data-path="${esc(join(this._sel, f.name))}">
                <ha-icon icon="mdi:folder"></ha-icon>
                <span class="tile-name">${esc(f.name)}</span>
                ${f.items != null ? `<small>${t.items(f.items)}</small>` : ""}
                ${join(this._sel, f.name) === this._current ? `<span class="chip">${t.currentShort}</span>` : ""}
              </button>`
            )
            .join("")}</div>`
        : `<div class="muted">${t.noFolders}</div>`;
      const backups = data.backups.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>${t.colName}</th><th>${t.colDate}</th><th class="num">${t.colSize}</th></tr></thead>
            <tbody>${data.backups
              .map(
                (b) => `<tr>
                  <td><ha-icon icon="mdi:archive-outline"></ha-icon> ${esc(b.name)}${b.ha_backup ? "" : ` <span class="chip warn">${t.noMeta}</span>`}</td>
                  <td>${this._date(b.modified)}</td>
                  <td class="num">${this._size(b.size)}</td></tr>`
              )
              .join("")}</tbody></table></div>`
        : `<div class="muted">${this._sel ? t.noBackups : t.rootHint}</div>`;
      body = `
        <h3>${t.folders}</h3>${tiles}
        <h3>${t.backupsTitle}</h3>${backups}
        ${data.other_files ? `<div class="muted small">${t.otherFiles(data.other_files)}</div>` : ""}`;
    }
    el.innerHTML = `
      <div class="crumbs">${crumbs}
        <button class="icon-btn small" data-act="refresh" title="${t.refresh}"><ha-icon icon="mdi:refresh"></ha-icon></button>
      </div>
      ${this._sel && this._sel === this._current ? `<div class="banner ok slim"><ha-icon icon="mdi:check-circle"></ha-icon>${t.current}</div>` : ""}
      ${body}
      <div class="newfolder">
        <input id="newname" placeholder="${t.newFolderPh}" aria-label="${t.newFolder}" ${this._busy ? "disabled" : ""}>
        <button class="btn" data-act="create" ${this._busy ? "disabled" : ""}><ha-icon icon="mdi:folder-plus-outline"></ha-icon>${t.create}</button>
      </div>`;
  }

  _renderFooter() {
    const t = this._t;
    const el = this.shadowRoot.querySelector("#footer");
    if (!this._entry?.loaded) {
      el.innerHTML = "";
      return;
    }
    const canUse = this._sel && this._sel !== this._current && !this._busy;
    el.innerHTML = `
      <div class="sel-info">${t.selected}: <b>${esc(pretty(this._sel))}</b></div>
      <button class="btn primary" data-act="use" ${canUse ? "" : "disabled"}><ha-icon icon="mdi:check"></ha-icon>${t.use}</button>`;
  }

  _renderNotify() {
    const t = this._t;
    const el = this.shadowRoot.querySelector("#notify");
    const d = this._draft();
    if (!d) {
      el.innerHTML = `<div class="muted">${t.loading}</div>`;
      return;
    }
    const services = this._status.notify_services_available || [];
    const chosen = new Set(d.notify_services);
    // Keep services that were chosen earlier but are gone now visible, so they can be removed.
    const all = [...new Set([...services, ...d.notify_services])];
    el.innerHTML = `
      <p class="muted intro">${t.notifyIntro}</p>
      <label class="setting">
        <span class="text"><b>${t.notifyPersistent}</b><small>${t.notifyPersistentHint}</small></span>
        <input type="checkbox" class="switch" id="np" ${d.notify_persistent ? "checked" : ""}>
      </label>
      <div class="setting col">
        <span class="text"><b>${t.notifyPush}</b><small>${services.length ? t.notifyPushHint : t.noServices}</small></span>
        ${
          all.length
            ? `<div class="services">${all
                .map(
                  (s) => `<label class="svc ${services.includes(s) ? "" : "gone"}">
                    <input type="checkbox" data-service="${esc(s)}" ${chosen.has(s) ? "checked" : ""}>
                    <ha-icon icon="${s.startsWith("mobile_app_") ? "mdi:cellphone" : "mdi:message-outline"}"></ha-icon>
                    <span>${esc(s.replace(/^mobile_app_/, ""))}<small>notify.${esc(s)}</small></span>
                  </label>`
                )
                .join("")}</div>`
            : ""
        }
      </div>
      <div class="row-actions">
        <button class="btn" data-act="test-notify" ${this._busy ? "disabled" : ""}><ha-icon icon="mdi:bell-ring-outline"></ha-icon>${t.sendTest}</button>
        <button class="btn primary" data-act="save-notify" ${this._busy || !this._notifyDirty() ? "disabled" : ""}><ha-icon icon="mdi:content-save-outline"></ha-icon>${t.save}</button>
      </div>`;
  }

  _renderSettings() {
    const t = this._t;
    const el = this.shadowRoot.querySelector("#settings");
    const s = this._status;
    if (!s?.options) {
      el.innerHTML = `<div class="muted">${t.loading}</div>`;
      return;
    }
    const cr = this._checkResult;
    el.innerHTML = `
      <label class="setting">
        <span class="text"><b>${t.sidebar}</b><small>${t.sidebarHint}</small></span>
        <input type="checkbox" class="switch" id="sidebar" ${s.options.show_panel ? "checked" : ""}>
      </label>
      <div class="setting">
        <span class="text"><b>${t.checkTitle}</b><small>${t.checkHint}</small></span>
        <button class="btn" data-act="check" ${this._busy || !s.loaded ? "disabled" : ""}><ha-icon icon="mdi:stethoscope"></ha-icon>${t.check}</button>
      </div>
      ${
        cr
          ? `<div class="banner ${cr.kind}"><div>${cr.title ? `<b>${esc(cr.title)}</b><br>` : ""}${cr.lines.map(esc).join("<br>")}</div></div>`
          : ""
      }
      <h3>${t.links}</h3>
      <div class="links">
        <a class="linkrow" href="${BACKUP_SETTINGS_URL}" data-act="nav" data-href="${BACKUP_SETTINGS_URL}">
          <ha-icon icon="mdi:backup-restore"></ha-icon><span><b>${t.linkBackup}</b><small>${t.linkBackupHint}</small></span><ha-icon icon="mdi:chevron-right"></ha-icon></a>
        <a class="linkrow" href="${INTEGRATION_URL}" data-act="nav" data-href="${INTEGRATION_URL}">
          <ha-icon icon="mdi:account-cog-outline"></ha-icon><span><b>${t.linkAccount}</b><small>${t.linkAccountHint}</small></span><ha-icon icon="mdi:chevron-right"></ha-icon></a>
      </div>
      <div class="muted small version">iCloud Drive Backup · ${t.version} ${esc(s.version || "")}</div>`;
  }

  _ago(value) {
    const d = new Date(value);
    if (!value || isNaN(d)) return "–";
    const t = this._t;
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return t.justNow;
    const [v, u] = mins < 60 ? [mins, "m"] : mins < 60 * 48 ? [Math.round(mins / 60), "h"] : [Math.round(mins / 1440), "d"];
    return t.ago(v, t.units[u][v === 1 ? 0 : 1]);
  }

  _date(value) {
    if (!value) return "–";
    const d = new Date(value);
    if (isNaN(d)) return esc(value);
    return d.toLocaleString(this._hass.locale?.language || this._hass.language, { dateStyle: "medium", timeStyle: "short" });
  }

  _size(bytes) {
    if (bytes == null) return "–";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toLocaleString(this._hass.language, { maximumFractionDigits: i > 1 ? 1 : 0 })} ${units[i]}`;
  }
}

const STYLE = `
  :host { display: block; min-height: 100vh; background: var(--primary-background-color); color: var(--primary-text-color);
    font-family: var(--paper-font-body1_-_font-family, Roboto, system-ui, sans-serif); --gap: 16px; }
  [hidden] { display: none !important; }
  ha-icon { --mdc-icon-size: 20px; flex: none; }
  .toolbar { display: flex; align-items: center; gap: 12px; height: var(--header-height, 56px); padding: 0 12px;
    background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff);
    position: sticky; top: 0; z-index: 2; box-sizing: border-box; }
  .toolbar .title { display: flex; align-items: center; gap: 10px; font-size: 20px; margin-right: auto; white-space: nowrap; }
  .toolbar select { font: inherit; padding: 6px 8px; border-radius: 8px; border: 0; max-width: 50vw; }
  .icon-btn { background: none; border: 0; color: inherit; cursor: pointer; padding: 6px; border-radius: 50%; display: inline-flex; }
  .icon-btn:hover { background: rgba(127,127,127,.15); }
  .icon-btn.small { padding: 4px; }
  .content { padding: var(--gap); max-width: 1200px; margin: 0 auto; box-sizing: border-box; display: grid; gap: 14px; }
  .card { background: var(--card-background-color); border-radius: var(--ha-card-border-radius, 12px);
    border: 1px solid var(--divider-color); box-shadow: var(--ha-card-box-shadow, none); overflow: hidden; }
  .card.padded { padding: 8px var(--gap) var(--gap); }

  /* status card */
  .status-card { background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: var(--ha-card-border-radius, 12px);
    padding: 14px var(--gap); display: grid; gap: 12px; }
  .status-card.alert { display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    border-color: var(--warning-color, #ffa600); background: rgba(var(--rgb-warning-color, 255,166,0), .10); }
  .status-card.alert > ha-icon { --mdc-icon-size: 32px; color: var(--warning-color, #ffa600); }
  .status-card .grow { flex: 1; min-width: 220px; display: grid; gap: 4px; }
  .status-title { font-size: 17px; font-weight: 500; }
  .status-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .who { display: flex; align-items: center; gap: 8px; font-weight: 500; min-width: 0; overflow-wrap: anywhere; }
  .who ha-icon { color: var(--primary-color); }
  .pill { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; padding: 4px 10px; border-radius: 999px;
    background: var(--secondary-background-color); color: var(--secondary-text-color); }
  .pill ha-icon { --mdc-icon-size: 16px; }
  .pill.good { background: rgba(var(--rgb-success-color, 67,160,71), .15); color: var(--success-color, #43a047); }
  .pill.bad { background: rgba(var(--rgb-error-color, 219,68,55), .14); color: var(--error-color, #db4437); }
  .stats { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 2fr) minmax(0, 1fr); gap: 10px; }
  .stat { display: grid; gap: 4px; align-content: start; padding: 10px 12px; border-radius: 10px; background: var(--secondary-background-color);
    text-align: left; font: inherit; color: inherit; border: 1px solid transparent; min-width: 0; }
  .link-stat { cursor: pointer; }
  .link-stat:hover { border-color: var(--primary-color); }
  .stat .label { font-size: 12px; color: var(--secondary-text-color); }
  .stat .value { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 15px; font-weight: 500; overflow-wrap: anywhere; }
  .stat .value ha-icon { color: var(--primary-color); }
  .stat .value small { width: 100%; font-size: 12px; font-weight: 400; color: var(--secondary-text-color); }
  .stat .value.num { font-size: 22px; font-variant-numeric: tabular-nums; }

  /* tabs */
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--divider-color); overflow-x: auto; }
  .tab { font: inherit; font-weight: 500; background: none; border: 0; border-bottom: 2px solid transparent; color: var(--secondary-text-color);
    padding: 10px 14px; cursor: pointer; white-space: nowrap; }
  .tab[aria-selected="true"] { color: var(--primary-color); border-bottom-color: var(--primary-color); }
  .tab:hover { color: var(--primary-text-color); }

  /* folders */
  .cardbar { display: flex; justify-content: flex-end; padding: 10px 12px; border-bottom: 1px solid var(--divider-color); }
  .search-wrap { display: flex; align-items: center; gap: 6px; background: var(--secondary-background-color); border-radius: 18px; padding: 4px 12px; }
  .search-wrap ha-icon { color: var(--secondary-text-color); }
  .search-wrap input { font: inherit; color: inherit; background: transparent; border: 0; outline: 0; width: 220px; max-width: 50vw; }
  .grid { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 50vh; }
  .tree { border-right: 1px solid var(--divider-color); padding: 8px 6px; overflow: auto; max-height: 70vh; }
  .node { display: flex; align-items: center; gap: 6px; padding: 5px 8px 5px 4px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
  .node:hover { background: var(--secondary-background-color); }
  .node:focus-visible, .btn:focus-visible, .tile:focus-visible, .link:focus-visible, .tab:focus-visible, .stat:focus-visible, .linkrow:focus-visible {
    outline: 2px solid var(--primary-color); outline-offset: 1px; }
  .node.sel { background: rgba(var(--rgb-primary-color, 3,169,244), .15); color: var(--primary-color); font-weight: 500; }
  .node .label { overflow: hidden; text-overflow: ellipsis; }
  .node ha-icon { color: var(--primary-color); }
  .tw { width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 4px; }
  .tw ha-icon { color: var(--secondary-text-color); }
  .tw:hover { background: rgba(127,127,127,.2); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success-color, #43a047); margin-left: auto; flex: none; }
  .hit { align-items: flex-start; padding-left: 8px; }
  .hit-text { display: grid; min-width: 0; }
  .hit-text small { color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; }
  .main { padding: var(--gap); display: grid; gap: 12px; align-content: start; min-width: 0; }
  h3 { margin: 10px 0 0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: .05em; color: var(--secondary-text-color); }
  .crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; font-size: 15px; }
  .crumbs .sep { --mdc-icon-size: 16px; color: var(--secondary-text-color); }
  .crumbs .icon-btn { margin-left: auto; color: var(--secondary-text-color); }
  .link { font: inherit; background: none; border: 0; color: var(--primary-color); cursor: pointer; padding: 2px 4px; border-radius: 4px; }
  .link:hover { text-decoration: underline; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .tile { font: inherit; color: inherit; text-align: left; background: var(--card-background-color); border: 1px solid var(--divider-color);
    border-radius: 10px; padding: 12px; cursor: pointer; display: grid; gap: 4px; justify-items: start; }
  .tile:hover { border-color: var(--primary-color); }
  .tile ha-icon { --mdc-icon-size: 30px; color: var(--primary-color); }
  .tile-name { font-weight: 500; word-break: break-word; }
  .tile small { color: var(--secondary-text-color); }
  .chip { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(var(--rgb-success-color, 67,160,71), .15); color: var(--success-color, #43a047); white-space: nowrap; }
  .chip.warn { background: rgba(var(--rgb-warning-color, 255,166,0), .15); color: var(--warning-color, #ffa600); }
  .table-wrap { overflow-x: auto; border: 1px solid var(--divider-color); border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--divider-color); white-space: nowrap; }
  th { font-weight: 500; font-size: 12px; color: var(--secondary-text-color); background: var(--secondary-background-color); }
  tr:last-child td { border-bottom: 0; }
  td ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); vertical-align: -3px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: var(--secondary-text-color); }
  .small { font-size: 12px; }
  .pad { padding: 8px; }
  .banner { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; padding: 10px 12px; border-radius: 10px; line-height: 1.5;
    background: rgba(var(--rgb-primary-color, 3,169,244), .12); }
  .banner.ok { background: rgba(var(--rgb-success-color, 67,160,71), .14); color: var(--success-color, #43a047); }
  .banner.warn { background: rgba(var(--rgb-warning-color, 255,166,0), .16); }
  .banner.error { background: rgba(var(--rgb-error-color, 219,68,55), .14); color: var(--error-color, #db4437); }
  .banner.slim { justify-content: flex-start; align-items: center; padding: 8px 12px; }
  .newfolder { display: flex; gap: 8px; margin-top: 4px; }
  .newfolder input { flex: 1; min-width: 0; font: inherit; color: var(--primary-text-color); background: var(--secondary-background-color);
    border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 10px; }
  .btn { font: inherit; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-color); white-space: nowrap; }
  .btn.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .btn:disabled { opacity: .45; cursor: default; }
  .footer { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; padding: 12px var(--gap);
    border-top: 1px solid var(--divider-color); background: var(--secondary-background-color); }
  .sel-info { min-width: 0; overflow-wrap: anywhere; }

  /* notify + settings */
  .intro { margin: 8px 0 4px; max-width: 70ch; }
  .setting { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--divider-color); }
  .setting.col { flex-direction: column; align-items: stretch; }
  .setting .text { display: grid; gap: 2px; min-width: 0; }
  .setting small, .svc small, .linkrow small { color: var(--secondary-text-color); font-size: 12px; }
  .switch { appearance: none; -webkit-appearance: none; width: 40px; height: 22px; border-radius: 11px; background: var(--divider-color);
    position: relative; cursor: pointer; flex: none; margin: 0; transition: background .15s; }
  .switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff;
    box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: transform .15s; }
  .switch:checked { background: var(--primary-color); }
  .switch:checked::after { transform: translateX(18px); }
  .switch:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .services { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
  .svc { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--divider-color); border-radius: 10px; cursor: pointer; }
  .svc:has(input:checked) { border-color: var(--primary-color); background: rgba(var(--rgb-primary-color, 3,169,244), .08); }
  .svc.gone { opacity: .6; }
  .svc input { accent-color: var(--primary-color); margin: 0; }
  .svc ha-icon { color: var(--primary-color); }
  .svc span { display: grid; min-width: 0; overflow-wrap: anywhere; }
  .row-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; padding-top: 14px; }
  .links { display: grid; gap: 8px; margin-top: 8px; }
  .linkrow { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--divider-color); border-radius: 10px;
    color: inherit; text-decoration: none; }
  .linkrow:hover { border-color: var(--primary-color); }
  .linkrow > ha-icon:first-child { color: var(--primary-color); }
  .linkrow span { display: grid; flex: 1; min-width: 0; }
  .linkrow > ha-icon:last-child { color: var(--secondary-text-color); }
  .version { margin-top: 14px; }
  .spin { width: 12px; height: 12px; border: 2px solid var(--divider-color); border-top-color: var(--primary-color); border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 3s; } .switch, .switch::after { transition: none; } }
  @media (max-width: 700px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
    .tree { border-right: 0; border-bottom: 1px solid var(--divider-color); max-height: 260px; }
    .stats { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .stats .link-stat { grid-column: 1 / -1; }
    .search-wrap { flex: 1; }
    .search-wrap input { width: 100%; max-width: none; }
    .toolbar .title span { display: none; }
    .content { padding: 8px; }
  }
`;

customElements.get("icloud-backup-panel") || customElements.define("icloud-backup-panel", ICloudBackupPanel);
