"""Application configuration loaded from config.yaml."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT_DIR / "config.yaml"

_config: dict[str, Any] | None = None


def load_config() -> dict[str, Any]:
    global _config
    if _config is not None:
        return _config

    if not CONFIG_PATH.exists():
        logger.warning("Config file not found at %s, using defaults", CONFIG_PATH)
        _config = {}
        return _config

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    if not isinstance(raw, dict):
        logger.warning("Config file %s has non-mapping root (%s), using defaults", CONFIG_PATH, type(raw).__name__)
        raw = {}
    _config = raw

    logger.info("Config loaded from %s", CONFIG_PATH)
    return _config


def get_copilot_config() -> dict[str, Any]:
    return load_config().get("copilot", {})


def get_logging_config() -> dict[str, Any]:
    return load_config().get("logging", {})


def get_conversation_topics() -> list[dict[str, str]]:
    return load_config().get("conversation_topics", [])


def get_vocabulary_topics() -> list[dict[str, str]]:
    return load_config().get("vocabulary_topics", [])


def get_prompt(name: str) -> str:
    prompts = load_config().get("prompts", {})
    prompt = prompts.get(name, "")
    if not prompt:
        logger.warning("Prompt '%s' not found in config", name)
    return prompt
