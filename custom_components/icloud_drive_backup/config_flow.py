"""Config flow for iCloud Drive Backup."""

from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    SOURCE_REAUTH,
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from . import create_client, entry_folder, normalize_folder
from .api import (
    ICloudDriveAuthError,
    ICloudDriveClient,
    ICloudDriveConnectionError,
    ICloudDriveError,
    ICloudDriveFolderNotFoundError,
    ICloudDriveUnavailableError,
    ICloudDriveUnsupportedAuthError,
    FolderCheck,
    split_path,
)
from .const import (
    CONF_CHINA_MAINLAND,
    CONF_FOLDER,
    CONF_VERIFICATION_CODE,
    DEFAULT_FOLDER,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

PASSWORD_SELECTOR = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))


class ICloudDriveBackupConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for iCloud Drive Backup."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Return the options flow (change the backup folder)."""
        return ICloudDriveOptionsFlow()

    def __init__(self) -> None:
        """Initialize the flow."""
        self._data: dict[str, Any] = {}
        self._client: ICloudDriveClient | None = None

    # ----------------------------------------------------------- user setup

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Ask for Apple ID, password and target folder."""
        errors: dict[str, str] = {}
        if user_input is not None:
            user_input[CONF_USERNAME] = user_input[CONF_USERNAME].strip()
            user_input[CONF_FOLDER] = normalize_folder(user_input.get(CONF_FOLDER))
            await self.async_set_unique_id(user_input[CONF_USERNAME].lower())
            self._abort_if_unique_id_configured()
            self._data = user_input
            result = await self._async_login(errors)
            if result is not None:
                return result

        defaults = user_input or {}
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_USERNAME, default=defaults.get(CONF_USERNAME, "")
                    ): str,
                    vol.Required(CONF_PASSWORD): PASSWORD_SELECTOR,
                    vol.Required(
                        CONF_FOLDER, default=defaults.get(CONF_FOLDER, DEFAULT_FOLDER)
                    ): str,
                    vol.Optional(
                        CONF_CHINA_MAINLAND,
                        default=defaults.get(CONF_CHINA_MAINLAND, False),
                    ): bool,
                }
            ),
            errors=errors,
        )

    # --------------------------------------------------------------- reauth

    async def async_step_reauth(
        self, entry_data: Mapping[str, Any]
    ) -> ConfigFlowResult:
        """Start re-authentication (password changed or 2FA session expired)."""
        self._data = dict(entry_data)
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Ask for the password again and redo 2FA if needed."""
        errors: dict[str, str] = {}
        if user_input is not None:
            self._data[CONF_PASSWORD] = user_input[CONF_PASSWORD]
            result = await self._async_login(errors)
            if result is not None:
                return result

        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Required(CONF_PASSWORD): PASSWORD_SELECTOR}),
            description_placeholders={"username": self._data[CONF_USERNAME]},
            errors=errors,
        )

    # ------------------------------------------------------------------ 2FA

    async def async_step_verification_code(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Ask for the 6-digit code shown on a trusted Apple device."""
        assert self._client is not None
        errors: dict[str, str] = {}
        if user_input is not None:
            valid = await self.hass.async_add_executor_job(
                self._client.validate_2fa_code, user_input[CONF_VERIFICATION_CODE]
            )
            if valid:
                return await self._async_finish()
            errors["base"] = "invalid_code"

        return self.async_show_form(
            step_id="verification_code",
            data_schema=vol.Schema({vol.Required(CONF_VERIFICATION_CODE): str}),
            description_placeholders={"username": self._data[CONF_USERNAME]},
            errors=errors,
        )

    # -------------------------------------------------------------- helpers

    async def _async_login(self, errors: dict[str, str]) -> ConfigFlowResult | None:
        """Log in; returns the next step, or None with ``errors`` filled."""
        self._client = create_client(self.hass, self._data)
        try:
            await self.hass.async_add_executor_job(self._client.login)
            if self._client.requires_2fa:
                if not await self.hass.async_add_executor_job(
                    self._client.request_2fa_code
                ):
                    return self.async_abort(reason="security_key_unsupported")
                return await self.async_step_verification_code()
        except ICloudDriveAuthError:
            errors["base"] = "invalid_auth"
        except ICloudDriveUnsupportedAuthError:
            errors["base"] = "unsupported_auth"
        except ICloudDriveConnectionError:
            errors["base"] = "cannot_connect"
        except Exception:
            _LOGGER.exception("Unexpected error during iCloud login")
            errors["base"] = "unknown"
        else:
            return await self._async_finish()
        return None

    async def _async_finish(self) -> ConfigFlowResult:
        """Check Drive access, then create or update the entry."""
        assert self._client is not None
        try:
            await self.hass.async_add_executor_job(self._client.ensure_folder)
        except ICloudDriveUnavailableError:
            return self.async_abort(reason="drive_unavailable")
        except ICloudDriveAuthError:
            return self.async_abort(reason="invalid_auth")
        except ICloudDriveConnectionError as err:
            _LOGGER.error("iCloud Drive check failed: %s", err)
            return self.async_abort(reason="cannot_connect")
        except ICloudDriveError as err:
            _LOGGER.error("iCloud Drive folder check failed: %s", err)
            return self.async_abort(
                reason="folder_failed",
                description_placeholders={"folder": self._data[CONF_FOLDER]},
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.error("iCloud Drive check failed: %s", err)
            return self.async_abort(reason="cannot_connect")

        if self.source == SOURCE_REAUTH:
            return self.async_update_reload_and_abort(
                self._get_reauth_entry(),
                data_updates={CONF_PASSWORD: self._data[CONF_PASSWORD]},
            )
        return self.async_create_entry(
            title=f"iCloud Drive ({self._data[CONF_USERNAME]})", data=self._data
        )


# --------------------------------------------------------------------------
# Options: status, folder browser, manual path and a full folder check
# --------------------------------------------------------------------------

ACTION_USE = "__use__"
ACTION_UP = "__up__"
ACTION_NEW = "__new__"
DIR_PREFIX = "dir:"

_LABELS = {
    "de": {
        "use": "✅ Diesen Ordner verwenden",
        "up": "⬆️ Eine Ebene nach oben",
        "new": "➕ Neuen Unterordner anlegen",
        "ok": "✅ Erreichbar – {count} Backup(s) im Ordner",
        "missing": "⚠️ Ordner existiert nicht (wird beim nächsten Backup angelegt)",
        "error": "❌ Nicht erreichbar: {error}",
        "read_ok": "✅ Ordner gefunden und lesbar ({count} Backup(s))",
        "write_ok": "✅ Schreibtest erfolgreich (Testdatei angelegt und gelöscht)",
        "write_fail": "❌ Schreibtest fehlgeschlagen",
        "no_subfolders": "keine Unterordner",
        "subfolders": "{count} Unterordner",
    },
    "en": {
        "use": "✅ Use this folder",
        "up": "⬆️ Up one level",
        "new": "➕ Create new subfolder",
        "ok": "✅ Reachable – {count} backup(s) in the folder",
        "missing": "⚠️ Folder does not exist (it will be created on the next backup)",
        "error": "❌ Not reachable: {error}",
        "read_ok": "✅ Folder found and readable ({count} backup(s))",
        "write_ok": "✅ Write test passed (test file created and deleted)",
        "write_fail": "❌ Write test failed",
        "no_subfolders": "no subfolders",
        "subfolders": "{count} subfolders",
    },
}


def _display_path(segments: list[str]) -> str:
    return " / ".join(["iCloud Drive", *segments])


class ICloudDriveOptionsFlow(OptionsFlow):
    """Options for an entry: check, browse for and change the backup folder."""

    def __init__(self) -> None:
        """Initialize the options flow."""
        self._path: list[str] | None = None

    # ---------------------------------------------------------------- utils

    def _t(self, key: str, **kwargs: Any) -> str:
        lang = "de" if (self.hass.config.language or "").startswith("de") else "en"
        return _LABELS[lang][key].format(**kwargs)

    @property
    def _client(self) -> ICloudDriveClient | None:
        return getattr(self.config_entry, "runtime_data", None)

    def _status_text(self, check: FolderCheck) -> str:
        if check.error:
            return self._t("error", error=check.error)
        if not check.exists:
            return self._t("missing")
        return self._t("ok", count=check.backups)

    async def _async_save(self, folder: str) -> tuple[ConfigFlowResult | None, str | None]:
        """Validate and store a new folder. Returns (result, error_key)."""
        client = self._client
        assert client is not None
        if not split_path(folder):
            return None, "root_not_allowed"
        folder = normalize_folder(folder)
        if folder == entry_folder(self.config_entry):
            return self.async_create_entry(data={CONF_FOLDER: folder}), None
        try:
            await self.hass.async_add_executor_job(
                client.for_folder(folder).ensure_folder
            )
        except ICloudDriveAuthError:
            return None, "invalid_auth"
        except ICloudDriveUnavailableError:
            return None, "drive_unavailable"
        except ICloudDriveConnectionError:
            return None, "cannot_connect"
        except ICloudDriveError as err:
            _LOGGER.error("Folder '%s' could not be used: %s", folder, err)
            return None, "folder_failed"
        _LOGGER.info(
            "Backup folder changed from '%s' to '%s'",
            entry_folder(self.config_entry),
            folder,
        )
        return self.async_create_entry(data={CONF_FOLDER: folder}), None

    # ----------------------------------------------------------------- menu

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Show the current folder, its live status and the available actions."""
        client = self._client
        if client is None:
            return self.async_abort(reason="not_loaded")
        check = await self.hass.async_add_executor_job(client.check, False)
        return self.async_show_menu(
            step_id="init",
            menu_options=["browse", "manual", "check"],
            description_placeholders={
                "folder": _display_path(split_path(client.folder)),
                "status": self._status_text(check),
            },
        )

    # ---------------------------------------------------------- full check

    async def async_step_check(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Run a read + write test on the configured folder."""
        client = self._client
        if client is None:
            return self.async_abort(reason="not_loaded")
        if user_input is not None:
            return await self.async_step_init()

        check = await self.hass.async_add_executor_job(client.check, True)
        if check.error and not check.exists:
            lines = [self._t("error", error=check.error)]
        elif not check.exists:
            lines = [self._t("missing")]
        else:
            lines = [self._t("read_ok", count=check.backups)]
            if check.write_ok:
                lines.append(self._t("write_ok"))
            else:
                lines.append(self._t("write_fail"))
                if check.error:
                    lines.append(self._t("error", error=check.error))
        return self.async_show_form(
            step_id="check",
            data_schema=vol.Schema({}),
            description_placeholders={
                "folder": _display_path(split_path(client.folder)),
                "result": "\n\n".join(lines),
            },
        )

    # --------------------------------------------------------------- browse

    async def async_step_browse(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """A tiny folder explorer: open folders, go up, create, pick."""
        client = self._client
        if client is None:
            return self.async_abort(reason="not_loaded")
        errors: dict[str, str] = {}

        if self._path is None:
            # Start in the configured folder (falls back to root if missing).
            self._path = split_path(client.folder)

        if user_input is not None:
            choice: str = user_input["action"]
            if choice == ACTION_USE:
                result, error = await self._async_save("/".join(self._path))
                if result is not None:
                    return result
                errors["base"] = error or "unknown"
            elif choice == ACTION_UP:
                self._path = self._path[:-1]
            elif choice == ACTION_NEW:
                return await self.async_step_new_folder()
            elif choice.startswith(DIR_PREFIX):
                self._path = [*self._path, choice[len(DIR_PREFIX) :]]

        subfolders: list[str] = []
        try:
            try:
                subfolders = await self.hass.async_add_executor_job(
                    client.list_subfolders, "/".join(self._path)
                )
            except ICloudDriveFolderNotFoundError:
                # Folder does not exist (yet) - start at the iCloud Drive root.
                self._path = []
                subfolders = await self.hass.async_add_executor_job(
                    client.list_subfolders, ""
                )
        except ICloudDriveAuthError:
            errors["base"] = "invalid_auth"
        except ICloudDriveError as err:
            _LOGGER.error("Could not list iCloud Drive folders: %s", err)
            errors["base"] = "cannot_connect"

        options: list[SelectOptionDict] = []
        if self._path:
            options.append({"value": ACTION_USE, "label": self._t("use")})
            options.append({"value": ACTION_UP, "label": self._t("up")})
        options.append({"value": ACTION_NEW, "label": self._t("new")})
        options.extend(
            {"value": f"{DIR_PREFIX}{name}", "label": f"📁 {name}"}
            for name in subfolders
        )

        return self.async_show_form(
            step_id="browse",
            data_schema=vol.Schema(
                {
                    vol.Required("action"): SelectSelector(
                        SelectSelectorConfig(
                            options=options,
                            mode=(
                                SelectSelectorMode.LIST
                                if len(options) <= 15
                                else SelectSelectorMode.DROPDOWN
                            ),
                        )
                    )
                }
            ),
            description_placeholders={
                "path": _display_path(self._path),
                "subfolders": (
                    self._t("subfolders", count=len(subfolders))
                    if subfolders
                    else self._t("no_subfolders")
                ),
                "current": _display_path(split_path(client.folder)),
            },
            errors=errors,
        )

    async def async_step_new_folder(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Create a subfolder in the folder currently shown in the browser."""
        client = self._client
        if client is None:
            return self.async_abort(reason="not_loaded")
        assert self._path is not None
        errors: dict[str, str] = {}
        if user_input is not None:
            name = user_input["name"].strip()
            if not name or "/" in name or name in (".", ".."):
                errors["name"] = "invalid_name"
            else:
                try:
                    await self.hass.async_add_executor_job(
                        client.create_subfolder, "/".join(self._path), name
                    )
                except ICloudDriveError as err:
                    _LOGGER.error("Could not create folder '%s': %s", name, err)
                    errors["base"] = "folder_failed"
                else:
                    self._path = [*self._path, name]
                    return await self.async_step_browse()

        return self.async_show_form(
            step_id="new_folder",
            data_schema=vol.Schema({vol.Required("name"): str}),
            description_placeholders={"path": _display_path(self._path)},
            errors=errors,
        )

    # --------------------------------------------------------------- manual

    async def async_step_manual(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Type a folder path by hand."""
        client = self._client
        if client is None:
            return self.async_abort(reason="not_loaded")
        errors: dict[str, str] = {}
        if user_input is not None:
            result, error = await self._async_save(user_input.get(CONF_FOLDER, ""))
            if result is not None:
                return result
            errors["base"] = error or "unknown"

        return self.async_show_form(
            step_id="manual",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_FOLDER,
                        default=(user_input or {}).get(CONF_FOLDER, client.folder),
                    ): str
                }
            ),
            description_placeholders={
                "current": _display_path(split_path(client.folder))
            },
            errors=errors,
        )
