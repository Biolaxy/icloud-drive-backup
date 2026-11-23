"""Small helpers shared by several modules."""

from __future__ import annotations

import json
from pathlib import Path

from homeassistant.config_entries import ConfigEntry

from .const import CONF_FOLDER, DEFAULT_FOLDER

VERSION: str = json.loads((Path(__file__).parent / "manifest.json").read_text())[
    "version"
]


def normalize_folder(folder: str | None) -> str:
    """Normalize a folder path like ' /Backup//HomeAssistant/ '."""
    parts = [part.strip() for part in (folder or "").split("/") if part.strip()]
    return "/".join(parts) or DEFAULT_FOLDER


def entry_folder(entry: ConfigEntry) -> str:
    """Return the folder currently configured for an entry (options win)."""
    return normalize_folder(
        entry.options.get(CONF_FOLDER) or entry.data.get(CONF_FOLDER)
    )
