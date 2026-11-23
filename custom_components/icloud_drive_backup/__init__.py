"""iCloud Drive Backup: store Home Assistant backups in iCloud Drive."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import (
    ConfigEntryAuthFailed,
    ConfigEntryError,
    ConfigEntryNotReady,
)
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
    DATA_BACKUP_AGENT_LISTENERS,
    DEFAULT_FOLDER,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

ICloudDriveConfigEntry = ConfigEntry  # runtime_data: ICloudDriveClient


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
            raise ConfigEntryAuthFailed("A new two-factor verification is required")
        await hass.async_add_executor_job(client.ensure_folder)
    except (ICloudDriveAuthError, ICloudDriveUnsupportedAuthError) as err:
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
    """Unload a config entry."""
    return True
