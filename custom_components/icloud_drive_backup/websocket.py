"""WebSocket API used by the iCloud Backup explorer panel (admin only)."""

from __future__ import annotations

from dataclasses import asdict
import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, callback

from .api import (
    ICloudDriveAuthError,
    ICloudDriveClient,
    ICloudDriveError,
    ICloudDriveFolderNotFoundError,
    ICloudDriveUnavailableError,
    split_path,
)
from .const import (
    CONF_FOLDER,
    CONF_NOTIFY_PERSISTENT,
    CONF_NOTIFY_SERVICES,
    CONF_SHOW_PANEL,
    DOMAIN,
)
from .notify import async_notify_reauth, async_send_test, available_notify_services
from .util import VERSION, entry_folder

_LOGGER = logging.getLogger(__name__)

PREFIX = f"{DOMAIN}/"


@callback
def async_register_websocket_commands(hass: HomeAssistant) -> None:
    """Register all panel commands."""
    for command in (
        ws_entries,
        ws_browse,
        ws_tree,
        ws_create_folder,
        ws_set_folder,
        ws_check,
        ws_status,
        ws_set_options,
        ws_test_notify,
    ):
        websocket_api.async_register_command(hass, command)


def _client(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> ICloudDriveClient | None:
    """Return the client of a loaded entry, or send an error and return None."""
    entry = hass.config_entries.async_get_entry(msg["entry_id"])
    if entry is None or entry.domain != DOMAIN:
        connection.send_error(msg["id"], "not_found", "Unknown iCloud Drive Backup entry")
        return None
    if entry.state is not ConfigEntryState.LOADED:
        connection.send_error(
            msg["id"],
            "not_loaded",
            "The integration is not loaded. Re-authenticate it under Settings → Devices & services.",
        )
        return None
    return entry.runtime_data


async def _run(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    func: Any,
    *args: Any,
) -> tuple[bool, Any]:
    """Run a blocking client call; send a readable error on failure."""
    try:
        return True, await hass.async_add_executor_job(func, *args)
    except ICloudDriveFolderNotFoundError as err:
        connection.send_error(msg["id"], "folder_not_found", f"Folder not found: {err}")
    except ICloudDriveAuthError:
        entry = hass.config_entries.async_get_entry(msg["entry_id"])
        if entry is not None:
            entry.async_start_reauth(hass)
            await async_notify_reauth(hass, entry)
        connection.send_error(
            msg["id"], "auth", "The iCloud session has expired. Please re-authenticate."
        )
    except ICloudDriveUnavailableError as err:
        connection.send_error(msg["id"], "drive_unavailable", str(err))
    except ICloudDriveError as err:
        _LOGGER.warning("iCloud Drive request failed: %s", err)
        connection.send_error(msg["id"], "icloud_error", str(err) or type(err).__name__)
    return False, None


@websocket_api.websocket_command({vol.Required("type"): PREFIX + "entries"})
@websocket_api.require_admin
@callback
def ws_entries(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """List configured accounts with their backup folder and state."""
    result = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        loaded = entry.state is ConfigEntryState.LOADED
        result.append(
            {
                "entry_id": entry.entry_id,
                "title": entry.title,
                "loaded": loaded,
                "folder": entry.runtime_data.folder if loaded else None,
            }
        )
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): PREFIX + "browse",
        vol.Required("entry_id"): str,
        vol.Optional("path", default=""): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_browse(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the subfolders and backups of one folder."""
    if (client := _client(hass, connection, msg)) is None:
        return
    ok, result = await _run(hass, connection, msg, client.browse, msg["path"])
    if ok:
        result["current"] = client.folder
        connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {vol.Required("type"): PREFIX + "tree", vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_tree(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return all folder paths (a few levels deep) for searching."""
    if (client := _client(hass, connection, msg)) is None:
        return
    ok, result = await _run(hass, connection, msg, client.folder_tree)
    if ok:
        connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): PREFIX + "create_folder",
        vol.Required("entry_id"): str,
        vol.Optional("path", default=""): str,
        vol.Required("name"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_create_folder(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Create a subfolder."""
    name = msg["name"].strip()
    if not name or "/" in name or name in (".", ".."):
        connection.send_error(msg["id"], "invalid_name", "Invalid folder name")
        return
    if (client := _client(hass, connection, msg)) is None:
        return
    ok, _ = await _run(hass, connection, msg, client.create_subfolder, msg["path"], name)
    if ok:
        path = "/".join([*split_path(msg["path"]), name])
        connection.send_result(msg["id"], {"path": path})


@websocket_api.websocket_command(
    {
        vol.Required("type"): PREFIX + "set_folder",
        vol.Required("entry_id"): str,
        vol.Required("path"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_folder(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Use a folder as backup folder (validates it, then reloads the entry)."""
    path = "/".join(split_path(msg["path"]))
    if not path:
        connection.send_error(
            msg["id"], "root_not_allowed", "Backups cannot be stored in the iCloud Drive root"
        )
        return
    if (client := _client(hass, connection, msg)) is None:
        return
    ok, _ = await _run(hass, connection, msg, client.for_folder(path).ensure_folder)
    if not ok:
        return
    entry = hass.config_entries.async_get_entry(msg["entry_id"])
    assert entry is not None
    _LOGGER.info("Backup folder changed from '%s' to '%s' (panel)", client.folder, path)
    hass.config_entries.async_update_entry(
        entry, options={**entry.options, CONF_FOLDER: path}
    )
    connection.send_result(msg["id"], {"folder": path})


@websocket_api.websocket_command(
    {
        vol.Required("type"): PREFIX + "check",
        vol.Required("entry_id"): str,
        vol.Optional("write_test", default=True): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_check(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Run the read/write check on the configured folder."""
    if (client := _client(hass, connection, msg)) is None:
        return
    ok, result = await _run(hass, connection, msg, client.check, msg["write_test"])
    if ok:
        connection.send_result(msg["id"], asdict(result))


def _options(entry: ConfigEntry) -> dict[str, Any]:
    return {
        CONF_NOTIFY_PERSISTENT: entry.options.get(CONF_NOTIFY_PERSISTENT, True),
        CONF_NOTIFY_SERVICES: list(entry.options.get(CONF_NOTIFY_SERVICES, [])),
        CONF_SHOW_PANEL: entry.options.get(CONF_SHOW_PANEL, True),
    }


def _entry(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> ConfigEntry | None:
    entry = hass.config_entries.async_get_entry(msg["entry_id"])
    if entry is None or entry.domain != DOMAIN:
        connection.send_error(msg["id"], "not_found", "Unknown iCloud Drive Backup entry")
        return None
    return entry


def _reauth_pending(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return any(
        flow.get("context", {}).get("source") == "reauth"
        and flow.get("context", {}).get("entry_id") == entry.entry_id
        for flow in hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    )


@websocket_api.websocket_command(
    {vol.Required("type"): PREFIX + "status", vol.Required("entry_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_status(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Everything the panel's overview and settings tabs show."""
    if (entry := _entry(hass, connection, msg)) is None:
        return
    loaded = entry.state is ConfigEntryState.LOADED
    result: dict[str, Any] = {
        "entry_id": entry.entry_id,
        "title": entry.title,
        "account": entry.data.get("username"),
        "state": str(entry.state.value),
        "loaded": loaded,
        "reauth_needed": _reauth_pending(hass, entry),
        "folder": entry_folder(entry),
        "options": _options(entry),
        "notify_services_available": available_notify_services(hass),
        "version": VERSION,
        "backups": None,
        "last_backup": None,
        "error": None,
    }
    if loaded:
        client: ICloudDriveClient = entry.runtime_data
        try:
            items = await hass.async_add_executor_job(client.list_backups)
        except ICloudDriveAuthError:
            entry.async_start_reauth(hass)
            await async_notify_reauth(hass, entry)
            result["reauth_needed"] = True
        except ICloudDriveError as err:
            result["error"] = str(err) or type(err).__name__
        else:
            result["backups"] = len(items)
            newest = max(items, key=lambda i: i.backup.get("date") or "", default=None)
            if newest is not None:
                result["last_backup"] = {
                    "name": newest.backup.get("name"),
                    "date": newest.backup.get("date"),
                    "size": newest.backup.get("size"),
                }
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): PREFIX + "set_options",
        vol.Required("entry_id"): str,
        vol.Optional(CONF_NOTIFY_PERSISTENT): bool,
        vol.Optional(CONF_NOTIFY_SERVICES): [str],
        vol.Optional(CONF_SHOW_PANEL): bool,
    }
)
@websocket_api.require_admin
@callback
def ws_set_options(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Save notification and sidebar settings (no reload needed)."""
    if (entry := _entry(hass, connection, msg)) is None:
        return
    changes = {
        key: msg[key]
        for key in (CONF_NOTIFY_PERSISTENT, CONF_NOTIFY_SERVICES, CONF_SHOW_PANEL)
        if key in msg
    }
    hass.config_entries.async_update_entry(entry, options={**entry.options, **changes})
    connection.send_result(msg["id"], _options(entry))


@websocket_api.websocket_command(
    {
        vol.Required("type"): PREFIX + "test_notify",
        vol.Required("entry_id"): str,
        vol.Optional(CONF_NOTIFY_PERSISTENT, default=True): bool,
        vol.Optional(CONF_NOTIFY_SERVICES, default=[]): [str],
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_test_notify(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Send a test notification through the given channels."""
    if (entry := _entry(hass, connection, msg)) is None:
        return
    await async_send_test(
        hass,
        entry,
        {
            CONF_NOTIFY_PERSISTENT: msg[CONF_NOTIFY_PERSISTENT],
            CONF_NOTIFY_SERVICES: msg[CONF_NOTIFY_SERVICES],
        },
    )
    connection.send_result(msg["id"], {"sent": True})
