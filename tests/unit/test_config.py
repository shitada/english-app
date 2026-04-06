"""Unit tests for config loading."""

import pytest
from unittest.mock import patch
from app.config import (
    load_config,
    get_copilot_config,
    get_conversation_topics,
    get_vocabulary_topics,
    get_prompt,
)
import app.config as config_module


@pytest.fixture(autouse=True)
def reset_config():
    """Reset cached config before each test."""
    config_module._config = None
    yield
    config_module._config = None


class TestConfig:
    def test_load_config_returns_dict(self):
        cfg = load_config()
        assert isinstance(cfg, dict)

    def test_copilot_config_has_model(self):
        cfg = get_copilot_config()
        assert "model" in cfg
        assert isinstance(cfg["model"], str)

    def test_copilot_config_has_timeout(self):
        cfg = get_copilot_config()
        assert "timeout" in cfg
        assert isinstance(cfg["timeout"], int)

    def test_conversation_topics_non_empty(self):
        topics = get_conversation_topics()
        assert len(topics) > 0
        assert all("id" in t and "label" in t for t in topics)

    def test_vocabulary_topics_non_empty(self):
        topics = get_vocabulary_topics()
        assert len(topics) > 0
        assert all("id" in t and "label" in t for t in topics)

    def test_get_prompt_returns_string(self):
        prompt = get_prompt("conversation_partner")
        assert isinstance(prompt, str)
        assert len(prompt) > 0
        assert "{scenario}" in prompt

    def test_get_prompt_grammar_checker(self):
        prompt = get_prompt("grammar_checker")
        assert "{user_message}" in prompt

    def test_get_prompt_unknown_returns_empty(self):
        prompt = get_prompt("nonexistent_prompt")
        assert prompt == ""

    def test_missing_config_file(self, tmp_path):
        with patch.object(config_module, "CONFIG_PATH", tmp_path / "missing.yaml"):
            config_module._config = None
            cfg = load_config()
            assert cfg == {}

    def test_non_dict_yaml_string(self, tmp_path):
        """YAML file with bare string root should fall back to empty dict."""
        cfg_file = tmp_path / "config.yaml"
        cfg_file.write_text("hello world\n")
        with patch.object(config_module, "CONFIG_PATH", cfg_file):
            config_module._config = None
            cfg = load_config()
            assert cfg == {}

    def test_non_dict_yaml_integer(self, tmp_path):
        """YAML file with bare integer root should fall back to empty dict."""
        cfg_file = tmp_path / "config.yaml"
        cfg_file.write_text("42\n")
        with patch.object(config_module, "CONFIG_PATH", cfg_file):
            config_module._config = None
            cfg = load_config()
            assert cfg == {}

    def test_non_dict_yaml_list(self, tmp_path):
        """YAML file with list root should fall back to empty dict."""
        cfg_file = tmp_path / "config.yaml"
        cfg_file.write_text("- one\n- two\n")
        with patch.object(config_module, "CONFIG_PATH", cfg_file):
            config_module._config = None
            cfg = load_config()
            assert cfg == {}
