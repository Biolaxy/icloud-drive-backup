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
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from . import create_client, normalize_folder
from .api import (
    ICloudDriveAuthError,
    ICloudDriveClient,
    ICloudDriveConnectionError,
    ICloudDriveError,
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
# Options: everything lives in the "iCloud Backup" panel; this dialog only
# shows the live status and links there.
# --------------------------------------------------------------------------

_LABELS = {
    "de": {
        "ok": "✅ **Verbunden** · {count}",
        "one": "1 Backup in iCloud",
        "many": "{n} Backups in iCloud",
        "none": "noch kein Backup in iCloud",
        "missing": "⚠️ **Ordner fehlt** · wird beim nächsten Backup angelegt",
        "error": "❌ **Nicht erreichbar** · {error}",
    },
    "en": {
        "ok": "✅ **Connected** · {count}",
        "one": "1 backup in iCloud",
        "many": "{n} backups in iCloud",
        "none": "no backup in iCloud yet",
        "missing": "⚠️ **Folder missing** · it will be created on the next backup",
        "error": "❌ **Not reachable** · {error}",
    },
}


def _display_path(segments: list[str]) -> str:
    return " › ".join(["iCloud Drive", *segments])


class ICloudDriveOptionsFlow(OptionsFlow):
    """Show the status and link to the iCloud Backup panel."""

    def _t(self, key: str, **kwargs: Any) -> str:
        lang = "de" if (self.hass.config.language or "").startswith("de") else "en"
        return _LABELS[lang][key].format(**kwargs)

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Status at a glance plus a link to the panel."""
        if user_input is not None:
            return self.async_create_entry(data=dict(self.config_entry.options))
        client: ICloudDriveClient | None = getattr(
            self.config_entry, "runtime_data", None
        )
        if client is None:
            return self.async_abort(reason="not_loaded")
        check: FolderCheck = await self.hass.async_add_executor_job(client.check, False)
        if check.error:
            status = self._t("error", error=check.error)
        elif not check.exists:
            status = self._t("missing")
        else:
            count = check.backups or 0
            status = self._t(
                "ok",
                count=self._t("none")
                if count == 0
                else self._t("one")
                if count == 1
                else self._t("many", n=count),
            )
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({}),
            description_placeholders={
                "folder": _display_path(split_path(client.folder)),
                "status": status,
            },
        )
