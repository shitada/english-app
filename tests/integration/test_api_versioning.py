"""Integration tests for API versioning middleware."""

import pytest


@pytest.mark.integration
async def test_v1_health(client):
    """GET /api/v1/health returns same data as /api/health."""
    resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "api_version" in data
    assert data["api_version"] == "v1"


@pytest.mark.integration
async def test_v1_conversation_topics(client):
    """GET /api/v1/conversation/topics returns valid topic list."""
    resp = await client.get("/api/v1/conversation/topics")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0


@pytest.mark.integration
async def test_v1_pronunciation_sentences(client):
    """GET /api/v1/pronunciation/sentences returns 200."""
    resp = await client.get("/api/v1/pronunciation/sentences")
    assert resp.status_code == 200


@pytest.mark.integration
async def test_api_version_header_on_versioned(client):
    """X-API-Version header present on /api/v1/* responses."""
    resp = await client.get("/api/v1/health")
    assert resp.headers.get("x-api-version") == "v1"


@pytest.mark.integration
async def test_api_version_header_on_unversioned(client):
    """X-API-Version header present on /api/* responses too."""
    resp = await client.get("/api/health")
    assert resp.headers.get("x-api-version") == "v1"


@pytest.mark.integration
async def test_non_api_path_no_version_header(client):
    """Non-API paths should not have X-API-Version header."""
    resp = await client.get("/")
    assert "x-api-version" not in resp.headers


@pytest.mark.integration
async def test_v1_bare_path(client):
    """/api/v1 bare path doesn't 404."""
    resp = await client.get("/api/v1/dashboard/stats")
    assert resp.status_code == 200
