"""Blocking iCloud Drive client used by the backup agent.

All public methods of :class:`ICloudDriveClient` perform network I/O and must be
run in the executor (``hass.async_add_executor_job``).
"""

from __future__ import annotations

from dataclasses import dataclass
import inspect
import io
import json
import logging
import os
import threading
import time
from typing import IO, Any
import uuid

from pyicloud import PyiCloudService
from pyicloud.services.drive import DriveNode
import pyicloud.exceptions as pyicloud_exceptions
from pyicloud.exceptions import (
    PyiCloud2SARequiredException,
    PyiCloudAPIResponseException,
    PyiCloudException,
    PyiCloudFailedLoginException,
    PyiCloudServiceNotActivatedException,
)

from .const import BACKUP_SUFFIX, CHUNK_SIZE, METADATA_SUFFIX

_LOGGER = logging.getLogger(__name__)

# Optional exceptions that only exist in some pyicloud versions.
_AUTH_EXCEPTIONS: tuple[type[BaseException], ...] = (PyiCloudFailedLoginException,)
for _name in (
    "PyiCloud2FARequiredException",
    "PyiCloudAuthRequiredException",
    "PyiCloudNoStoredPasswordAvailableException",
):
    _exc = getattr(pyicloud_exceptions, _name, None)
    if _exc is not None:
        _AUTH_EXCEPTIONS += (_exc,)

_UNAVAILABLE_EXCEPTIONS: tuple[type[BaseException], ...] = (
    PyiCloudServiceNotActivatedException,
)
try:
    from pyicloud.exceptions import PyiCloudServiceUnavailable

    _UNAVAILABLE_EXCEPTIONS += (PyiCloudServiceUnavailable,)
except ImportError:  # pragma: no cover - older pyicloud
    pass


class ICloudDriveError(Exception):
    """Base error for this integration."""


class ICloudDriveAuthError(ICloudDriveError):
    """Credentials are wrong or the session needs a new 2FA verification."""


class ICloudDriveUnsupportedAuthError(ICloudDriveError):
    """The account uses a login method we cannot handle (2SA, security keys)."""


class ICloudDriveUnavailableError(ICloudDriveError):
    """iCloud Drive web access is not available for this account."""


class ICloudDriveConnectionError(ICloudDriveError):
    """iCloud could not be reached."""


class ICloudDriveFolderNotFoundError(ICloudDriveError):
    """A folder of the requested path does not exist."""


@dataclass
class FolderCheck:
    """Result of checking the backup folder."""

    path: str
    exists: bool = False
    backups: int | None = None
    write_ok: bool | None = None
    error: str | None = None


def split_path(path: str) -> list[str]:
    """Split 'Backup/HomeAssistant' into its non-empty segments."""
    return [part.strip() for part in (path or "").split("/") if part.strip()]


@dataclass
class RemoteBackup:
    """A backup stored in iCloud Drive."""

    backup: dict[str, Any]
    backup_node: Any
    metadata_node: Any


class _NamedFile:
    """Wrap a file object so pyicloud sees the file name we want in iCloud."""

    def __init__(self, fileobj: IO[bytes], name: str) -> None:
        self._fileobj = fileobj
        self.name = name

    def read(self, size: int = -1) -> bytes:
        return self._fileobj.read(size)

    def seek(self, offset: int, whence: int = os.SEEK_SET) -> int:
        return self._fileobj.seek(offset, whence)

    def tell(self) -> int:
        return self._fileobj.tell()


class _MultipartFileStream:
    """A streaming multipart/form-data body with a known length.

    ``requests`` would load the whole file into memory when using ``files=``,
    which is a problem for multi-gigabyte backups on small devices. This object
    is passed as ``data=`` instead: requests sends it with a ``Content-Length``
    header and reads it in small blocks.
    """

    def __init__(self, fileobj: IO[bytes], field: str, filename: str, size: int) -> None:
        boundary = uuid.uuid4().hex
        self.content_type = f"multipart/form-data; boundary={boundary}"
        head = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{field}"; filename="{filename}"'
            "\r\n\r\n"
        ).encode()
        tail = f"\r\n--{boundary}--\r\n".encode()
        self._parts: list[IO[bytes]] = [io.BytesIO(head), fileobj, io.BytesIO(tail)]
        self._length = len(head) + size + len(tail)

    def __len__(self) -> int:
        return self._length

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            return b"".join(part.read() for part in self._parts)
        out = bytearray()
        while self._parts and len(out) < size:
            chunk = self._parts[0].read(size - len(out))
            if chunk:
                out += chunk
            else:
                self._parts.pop(0)
        return bytes(out)


def _drive_name(node: Any) -> str:
    return str(node.name)


class ICloudDriveClient:
    """Thin, thread-safe wrapper around pyicloud's Drive service."""

    def __init__(
        self,
        username: str,
        password: str,
        folder: str,
        cookie_directory: str,
        china_mainland: bool = False,
    ) -> None:
        self._username = username
        self._password = password
        self._folder_name = folder
        self._cookie_directory = cookie_directory
        self._china_mainland = china_mainland
        self._api: PyiCloudService | None = None
        self._folder_node: Any = None
        self._lock = threading.RLock()
        # drivewsid -> (etag, parsed metadata)
        self._metadata_cache: dict[str, tuple[str, dict[str, Any]]] = {}

    @property
    def folder(self) -> str:
        """Return the configured backup folder path."""
        return self._folder_name

    def for_folder(self, folder: str) -> ICloudDriveClient:
        """Return a client for another folder that reuses this login session."""
        client = ICloudDriveClient(
            self._username,
            self._password,
            folder,
            self._cookie_directory,
            self._china_mainland,
        )
        client._api = self._api  # noqa: SLF001
        return client

    # ------------------------------------------------------------------ auth

    def login(self) -> None:
        """Log in. Afterwards check :attr:`requires_2fa`."""
        os.makedirs(self._cookie_directory, exist_ok=True)
        try:
            self._api = PyiCloudService(
                self._username,
                self._password,
                cookie_directory=self._cookie_directory,
                with_family=False,
                china_mainland=self._china_mainland,
            )
        except PyiCloud2SARequiredException as err:
            raise ICloudDriveUnsupportedAuthError(str(err)) from err
        except _AUTH_EXCEPTIONS as err:
            raise ICloudDriveAuthError(str(err)) from err
        except PyiCloudException as err:
            raise ICloudDriveConnectionError(str(err)) from err
        except OSError as err:
            raise ICloudDriveConnectionError(str(err)) from err

        if self._api.requires_2sa and not self._api.requires_2fa:
            raise ICloudDriveUnsupportedAuthError("Two-step authentication (2SA)")

    @property
    def requires_2fa(self) -> bool:
        """Return True if a 2FA code is needed before the session can be used."""
        assert self._api is not None
        return bool(self._api.requires_2fa)

    def request_2fa_code(self) -> bool:
        """Ask Apple to push a code to trusted devices.

        Returns False if the account only allows security keys.
        """
        assert self._api is not None
        request = getattr(self._api, "request_2fa_code", None)
        if request is None:
            # Older pyicloud: Apple pushes the code automatically on login.
            return True
        try:
            return bool(request())
        except PyiCloudAPIResponseException:
            # Delivery request failed, but a code may already be shown on a
            # trusted device. Let the user enter it.
            use_existing = getattr(self._api, "use_existing_trusted_device_code", None)
            if use_existing is not None:
                use_existing()
            return True

    def validate_2fa_code(self, code: str) -> bool:
        """Validate a 2FA code and mark the session as trusted."""
        assert self._api is not None
        try:
            valid = bool(self._api.validate_2fa_code(code.strip()))
        except PyiCloudException as err:
            _LOGGER.debug("2FA validation failed: %s", err)
            return False
        if valid and not self._api.is_trusted_session:
            self._api.trust_session()
        return valid

    # ---------------------------------------------------------------- folder

    def _drive(self) -> Any:
        if self._api is None:
            self.login()
        assert self._api is not None
        if self._api.requires_2fa:
            raise ICloudDriveAuthError("Two-factor authentication required")
        try:
            return self._api.drive
        except _UNAVAILABLE_EXCEPTIONS as err:
            raise ICloudDriveUnavailableError(str(err)) from err

    def _call(self, func: Any, *args: Any, **kwargs: Any) -> Any:
        """Run a pyicloud call and translate its errors."""
        try:
            return func(*args, **kwargs)
        except ICloudDriveError:
            raise
        except _AUTH_EXCEPTIONS as err:
            raise ICloudDriveAuthError(str(err)) from err
        except _UNAVAILABLE_EXCEPTIONS as err:
            raise ICloudDriveUnavailableError(str(err)) from err
        except PyiCloudException as err:
            raise ICloudDriveConnectionError(str(err)) from err
        except OSError as err:
            raise ICloudDriveConnectionError(str(err)) from err

    @staticmethod
    def _find_subfolder(parent: Any, name: str) -> Any:
        """Return the child folder called ``name`` (exact match preferred)."""
        folders = [c for c in parent.get_children(force=True) if c.type == "folder"]
        for child in folders:
            if _drive_name(child) == name:
                return child
        # iCloud Drive treats names case-insensitively.
        for child in folders:
            if _drive_name(child).casefold() == name.casefold():
                return child
        return None

    def _get_or_create_subfolder(self, parent: Any, name: str) -> Any:
        child = self._find_subfolder(parent, name)
        if child is not None:
            return child
        _LOGGER.info("Creating iCloud Drive folder '%s'", name)
        response = parent.mkdir(name)
        # The new folder can take a moment to show up in listings.
        for attempt in range(5):
            if attempt:
                time.sleep(attempt)
            child = self._find_subfolder(parent, name)
            if child is not None:
                return child
        # Fall back to the folder data returned by the create call.
        try:
            data = response["folders"][0]
            if data.get("drivewsid") and data.get("docwsid"):
                return DriveNode(parent.connection, data)
        except (KeyError, IndexError, TypeError):
            pass
        _LOGGER.error("Unexpected createFolders response: %s", response)
        raise ICloudDriveError(f"Could not create folder '{name}'")

    def _get_folder(self, refresh: bool = False) -> Any:
        """Return the backup folder node, creating it (and parents) if needed.

        The folder may be a path like ``Backup/HomeAssistant``.
        """
        if self._folder_node is not None and not refresh:
            return self._folder_node
        self._folder_node = self._resolve(self._folder_name, create=True)
        return self._folder_node

    def _resolve(self, path: str, create: bool) -> Any:
        """Walk a folder path from the iCloud Drive root."""
        node = self._drive().root
        for segment in split_path(path):
            if create:
                node = self._get_or_create_subfolder(node, segment)
                continue
            child = self._find_subfolder(node, segment)
            if child is None:
                raise ICloudDriveFolderNotFoundError(path)
            node = child
        return node

    def list_subfolders(self, path: str) -> list[str]:
        """Return the names of the folders inside ``path`` ('' = root)."""
        with self._lock:
            node = self._call(self._resolve, path, False)
            children = self._call(node.get_children, True)
        names = [_drive_name(c) for c in children if c.type == "folder"]
        return sorted(names, key=str.casefold)

    def create_subfolder(self, path: str, name: str) -> None:
        """Create folder ``name`` inside the existing folder ``path``."""
        with self._lock:
            parent = self._call(self._resolve, path, False)
            self._call(self._get_or_create_subfolder, parent, name.strip())

    def check(self, write_test: bool = False) -> FolderCheck:
        """Check that the backup folder exists, is readable and (optionally) writable.

        Never creates the folder. The write test uploads a tiny file and
        deletes it again (it then sits in 'Recently Deleted').
        """
        result = FolderCheck(path=self._folder_name)
        try:
            with self._lock:
                node = self._call(self._resolve, self._folder_name, False)
                self._folder_node = node
            result.exists = True
            result.backups = len(self.list_backups())
            if write_test:
                result.write_ok = False
                name = f"ha-write-test-{uuid.uuid4().hex[:8]}.txt"
                payload = b"Home Assistant iCloud Drive Backup write test\n"
                self._call(self._upload, io.BytesIO(payload), name, len(payload))
                with self._lock:
                    children = self._call(node.get_children, True)
                    test_file = next(
                        (c for c in children if _drive_name(c) == name), None
                    )
                    if test_file is None:
                        raise ICloudDriveError("Test file not found after upload")
                    self._call(test_file.delete)
                result.write_ok = True
        except ICloudDriveFolderNotFoundError:
            result.exists = False
        except ICloudDriveError as err:
            result.error = str(err) or type(err).__name__
        return result

    def ensure_folder(self) -> None:
        """Verify that iCloud Drive works and the backup folder exists."""
        with self._lock:
            self._call(self._get_folder, True)

    # ---------------------------------------------------------------- upload

    def _upload(self, fileobj: IO[bytes], filename: str, size: int) -> None:
        drive = self._drive()
        named = _NamedFile(fileobj, filename)

        with self._lock:
            folder = self._get_folder()
            params = dict(drive.params)
            params.update(drive._get_token_from_cookie())  # noqa: SLF001
            document_id, content_url = drive._get_upload_contentws_url(  # noqa: SLF001
                named
            )

        # The large transfer runs without the lock so listings stay responsive.
        named.seek(0)
        body = _MultipartFileStream(named, filename, filename, size)
        response = drive.session.post(
            content_url,
            data=body,
            headers={"Content-Type": body.content_type},
        )
        drive._raise_if_error(response)  # noqa: SLF001
        file_info = response.json()["singleFile"]

        with self._lock:
            update = drive._update_contentws  # noqa: SLF001
            kwargs: dict[str, Any] = {}
            if "request_params" in inspect.signature(update).parameters:
                kwargs["request_params"] = params
            update(
                folder.data["docwsid"],
                file_info,
                document_id,
                named,
                folder.data["zone"],
                **kwargs,
            )

    def upload_backup(self, local_path: str, base_name: str, metadata: dict[str, Any]) -> None:
        """Upload a backup tar file plus its metadata JSON."""
        size = os.path.getsize(local_path)
        with open(local_path, "rb") as fileobj:
            self._call(self._upload, fileobj, base_name + BACKUP_SUFFIX, size)
        # Metadata is written last: a backup only shows up once it is complete.
        raw = json.dumps(metadata).encode()
        self._call(self._upload, io.BytesIO(raw), base_name + METADATA_SUFFIX, len(raw))

    # ----------------------------------------------------------------- query

    def _read_metadata(self, node: Any) -> dict[str, Any] | None:
        key = node.data.get("drivewsid", "")
        etag = node.data.get("etag", "")
        cached = self._metadata_cache.get(key)
        if cached and cached[0] == etag:
            return cached[1]
        response = node.open()
        try:
            data = json.loads(response.content)
        except ValueError:
            _LOGGER.warning("Ignoring unreadable metadata file %s", _drive_name(node))
            return None
        self._metadata_cache[key] = (etag, data)
        return data

    def _list(self) -> list[RemoteBackup]:
        with self._lock:
            folder = self._get_folder()
            try:
                children = folder.get_children(force=True)
            except KeyError:
                # Folder vanished (deleted by the user) - recreate it.
                folder = self._get_folder(refresh=True)
                children = folder.get_children(force=True)
            files = {_drive_name(c): c for c in children if c.type == "file"}
            result: list[RemoteBackup] = []
            for name, node in files.items():
                if not name.endswith(METADATA_SUFFIX):
                    continue
                meta = self._read_metadata(node)
                if not meta or "backup" not in meta:
                    continue
                tar_node = files.get(meta.get("file", ""))
                if tar_node is None:
                    _LOGGER.debug("Metadata %s has no matching backup file", name)
                    continue
                result.append(RemoteBackup(meta["backup"], tar_node, node))
            return result

    def list_backups(self) -> list[RemoteBackup]:
        """Return all backups found in the backup folder."""
        return self._call(self._list)

    def find_backup(self, backup_id: str) -> RemoteBackup | None:
        """Return a single backup by its Home Assistant backup id."""
        for item in self.list_backups():
            if item.backup.get("backup_id") == backup_id:
                return item
        return None

    # ------------------------------------------------------- download/delete

    def open_download(self, item: RemoteBackup) -> Any:
        """Open a streaming download; returns (response, chunk iterator)."""
        response = self._call(item.backup_node.open, stream=True)
        return response, response.iter_content(chunk_size=CHUNK_SIZE)

    def delete_backup(self, item: RemoteBackup) -> None:
        """Move backup and metadata to 'Recently Deleted' in iCloud Drive."""
        with self._lock:
            self._call(item.metadata_node.delete)
            self._call(item.backup_node.delete)
            self._metadata_cache.pop(item.metadata_node.data.get("drivewsid", ""), None)
