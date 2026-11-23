/*
 * iCloud Backup explorer panel for the "iCloud Drive Backup" integration.
 * Plain web component (no build step). Talks to the integration via the
 * admin-only WebSocket commands "icloud_drive_backup/*".
 */

const I18N = {
  de: {
    title: "iCloud Backup",
    account: "Konto",
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
    check: "Ordner prüfen",
    checking: "Prüfe Ordner …",
    checkOk: (n) => `Ordner gefunden und lesbar (${n} Backup${n === 1 ? "" : "s"})`,
    writeOk: "Schreibtest erfolgreich (Testdatei angelegt und gelöscht)",
    writeFail: "Schreibtest fehlgeschlagen",
    missing: "Der Backup-Ordner existiert nicht (er wird beim nächsten Backup angelegt).",
    rootHint: "Wähle oder lege einen Ordner an. Backups können nicht direkt in der obersten Ebene liegen.",
    notLoaded: "Die Integration ist nicht geladen. Bitte unter Einstellungen → Geräte & Dienste erneut authentifizieren.",
    noEntries: "Es ist noch kein iCloud-Konto eingerichtet.",
    refresh: "Neu laden",
    error: "Fehler",
  },
  en: {
    title: "iCloud Backup",
    account: "Account",
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
    check: "Check folder",
    checking: "Checking folder …",
    checkOk: (n) => `Folder found and readable (${n} backup${n === 1 ? "" : "s"})`,
    writeOk: "Write test passed (test file created and deleted)",
    writeFail: "Write test failed",
    missing: "The backup folder does not exist (it will be created on the next backup).",
    rootHint: "Pick or create a folder. Backups cannot be stored directly in the top level.",
    notLoaded: "The integration is not loaded. Please re-authenticate it under Settings → Devices & services.",
    noEntries: "No iCloud account is set up yet.",
    refresh: "Reload",
    error: "Error",
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

class ICloudBackupPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._started = false;
    this._entries = [];
    this._entryId = null;
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
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._started) {
      this._started = true;
      this._t = I18N[(hass.language || "en").startsWith("de") ? "de" : "en"];
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
    const search = this.shadowRoot.querySelector("#search");
    if (search) search.value = "";
    this._banner = null;
    const entry = this._entries.find((e) => e.entry_id === entryId);
    if (!entry) {
      this._banner = { kind: "info", lines: [this._t.noEntries] };
      return this._render();
    }
    if (!entry.loaded) {
      this._banner = { kind: "error", lines: [this._t.notLoaded] };
      return this._render();
    }
    this._current = entry.folder || "";
    await this._goto(this._current);
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
        // Configured folder does not exist yet: show its nearest existing parent.
        this._banner = { kind: "warn", lines: [this._t.missing] };
        return this._goto(parentOf(path));
      }
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
      // The integration reloads with the new folder; refresh the account list.
      setTimeout(async () => {
        try {
          this._entries = await this._hass.callWS({ type: "icloud_drive_backup/entries" });
          this._renderAccounts();
        } catch (_) {}
      }, 2500);
    } catch (err) {
      this._banner = { kind: "error", lines: [this._err(err)] };
    }
    this._busy = false;
    this._render();
  }

  async _check() {
    this._busy = true;
    this._banner = { kind: "info", lines: [this._t.checking] };
    this._render();
    try {
      const r = await this._ws("check", { write_test: true });
      const t = this._t;
      if (r.error && !r.exists) this._banner = { kind: "error", lines: [r.error] };
      else if (!r.exists) this._banner = { kind: "warn", lines: [t.missing] };
      else {
        const lines = [`✓ ${t.checkOk(r.backups ?? 0)}`];
        lines.push(r.write_ok ? `✓ ${t.writeOk}` : `✗ ${t.writeFail}${r.error ? `: ${r.error}` : ""}`);
        this._banner = { kind: r.write_ok ? "ok" : "error", lines, title: r.path };
      }
      await this._load(this._current, true).catch(() => {});
    } catch (err) {
      this._banner = { kind: "error", lines: [this._err(err)] };
    }
    this._busy = false;
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
        <div class="search-wrap"><ha-icon icon="mdi:magnify"></ha-icon>
          <input id="search" type="search" placeholder="${t.search}" aria-label="${t.search}"></div>
      </div>
      <div class="content">
        <div class="card">
          <div class="grid">
            <nav class="tree" id="tree" aria-label="${t.folders}"></nav>
            <section class="main" id="main"></section>
          </div>
          <div class="footer" id="footer"></div>
        </div>
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
    root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.id === "newname") this._createFolder();
      if ((e.key === "Enter" || e.key === " ") && e.target.classList?.contains("node")) {
        e.preventDefault();
        e.target.click();
      }
    });
  }

  _onClick(e) {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const { act, path } = el.dataset;
    if (act === "toggle") {
      e.stopPropagation();
      return this._toggle(path);
    }
    if (act === "go") return this._goto(path);
    if (act === "create") return this._createFolder();
    if (act === "use") return this._use();
    if (act === "check") return this._check();
    if (act === "refresh") return this._load(this._sel, true).then(() => this._render(), (err) => {
      this._banner = { kind: "error", lines: [this._err(err)] };
      this._render();
    });
    if (act === "dismiss") {
      this._banner = null;
      return this._render();
    }
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
    if (!this.shadowRoot.querySelector("#tree")) return;
    this._renderAccounts();
    this._renderTree();
    this._renderMain();
    this._renderFooter();
  }

  _renderTree() {
    const t = this._t;
    const el = this.shadowRoot.querySelector("#tree");
    if (!this._entryId || !this._entries.find((e) => e.entry_id === this._entryId)?.loaded) {
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
      if (open && data) {
        html += data.folders.map((f) => nodeHtml(join(path, f.name), f.name, depth + 1)).join("");
      }
      return html;
    };
    el.innerHTML = nodeHtml("", "iCloud Drive", 0, true);
  }

  _renderMain() {
    const t = this._t;
    const el = this.shadowRoot.querySelector("#main");
    const banner = this._banner
      ? `<div class="banner ${this._banner.kind}">
           <div>${this._banner.title ? `<b>${esc(this._banner.title)}</b><br>` : ""}${this._banner.lines.map(esc).join("<br>")}</div>
           <button class="icon-btn small" data-act="dismiss" title="OK"><ha-icon icon="mdi:close"></ha-icon></button>
         </div>`
      : "";
    const entry = this._entries.find((e) => e.entry_id === this._entryId);
    if (!entry || !entry.loaded) {
      el.innerHTML = banner;
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
      ${banner}
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
    const entry = this._entries.find((e) => e.entry_id === this._entryId);
    if (!entry || !entry.loaded) {
      el.innerHTML = "";
      return;
    }
    const pretty = ["iCloud Drive", ...(this._sel ? this._sel.split("/") : [])].join(" › ");
    const canUse = this._sel && this._sel !== this._current && !this._busy;
    el.innerHTML = `
      <div class="sel-info">${t.selected}: <b>${esc(pretty)}</b></div>
      <div class="actions">
        <button class="btn" data-act="check" ${this._busy ? "disabled" : ""}><ha-icon icon="mdi:stethoscope"></ha-icon>${t.check}</button>
        <button class="btn primary" data-act="use" ${canUse ? "" : "disabled"}><ha-icon icon="mdi:check"></ha-icon>${t.use}</button>
      </div>`;
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
  .toolbar select { font: inherit; padding: 6px 8px; border-radius: 8px; border: 0; max-width: 40vw; }
  .search-wrap { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,.18); border-radius: 18px; padding: 4px 10px; }
  .search-wrap input { font: inherit; color: inherit; background: transparent; border: 0; outline: 0; width: 170px; }
  .search-wrap input::placeholder { color: inherit; opacity: .75; }
  .icon-btn { background: none; border: 0; color: inherit; cursor: pointer; padding: 6px; border-radius: 50%; display: inline-flex; }
  .icon-btn:hover { background: rgba(127,127,127,.15); }
  .icon-btn.small { padding: 4px; }
  .content { padding: var(--gap); max-width: 1200px; margin: 0 auto; box-sizing: border-box; }
  .card { background: var(--card-background-color); border-radius: var(--ha-card-border-radius, 12px);
    border: 1px solid var(--divider-color); box-shadow: var(--ha-card-box-shadow, none); overflow: hidden; }
  .grid { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 60vh; }
  .tree { border-right: 1px solid var(--divider-color); padding: 8px 6px; overflow: auto; max-height: 75vh; }
  .node { display: flex; align-items: center; gap: 6px; padding: 5px 8px 5px 4px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
  .node:hover { background: var(--secondary-background-color); }
  .node:focus-visible, .btn:focus-visible, .tile:focus-visible, .link:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
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
  .main h3 { margin: 6px 0 0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: .05em; color: var(--secondary-text-color); }
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
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .spin { width: 12px; height: 12px; border: 2px solid var(--divider-color); border-top-color: var(--primary-color); border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 3s; } }
  @media (max-width: 700px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
    .tree { border-right: 0; border-bottom: 1px solid var(--divider-color); max-height: 260px; }
    .search-wrap input { width: 110px; }
    .toolbar .title span { display: none; }
    .content { padding: 8px; }
  }
`;

customElements.get("icloud-backup-panel") || customElements.define("icloud-backup-panel", ICloudBackupPanel);
