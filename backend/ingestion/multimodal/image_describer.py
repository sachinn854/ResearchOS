import base64
import logging

from groq import Groq

from backend.core.config import settings

log = logging.getLogger("researchos.ingestion.multimodal")

_groq = Groq(api_key=settings.groq_api_key)

# Groq vision model — supports image input
_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

_PROMPT = (
    "Describe this figure from a research paper. "
    "Focus on what it shows — key values, trends, relationships, or architecture. "
    "Be concise (2-3 sentences)."
)


def describe_image(image_bytes: bytes) -> str | None:
    """Send raw image bytes to Groq vision and return a text description.

    Returns None on failure so callers can safely skip the image.
    Minimum size check avoids sending tiny icons or decorative elements.
    """
    if len(image_bytes) < 5_000:  # skip images < 5 KB (likely icons/borders)
        return None

    try:
        b64 = base64.standard_b64encode(image_bytes).decode("utf-8")
        response = _groq.chat.completions.create(
            model=_VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{b64}"},
                        },
                        {"type": "text", "text": _PROMPT},
                    ],
                }
            ],
            max_tokens=200,
        )
        description = response.choices[0].message.content.strip()
        log.debug("[multimodal] described image (%d bytes): %s", len(image_bytes), description[:80])
        return description
    except Exception as exc:
        log.warning("[multimodal] image description failed: %s", exc)
        return None
