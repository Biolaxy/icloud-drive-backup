"""Backup agent platform: stores Home Assistant backups in iCloud Drive."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Coroutine
import logging
import os
import re
import tempfile
from typing import Any

from homeassistant.components.backup import (
    AgentBackup,
    BackupAgent,
    BackupAgentError,
)
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, callback

from .api import ICloudDriveAuthError, ICloudDriveClient, ICloudDriveError, RemoteBackup
from .const import CHUNK_SIZE, DATA_BACKUP_AGENT_LISTENERS, DOMAIN

try:  # Home Assistant 2025.5+
    from homeassistant.components.backup import BackupNotFound
except ImportError:  # pragma: no cover - older Home Assistant
    BackupNotFound = None  # type: ignore[assignment,misc]

_LOGGER = logging.getLogger(__name__)

# Write the incoming stream to disk in blocks of this size.
_WRITE_BUFFER = 4 * CHUNK_SIZE


async def async_get_backup_agents(
    hass: HomeAssistant, **kwargs: Any
) -> list[BackupAgent]:
    """Return one backup agent per loaded config entry."""
    if hasattr(hass.config_entries, "async_loaded_entries"):
        entries = hass.config_entries.async_loaded_entries(DOMAIN)
    else:  # pragma: no cover - older Home Assistant
        entries = [
            entry
            for entry in hass.config_entries.async_entries(DOMAIN)
            if entry.state is ConfigEntryState.LOADED
        ]
    return [ICloudDriveBackupAgent(hass, entry) for entry in entries]


@callback
def async_register_backup_agents_listener(
    hass: HomeAssistant,
    *,
    listener: Callable[[], None],
    **kwargs: Any,
) -> Callable[[], None]:
    """Register a listener that is called when agents are added or removed."""
    hass.data.setdefault(DATA_BACKUP_AGENT_LISTENERS, []).append(listener)

    @callback
    def remove_listener() -> None:
        listeners = hass.data.get(DATA_BACKUP_AGENT_LISTENERS, [])
        if listener in listeners:
            listeners.remove(listener)
        if not listeners:
            hass.data.pop(DATA_BACKUP_AGENT_LISTENERS, None)

    return remove_listener


def _base_name(backup: AgentBackup) -> str:
    """Build a readable, unique file name (without extension)."""
    name = re.sub(r"[^\w\-. ]+", "_", backup.name or "backup").strip(" ._") or "backup"
    return f"{name[:80]}_{backup.backup_id}"


def _not_found(backup_id: str) -> Exception:
    if BackupNotFound is not None:
        return BackupNotFound(f"Backup {backup_id} not found")
    return BackupAgentError(f"Backup {backup_id} not found")


class ICloudDriveBackupAgent(BackupAgent):
    """Backup agent that stores backups in a folder of iCloud Drive."""

    domain = DOMAIN

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the agent."""
        super().__init__()
        self._hass = hass
        self._entry = entry
        self._client: ICloudDriveClient = entry.runtime_data
        self.name = entry.title
        self.unique_id = entry.entry_id

    # ---------------------------------------------------------------- utils

    async def _run(self, func: Callable[..., Any], *args: Any) -> Any:
        """Run a blocking client call and map errors to BackupAgentError."""
        try:
            return await self._hass.async_add_executor_job(func, *args)
        except ICloudDriveAuthError as err:
            self._entry.async_start_reauth(self._hass)
            raise BackupAgentError(
                "iCloud login expired, please re-authenticate the integration"
            ) from err
        except ICloudDriveError as err:
            raise BackupAgentError(f"iCloud Drive error: {err}") from err

    async def _find(self, backup_id: str) -> RemoteBackup:
        item: RemoteBackup | None = await self._run(self._client.find_backup, backup_id)
        if item is None:
            raise _not_found(backup_id)
        return item

    # --------------------------------------------------------------- upload

    async def async_upload_backup(
        self,
        *,
        open_stream: Callable[[], Coroutine[Any, Any, AsyncIterator[bytes]]],
        backup: AgentBackup,
        **kwargs: Any,
    ) -> None:
        """Upload a backup."""
        base_name = _base_name(backup)
        fd, tmp_path = await self._hass.async_add_executor_job(
            lambda: tempfile.mkstemp(prefix="icloud_backup_", suffix=".tar")
        )
        try:
            fileobj = await self._hass.async_add_executor_job(os.fdopen, fd, "wb")
            try:
                buffer = bytearray()
                stream = await open_stream()
                async for chunk in stream:
                    buffer += chunk
                    if len(buffer) >= _WRITE_BUFFER:
                        await self._hass.async_add_executor_job(
                            fileobj.write, bytes(buffer)
                        )
                        buffer.clear()
                if buffer:
                    await self._hass.async_add_executor_job(fileobj.write, bytes(buffer))
            finally:
                await self._hass.async_add_executor_job(fileobj.close)

            metadata = {
                "version": 1,
                "file": base_name + ".tar",
                "backup": backup.as_dict(),
            }
            _LOGGER.debug("Uploading backup %s to iCloud Drive", base_name)
            await self._run(self._client.upload_backup, tmp_path, base_name, metadata)
            _LOGGER.info("Backup %s uploaded to iCloud Drive", backup.backup_id)
        finally:
            await self._hass.async_add_executor_job(_silent_remove, tmp_path)

    # ------------------------------------------------------------- download

    async def async_download_backup(
        self, backup_id: str, **kwargs: Any
    ) -> AsyncIterator[bytes]:
        """Download a backup as a byte stream."""
        item = await self._find(backup_id)
        response, chunks = await self._run(self._client.open_download, item)

        async def _stream() -> AsyncIterator[bytes]:
            try:
                while True:
                    try:
                        chunk = await self._hass.async_add_executor_job(
                            next, chunks, None
                        )
                    except Exception as err:  # noqa: BLE001
                        raise BackupAgentError(f"Download failed: {err}") from err
                    if chunk is None:
                        break
                    if chunk:
                        yield chunk
            finally:
                await self._hass.async_add_executor_job(response.close)

        return _stream()

    # ------------------------------------------------------------ list/get

    async def async_list_backups(self, **kwargs: Any) -> list[AgentBackup]:
        """List backups stored in iCloud Drive."""
        items: list[RemoteBackup] = await self._run(self._client.list_backups)
        backups: list[AgentBackup] = []
        for item in items:
            try:
                backups.append(AgentBackup.from_dict(item.backup))
            except (KeyError, TypeError, ValueError) as err:
                _LOGGER.warning("Skipping backup with invalid metadata: %s", err)
        return backups

    async def async_get_backup(self, backup_id: str, **kwargs: Any) -> AgentBackup:
        """Return a single backup."""
        item = await self._find(backup_id)
        return AgentBackup.from_dict(item.backup)

    # --------------------------------------------------------------- delete

    async def async_delete_backup(self, backup_id: str, **kwargs: Any) -> None:
        """Delete a backup (moves it to 'Recently Deleted' in iCloud Drive)."""
        item = await self._find(backup_id)
        await self._run(self._client.delete_backup, item)


def _silent_remove(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
