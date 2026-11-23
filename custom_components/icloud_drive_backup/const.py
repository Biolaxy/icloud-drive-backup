"""Constants for the iCloud Drive Backup integration."""

from __future__ import annotations

from typing import TYPE_CHECKING

from homeassistant.util.hass_dict import HassKey

if TYPE_CHECKING:
    from collections.abc import Callable

DOMAIN = "icloud_drive_backup"

CONF_FOLDER = "folder"
CONF_VERIFICATION_CODE = "verification_code"
CONF_CHINA_MAINLAND = "china_mainland"
CONF_SHOW_PANEL = "show_panel"
CONF_NOTIFY_PERSISTENT = "notify_persistent"
CONF_NOTIFY_SERVICES = "notify_services"

DEFAULT_FOLDER = "Home Assistant Backups"

DATA_BACKUP_AGENT_LISTENERS: HassKey[list[Callable[[], None]]] = HassKey(
    f"{DOMAIN}.backup_agent_listeners"
)

# File name suffixes used inside the iCloud Drive folder.
BACKUP_SUFFIX = ".tar"
METADATA_SUFFIX = ".metadata.json"

# Chunk size used when streaming data between Home Assistant and iCloud.
CHUNK_SIZE = 1024 * 1024

# Explorer panel in the sidebar.
PANEL_URL_PATH = "icloud-backup"
PANEL_WEBCOMPONENT = "icloud-backup-panel"
STATIC_URL = f"/{DOMAIN}_static"
