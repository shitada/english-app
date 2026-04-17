"""E2E tests for the English Practice App using Playwright."""

import re
import pytest
from playwright.sync_api import Page, expect


@pytest.mark.e2e
class TestHomePage:
    def test_home_page_loads(self, page: Page, server: str):
        page.goto(server)
        expect(page.locator("h1")).to_contain_text("English Practice")

    def test_home_has_three_feature_cards(self, page: Page, server: str):
        page.goto(server)
        cards = page.locator(".feature-card")
        expect(cards).to_have_count(4)

    def test_navigation_links(self, page: Page, server: str):
        page.goto(server)
        nav = page.locator("nav")
        expect(nav.locator("a")).to_have_count(5)
        expect(nav.locator("a").nth(0)).to_contain_text("Conversation")
        expect(nav.locator("a").nth(1)).to_contain_text("Pronunciation")
        expect(nav.locator("a").nth(2)).to_contain_text("Listening")
        expect(nav.locator("a").nth(3)).to_contain_text("Vocabulary")
        expect(nav.locator("a").nth(4)).to_contain_text("Dashboard")


@pytest.mark.e2e
class TestConversationPage:
    def test_topic_selection_visible(self, page: Page, server: str):
        page.goto(f"{server}/conversation")
        expect(page.locator("h2")).to_contain_text("Choose a Scenario")
        topics = page.locator(".topic-card")
        expect(topics).to_have_count(6)

    def test_topic_card_labels(self, page: Page, server: str):
        page.goto(f"{server}/conversation")
        page.wait_for_selector(".topic-card")
        first_card = page.locator(".topic-card").first
        expect(first_card).to_be_visible()
        # Each card should have an h3 with the topic name
        expect(first_card.locator("h3")).to_be_visible()

    def test_click_topic_starts_conversation(self, page: Page, server: str):
        page.goto(f"{server}/conversation")
        page.locator(".topic-card").first.click()
        # Should show loading or chat interface
        page.wait_for_selector(".chat-container, .loading", timeout=30000)


@pytest.mark.e2e
class TestPronunciationPage:
    def test_sentence_list_visible(self, page: Page, server: str):
        page.goto(f"{server}/pronunciation")
        expect(page.locator("h2")).to_contain_text("Pronunciation Practice")

    def test_sample_sentences_shown(self, page: Page, server: str):
        page.goto(f"{server}/pronunciation")
        sentences = page.locator(".sentence-item")
        # Should have at least a few sample sentences
        expect(sentences.first).to_be_visible()

    def test_click_sentence_enters_practice(self, page: Page, server: str):
        page.goto(f"{server}/pronunciation")
        page.locator(".sentence-item").first.click()
        # Should show the shadowing practice phase
        expect(page.locator(".sentence-display")).to_be_visible()
        expect(page.get_by_role("button", name="Start Shadowing")).to_be_visible()

    def test_back_button_returns_to_list(self, page: Page, server: str):
        page.goto(f"{server}/pronunciation")
        page.locator(".sentence-item").first.click()
        expect(page.locator(".sentence-display")).to_be_visible()
        page.get_by_text("Back").click()
        expect(page.locator("h2")).to_contain_text("Pronunciation Practice")


@pytest.mark.e2e
class TestVocabularyPage:
    def test_topic_selection_visible(self, page: Page, server: str):
        page.goto(f"{server}/vocabulary")
        expect(page.locator("h2")).to_contain_text("Vocabulary")
        topics = page.locator(".topic-card")
        expect(topics).to_have_count(6)

    def test_click_topic_shows_loading(self, page: Page, server: str):
        page.goto(f"{server}/vocabulary")
        page.locator(".topic-card").first.click()
        # Should show loading spinner or quiz question
        page.wait_for_selector(".loading, .quiz-progress", timeout=60000)


@pytest.mark.e2e
class TestNavigation:
    def test_navigate_to_conversation(self, page: Page, server: str):
        page.goto(server)
        page.locator("nav a", has_text="Conversation").click()
        expect(page).to_have_url(re.compile(r"/conversation"))
        expect(page.locator("h2")).to_contain_text("Choose a Scenario")

    def test_navigate_to_pronunciation(self, page: Page, server: str):
        page.goto(server)
        page.locator("nav a", has_text="Pronunciation").click()
        expect(page).to_have_url(re.compile(r"/pronunciation"))

    def test_navigate_to_vocabulary(self, page: Page, server: str):
        page.goto(server)
        page.locator("nav a", has_text="Vocabulary").click()
        expect(page).to_have_url(re.compile(r"/vocabulary"))

    def test_click_logo_goes_home(self, page: Page, server: str):
        page.goto(f"{server}/conversation")
        page.locator("h1").click()
        expect(page).to_have_url(re.compile(r"/$"))

    def test_feature_card_conversation(self, page: Page, server: str):
        page.goto(server)
        page.locator(".feature-card", has_text="Conversation").click()
        expect(page).to_have_url(re.compile(r"/conversation"))

    def test_feature_card_pronunciation(self, page: Page, server: str):
        page.goto(server)
        page.locator(".feature-card", has_text="Pronunciation").click()
        expect(page).to_have_url(re.compile(r"/pronunciation"))

    def test_feature_card_vocabulary(self, page: Page, server: str):
        page.goto(server)
        page.locator(".feature-card", has_text="Vocabulary").click()
        expect(page).to_have_url(re.compile(r"/vocabulary"))
