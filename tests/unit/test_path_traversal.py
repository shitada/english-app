"""Unit tests for path traversal protection in SPA fallback."""

import pytest
from pathlib import Path
from unittest.mock import patch

from app.main import _safe_static_path


@pytest.mark.unit
class TestSafeStaticPath:
    def test_normal_file_within_base(self, tmp_path):
        (tmp_path / "index.html").write_text("<html>")
        result = _safe_static_path(tmp_path, "index.html")
        assert result is not None
        assert result.name == "index.html"

    def test_nonexistent_file_returns_none(self, tmp_path):
        result = _safe_static_path(tmp_path, "nonexistent.html")
        assert result is None

    def test_path_traversal_blocked(self, tmp_path):
        # Create a file outside the base directory
        result = _safe_static_path(tmp_path, "../../../etc/passwd")
        assert result is None

    def test_double_dot_in_middle_blocked(self, tmp_path):
        result = _safe_static_path(tmp_path, "foo/../../bar")
        assert result is None

    def test_subdirectory_file_allowed(self, tmp_path):
        sub = tmp_path / "sub"
        sub.mkdir()
        (sub / "style.css").write_text("body{}")
        result = _safe_static_path(tmp_path, "sub/style.css")
        assert result is not None
        assert result.name == "style.css"

    def test_directory_returns_none(self, tmp_path):
        (tmp_path / "subdir").mkdir()
        result = _safe_static_path(tmp_path, "subdir")
        assert result is None

    def test_empty_path(self, tmp_path):
        result = _safe_static_path(tmp_path, "")
        assert result is None
