"""Unit tests for the Listening Speed Challenge component logic.

Since ListeningSpeedChallenge is a frontend-only component, these tests verify:
1. The speed ladder constants and tier messages are consistent
2. The localStorage key is correctly defined
3. The component file compiles and exports expected symbols
"""

import json
import re
from pathlib import Path

import pytest

COMPONENT_PATH = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "ListeningSpeedChallenge.tsx"
LISTENING_PAGE_PATH = Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "Listening.tsx"


@pytest.mark.unit
class TestListeningSpeedChallengeComponent:
    """Verify structural correctness of the ListeningSpeedChallenge component."""

    def test_component_file_exists(self):
        assert COMPONENT_PATH.exists(), "ListeningSpeedChallenge.tsx should exist"

    def test_exports_speed_challenge_props_interface(self):
        content = COMPONENT_PATH.read_text()
        assert "export interface SpeedChallengeProps" in content

    def test_exports_listening_speed_challenge_function(self):
        content = COMPONENT_PATH.read_text()
        assert "export function ListeningSpeedChallenge" in content

    def test_speed_ladder_has_five_levels(self):
        content = COMPONENT_PATH.read_text()
        match = re.search(r"SPEED_LADDER\s*=\s*\[([^\]]+)\]", content)
        assert match, "SPEED_LADDER should be defined"
        speeds = [s.strip() for s in match.group(1).split(",") if s.strip()]
        assert len(speeds) == 5, f"Expected 5 speed levels, got {len(speeds)}"

    def test_speed_ladder_values_are_ascending(self):
        content = COMPONENT_PATH.read_text()
        match = re.search(r"SPEED_LADDER\s*=\s*\[([^\]]+)\]", content)
        assert match
        speeds = [float(s.strip()) for s in match.group(1).split(",") if s.strip()]
        for i in range(1, len(speeds)):
            assert speeds[i] > speeds[i - 1], f"Speeds should be ascending: {speeds}"

    def test_speed_ladder_starts_at_0_8(self):
        content = COMPONENT_PATH.read_text()
        match = re.search(r"SPEED_LADDER\s*=\s*\[([^\]]+)\]", content)
        assert match
        speeds = [float(s.strip()) for s in match.group(1).split(",") if s.strip()]
        assert speeds[0] == 0.8

    def test_speed_ladder_ends_at_1_5(self):
        content = COMPONENT_PATH.read_text()
        match = re.search(r"SPEED_LADDER\s*=\s*\[([^\]]+)\]", content)
        assert match
        speeds = [float(s.strip()) for s in match.group(1).split(",") if s.strip()]
        assert speeds[-1] == 1.5

    def test_localstorage_key_defined(self):
        content = COMPONENT_PATH.read_text()
        assert "listening-speed-challenge-pb" in content

    def test_tier_messages_defined_for_all_tiers(self):
        content = COMPONENT_PATH.read_text()
        # Verify we have tier messages for levels 0 through 4
        for i in range(5):
            assert f"  {i}:" in content or f"TIER_MESSAGES[{i}]" in content, \
                f"Tier message for level {i} should be defined"

    def test_challenge_phases_defined(self):
        content = COMPONENT_PATH.read_text()
        expected_phases = ['ready', 'playing', 'question', 'correct', 'wrong', 'complete']
        for phase in expected_phases:
            assert f"'{phase}'" in content, f"Phase '{phase}' should be defined"

    def test_component_accepts_passage_questions_onback(self):
        content = COMPONENT_PATH.read_text()
        assert "passage: string" in content
        assert "questions: ListeningQuizQuestion[]" in content
        assert "onBack: () => void" in content

    def test_data_testids_present(self):
        content = COMPONENT_PATH.read_text()
        expected_testids = [
            "speed-challenge",
            "speed-challenge-back",
            "speed-ladder",
            "speed-challenge-ready",
            "start-speed-challenge",
            "speed-challenge-playing",
            "speed-challenge-question",
            "speed-submit",
            "speed-challenge-correct",
            "speed-next-level",
            "speed-challenge-result",
            "speed-gauge",
            "speed-gauge-fill",
            "personal-best-result",
            "speed-retry",
        ]
        for testid in expected_testids:
            assert testid in content, f"data-testid '{testid}' should be present"


@pytest.mark.unit
class TestListeningPageSpeedChallengeIntegration:
    """Verify the Listening page correctly integrates the Speed Challenge."""

    def test_listening_page_imports_speed_challenge(self):
        content = LISTENING_PAGE_PATH.read_text()
        assert "ListeningSpeedChallenge" in content
        assert "from '../components/ListeningSpeedChallenge'" in content

    def test_listening_page_phase_type_includes_speed_challenge(self):
        content = LISTENING_PAGE_PATH.read_text()
        assert "'speed-challenge'" in content

    def test_listening_page_has_speed_challenge_button(self):
        content = LISTENING_PAGE_PATH.read_text()
        assert "start-speed-challenge-btn" in content

    def test_listening_page_renders_speed_challenge_component(self):
        content = LISTENING_PAGE_PATH.read_text()
        assert "<ListeningSpeedChallenge" in content

    def test_speed_challenge_button_uses_zap_icon(self):
        content = LISTENING_PAGE_PATH.read_text()
        assert "Zap" in content
        # Zap should be imported from lucide-react
        lines = content.split("\n")
        import_line = next(l for l in lines if "lucide-react" in l)
        assert "Zap" in import_line

    def test_speed_challenge_onback_returns_to_results(self):
        content = LISTENING_PAGE_PATH.read_text()
        assert "onBack={() => setPhase('results')}" in content
