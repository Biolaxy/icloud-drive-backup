"""iCloud Drive Backup: store Home Assistant backups in iCloud Drive."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from homeassistant.components import panel_custom
from homeassistant.components.frontend import async_remove_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import (
    ConfigEntryAuthFailed,
    ConfigEntryError,
    ConfigEntryNotReady,
)
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import slugify

from .api import (
    ICloudDriveAuthError,
    ICloudDriveClient,
    ICloudDriveConnectionError,
    ICloudDriveError,
    ICloudDriveUnavailableError,
    ICloudDriveUnsupportedAuthError,
)
from .const import (
    CONF_CHINA_MAINLAND,
    CONF_FOLDER,
    CONF_SHOW_PANEL,
    DATA_BACKUP_AGENT_LISTENERS,
    DEFAULT_FOLDER,
    DOMAIN,
    PANEL_URL_PATH,
    PANEL_WEBCOMPONENT,
    STATIC_URL,
)
from .notify import async_clear_reauth, async_notify_reauth
from .websocket import async_register_websocket_commands

_LOGGER = logging.getLogger(__name__)

ICloudDriveConfigEntry = ConfigEntry  # runtime_data: ICloudDriveClient

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

_FRONTEND_DIR = Path(__file__).parent / "frontend"
_VERSION = json.loads((Path(__file__).parent / "manifest.json").read_text())["version"]
_PANEL_FLAG = f"{DOMAIN}_panel_registered"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the explorer panel's WebSocket API and static files."""
    async_register_websocket_commands(hass)
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL, str(_FRONTEND_DIR), cache_headers=False)]
    )
    return True


def _sidebar_wanted(hass: HomeAssistant) -> bool:
    """Show the sidebar entry unless every account has turned it off."""
    entries = [
        e for e in hass.config_entries.async_entries(DOMAIN) if not e.disabled_by
    ]
    return any(e.options.get(CONF_SHOW_PANEL, True) for e in entries)


async def _async_register_panel(hass: HomeAssistant) -> None:
    """Register the explorer panel (admins only).

    When the sidebar entry is turned off the panel stays registered without a
    sidebar item, so it can still be opened via /icloud-backup (linked from the
    options dialog).
    """
    show = _sidebar_wanted(hass)
    state = hass.data.get(_PANEL_FLAG)  # None = not registered, else bool shown
    if state is show:
        return
    if state is not None:
        async_remove_panel(hass, PANEL_URL_PATH)
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_WEBCOMPONENT,
        sidebar_title="iCloud Backup" if show else None,
        sidebar_icon="mdi:cloud-upload-outline" if show else None,
        module_url=f"{STATIC_URL}/icloud-backup-panel.js?v={_VERSION}",
        require_admin=True,
        config={},
    )
    hass.data[_PANEL_FLAG] = show


def normalize_folder(folder: str | None) -> str:
    """Normalize a folder path like ' /Backup//HomeAssistant/ '."""
    parts = [part.strip() for part in (folder or "").split("/") if part.strip()]
    return "/".join(parts) or DEFAULT_FOLDER


def entry_folder(entry: ConfigEntry) -> str:
    """Return the folder currently configured for an entry (options win)."""
    return normalize_folder(
        entry.options.get(CONF_FOLDER) or entry.data.get(CONF_FOLDER)
    )


def create_client(hass: HomeAssistant, data: dict) -> ICloudDriveClient:
    """Create a client for the given config entry data."""
    username: str = data[CONF_USERNAME]
    return ICloudDriveClient(
        username=username,
        password=data[CONF_PASSWORD],
        folder=data.get(CONF_FOLDER, DEFAULT_FOLDER),
        cookie_directory=hass.config.path(".storage", DOMAIN, slugify(username)),
        china_mainland=data.get(CONF_CHINA_MAINLAND, False),
    )


async def async_setup_entry(hass: HomeAssistant, entry: ICloudDriveConfigEntry) -> bool:
    """Set up iCloud Drive Backup from a config entry."""
    client = create_client(hass, {**entry.data, CONF_FOLDER: entry_folder(entry)})

    try:
        await hass.async_add_executor_job(client.login)
        if client.requires_2fa:
            raise ICloudDriveAuthError("A new two-factor verification is required")
        await hass.async_add_executor_job(client.ensure_folder)
    except (ICloudDriveAuthError, ICloudDriveUnsupportedAuthError) as err:
        await async_notify_reauth(hass, entry)
        raise ConfigEntryAuthFailed(str(err)) from err
    except ICloudDriveUnavailableError as err:
        raise ConfigEntryError(
            "iCloud Drive is not reachable via the web API. Make sure "
            "'Access iCloud Data on the Web' is enabled and Advanced Data "
            f"Protection is turned off ({err})"
        ) from err
    except (ICloudDriveConnectionError, ICloudDriveError) as err:
        raise ConfigEntryNotReady(str(err)) from err

    entry.runtime_data = client
    async_clear_reauth(hass, entry)
    await _async_register_panel(hass)
    _LOGGER.info("Storing backups in iCloud Drive folder '%s'", client.folder)

    async def _async_options_updated(
        hass: HomeAssistant, entry: ICloudDriveConfigEntry
    ) -> None:
        """Reload so the new folder is used right away."""
        await hass.config_entries.async_reload(entry.entry_id)

    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    @callback
    def _notify_backup_listeners() -> None:
        for listener in hass.data.get(DATA_BACKUP_AGENT_LISTENERS, []):
            listener()

    if hasattr(entry, "async_on_state_change"):
        entry.async_on_unload(entry.async_on_state_change(_notify_backup_listeners))
    else:  # pragma: no cover - older Home Assistant
        hass.loop.call_soon(_notify_backup_listeners)
        entry.async_on_unload(_notify_backup_listeners)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ICloudDriveConfigEntry) -> bool:
    """Unload a config entry.

    The panel stays registered (a reload after changing the folder must not
    kick the user out of the explorer); it is removed in async_remove_entry.
    """
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ICloudDriveConfigEntry) -> None:
    """Remove the sidebar panel once the last account is deleted."""
    others = [
        e for e in hass.config_entries.async_entries(DOMAIN) if e.entry_id != entry.entry_id
    ]
    if not others and hass.data.pop(_PANEL_FLAG, None) is not None:
        async_remove_panel(hass, PANEL_URL_PATH)
