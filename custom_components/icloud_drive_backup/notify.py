"""Optional notifications when the iCloud login has to be renewed."""

from __future__ import annotations

import logging

from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback

from .const import CONF_NOTIFY_PERSISTENT, CONF_NOTIFY_SERVICES, DOMAIN

_LOGGER = logging.getLogger(__name__)

_NOTIFIED = f"{DOMAIN}_reauth_notified"
LINK = f"/config/integrations/integration/{DOMAIN}"

_TEXT = {
    "de": {
        "title": "iCloud Drive Backup: Anmeldung erneuern",
        "message": (
            "Die iCloud-Anmeldung für {account} ist abgelaufen. Bis du dich neu "
            "anmeldest, werden keine Backups in iCloud gespeichert.\n\n"
            "Öffne Einstellungen → Geräte & Dienste → iCloud Drive Backup und "
            "wähle „Erneut authentifizieren“ (Passwort + 2FA-Code)."
        ),
        "push": "Die iCloud-Anmeldung für {account} ist abgelaufen. Bitte in Home Assistant neu anmelden, sonst werden keine Backups gespeichert.",
        "test_title": "iCloud Drive Backup: Testnachricht",
        "test": "So sieht die Benachrichtigung aus, wenn du dich bei iCloud neu anmelden musst.",
    },
    "en": {
        "title": "iCloud Drive Backup: sign in again",
        "message": (
            "The iCloud sign-in for {account} has expired. No backups are stored "
            "in iCloud until you sign in again.\n\n"
            "Open Settings → Devices & services → iCloud Drive Backup and choose "
            "“Re-authenticate” (password + 2FA code)."
        ),
        "push": "The iCloud sign-in for {account} has expired. Please sign in again in Home Assistant, otherwise no backups are stored.",
        "test_title": "iCloud Drive Backup: test message",
        "test": "This is how the notification looks when you need to sign in to iCloud again.",
    },
}


def _text(hass: HomeAssistant) -> dict[str, str]:
    return _TEXT["de" if (hass.config.language or "").startswith("de") else "en"]


def _notification_id(entry: ConfigEntry) -> str:
    return f"{DOMAIN}_reauth_{entry.entry_id}"


def available_notify_services(hass: HomeAssistant) -> list[str]:
    """Return legacy notify services (e.g. mobile_app_iphone) users can pick."""
    services = hass.services.async_services().get("notify", {})
    return sorted(
        name
        for name in services
        if name not in ("send_message", "persistent_notification")
    )


async def _async_push(
    hass: HomeAssistant, services: list[str], title: str, message: str
) -> None:
    for service in services:
        if not hass.services.has_service("notify", service):
            _LOGGER.warning("Notify service notify.%s not found", service)
            continue
        payload: dict = {"title": title, "message": message}
        if service.startswith("mobile_app_"):
            # Tapping opens the integration (iOS: url, Android: clickAction).
            payload["data"] = {"url": LINK, "clickAction": LINK}
        try:
            await hass.services.async_call("notify", service, payload, blocking=True)
        except Exception as err:  # noqa: BLE001 - a broken notifier must not break us
            _LOGGER.warning("Could not send notification via notify.%s: %s", service, err)


async def async_notify_reauth(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Tell the user to sign in again (once per expired session)."""
    notified: set[str] = hass.data.setdefault(_NOTIFIED, set())
    if entry.entry_id in notified:
        return
    notified.add(entry.entry_id)
    text = _text(hass)
    account = entry.data.get("username", entry.title)
    if entry.options.get(CONF_NOTIFY_PERSISTENT, True):
        persistent_notification.async_create(
            hass,
            text["message"].format(account=account) + f"\n\n[→ iCloud Drive Backup]({LINK})",
            title=text["title"],
            notification_id=_notification_id(entry),
        )
    await _async_push(
        hass,
        entry.options.get(CONF_NOTIFY_SERVICES, []),
        text["title"],
        text["push"].format(account=account),
    )


@callback
def async_clear_reauth(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Sign-in works again: remove the hint and allow a new notification later."""
    hass.data.setdefault(_NOTIFIED, set()).discard(entry.entry_id)
    persistent_notification.async_dismiss(hass, _notification_id(entry))


async def async_send_test(
    hass: HomeAssistant, entry: ConfigEntry, options: dict
) -> None:
    """Send a test message through the channels in ``options``."""
    text = _text(hass)
    if options.get(CONF_NOTIFY_PERSISTENT, True):
        persistent_notification.async_create(
            hass,
            text["test"],
            title=text["test_title"],
            notification_id=f"{DOMAIN}_test_{entry.entry_id}",
        )
    await _async_push(
        hass, options.get(CONF_NOTIFY_SERVICES, []), text["test_title"], text["test"]
    )
