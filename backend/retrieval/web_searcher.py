import logging

import httpx

from backend.core.config import settings

log = logging.getLogger("researchos.retrieval.web")


def search_web(query: str, max_results: int = 5) -> list[dict]:
    """Search the web for relevant content.

    Uses Tavily if TAVILY_API_KEY is configured (best quality).
    Falls back to DuckDuckGo Instant Answer API (no key needed, limited).
    Returns list of {"title": ..., "url": ..., "content": ...}.
    """
    if settings.tavily_api_key:
        return _tavily_search(query, max_results)
    return _duckduckgo_search(query, max_results)


def _tavily_search(query: str, max_results: int) -> list[dict]:
    from tavily import TavilyClient
    log.info("[web] Tavily search | query=%r", query[:60])
    try:
        client = TavilyClient(api_key=settings.tavily_api_key)
        response = client.search(
            query=query,
            max_results=max_results,
            search_depth="advanced",
            include_raw_content=False,
        )
        results = [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": r.get("content", ""),
            }
            for r in response.get("results", [])
        ]
        log.info("[web] Tavily returned %d results", len(results))
        return results
    except Exception as exc:
        log.warning("[web] Tavily failed: %s", exc)
        return []


def _duckduckgo_search(query: str, max_results: int) -> list[dict]:
    """DuckDuckGo Instant Answer API — no API key, limited content."""
    log.info("[web] DuckDuckGo search | query=%r", query[:60])
    try:
        resp = httpx.get(
            "https://api.duckduckgo.com/",
            params={"q": query, "format": "json", "no_redirect": "1"},
            timeout=10,
            follow_redirects=True,
        )
        data = resp.json()
        results = []

        # Abstract (main answer)
        if data.get("AbstractText"):
            results.append({
                "title": data.get("Heading", query),
                "url": data.get("AbstractURL", ""),
                "content": data["AbstractText"],
            })

        # Related topics
        for topic in data.get("RelatedTopics", [])[:max_results - 1]:
            if isinstance(topic, dict) and topic.get("Text"):
                results.append({
                    "title": topic.get("Text", "")[:80],
                    "url": topic.get("FirstURL", ""),
                    "content": topic.get("Text", ""),
                })

        log.info("[web] DuckDuckGo returned %d results", len(results))
        return results
    except Exception as exc:
        log.warning("[web] DuckDuckGo failed: %s", exc)
        return []
