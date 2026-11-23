# iCloud Drive Backup für Home Assistant

Custom Integration, die iCloud Drive als **Backup-Speicherort** in Home Assistant einbindet.
Nach der Einrichtung erscheint „iCloud Drive (…)“ unter **Einstellungen → System → Backups → Backup-Einstellungen → Speicherorte** – genau wie Google Drive oder OneDrive. Automatische und manuelle Backups können dann direkt in deinen iCloud Drive hochgeladen, von dort wiederhergestellt und gelöscht werden.

## Voraussetzungen

- Home Assistant **2025.5** oder neuer
- Apple-ID mit Zwei-Faktor-Authentifizierung (Standard)
- Auf dem iPhone unter **Einstellungen → [Dein Name] → iCloud**:
  - **„Auf iCloud-Daten im Web zugreifen“** = an
  - **„Erweiterter Datenschutz“ (Advanced Data Protection)** = aus
  
  (Ohne diese Einstellungen erlaubt Apple keinen Zugriff über die iCloud-Web-API.)
- Hardware-Sicherheitsschlüssel als einzige 2FA-Methode werden nicht unterstützt.

## Installation

### Über HACS (empfohlen)

[![In HACS öffnen](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Biolaxy&repository=icloud-drive-backup&category=integration)

1. Auf den Button oben klicken – oder in HACS → ⋮ → **Benutzerdefinierte Repositories** →
   `https://github.com/Biolaxy/icloud-drive-backup` eintragen, Typ **Integration**.
2. „iCloud Drive Backup“ herunterladen.
3. Home Assistant neu starten.

### Manuell
1. Den Ordner `custom_components/icloud_drive_backup` nach `/config/custom_components/` kopieren
   (z. B. per Samba- oder File-Editor-Add-on).
2. Home Assistant neu starten.

## Einrichtung

1. **Einstellungen → Geräte & Dienste → Integration hinzufügen → „iCloud Drive Backup“**
2. Apple-ID, Passwort und Zielordner eingeben (Standard: `Home Assistant Backups`).
3. Den 6-stelligen Code eingeben, der auf deinem iPhone/Mac erscheint.
4. **Einstellungen → System → Backups → Backup-Einstellungen** öffnen und iCloud Drive als Speicherort aktivieren.

## Alles an einer Stelle: „iCloud Backup“ in der Seitenleiste

Nach der Einrichtung erscheint in der Seitenleiste **iCloud Backup** (nur für Admins).

**Oben – Status auf einen Blick:** Konto, aktueller Backup-Ordner, letztes Backup in iCloud (wann, wie groß) und Anzahl der Backups. Ist die Anmeldung abgelaufen, steht hier ein deutlicher Hinweis mit **„Jetzt neu anmelden“**.

**Tab „Ordner“** – Explorer für dein iCloud Drive:
- Ordnerbaum zum Auf- und Zuklappen, rechts der Inhalt mit den Backups (Datum, Größe)
- Suche über alle Ordner, neuen Unterordner anlegen
- **Als Backup-Ordner verwenden** – gilt sofort; der aktuelle Ordner ist mit einem grünen Punkt markiert

**Tab „Benachrichtigungen“** – wie du erfährst, dass du dich neu anmelden musst:
- Hinweis in Home Assistant (Glocke, standardmäßig an)
- Push-Nachricht an ausgewählte Geräte (Home-Assistant-App, WhatsApp …) – Tippen öffnet die Integration
- Testnachricht senden

**Tab „Einstellungen“:**
- In der Seitenleiste anzeigen / ausblenden (ausgeblendet erreichbar über *Einstellungen → Geräte & Dienste → iCloud Drive Backup → Konfigurieren*)
- Ordner prüfen (Lese- und Schreibtest)
- Links zu den Backup-Einstellungen von Home Assistant und zur Kontoverwaltung

Vorhandene Backups werden bei einem Ordnerwechsel nicht verschoben. Pro abgelaufener Sitzung kommt eine Benachrichtigung; nach erfolgreicher Anmeldung verschwindet der Hinweis automatisch.

## Wie es funktioniert

- Pro Backup werden zwei Dateien im Zielordner abgelegt:
  - `<Name>_<ID>.tar` – das eigentliche Home-Assistant-Backup
  - `<Name>_<ID>.metadata.json` – Metadaten, damit HA das Backup ohne Download auflisten kann
- Uploads werden gestreamt (die Backup-Datei wird nicht komplett in den Arbeitsspeicher geladen); während des Uploads liegt eine temporäre Kopie im Temp-Verzeichnis.
- Gelöschte Backups landen in iCloud Drive unter **„Zuletzt gelöscht“** und werden von Apple nach 30 Tagen endgültig entfernt.
- Die HA-Backup-Verschlüsselung bleibt erhalten – wenn sie aktiv ist, liegen in iCloud nur verschlüsselte Backups.

## Wichtige Hinweise

- Apple bietet **keine offizielle API** für iCloud Drive. Die Integration nutzt die Bibliothek [`pyicloud`](https://github.com/timlaing/pyicloud), die die iCloud-Weboberfläche nachbildet. Apple kann das jederzeit ändern.
- Die vertrauenswürdige Sitzung läuft nach einiger Zeit ab (typischerweise ca. 2 Monate). Home Assistant zeigt dann unter **Einstellungen → Reparaturen** bzw. bei der Integration „Erneut authentifizieren“ an – Passwort + neuen 2FA-Code eingeben.
- Sitzungs-Cookies werden unter `/config/.storage/icloud_drive_backup/` gespeichert.
- Ein **app-spezifisches Passwort funktioniert nicht**: Apple akzeptiert diese nur für Protokolle wie CalDAV, CardDAV und IMAP, nicht für die iCloud-Web-Anmeldung, über die iCloud Drive läuft. Es wird das normale Apple-ID-Passwort benötigt (es bleibt lokal in Home Assistant gespeichert).

## Fehlersuche

Debug-Logging aktivieren in `configuration.yaml`:

```yaml
logger:
  logs:
    custom_components.icloud_drive_backup: debug
    pyicloud: info
```
