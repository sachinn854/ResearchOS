import base64
import logging

from backend.core.config import settings
from backend.core.llm import llm as _llm

log = logging.getLogger("researchos.ingestion.multimodal")

_PROMPT = (
    "Describe this figure from a research paper. "
    "Focus on what it shows — key values, trends, relationships, or architecture. "
    "Be concise (2-3 sentences)."
)

_MIN_IMAGE_BYTES = 1_000  # BUG-037: lowered from 5KB — small diagrams are valid


def describe_image(image_bytes: bytes, image_ext: str = "png") -> str | None:
    """Describe an image using a vision LLM.

    BUG-001: provider_kwargs() NOT used — it forces LLM_PROVIDER routing which
    breaks vision calls (e.g. W&B doesn't host vision models). Vision calls use
    allow_fallbacks=True so OpenRouter picks the best available provider.

    BUG-002: uses actual image format from image_ext instead of hardcoding image/png.
    """
    if len(image_bytes) < _MIN_IMAGE_BYTES:
        log.info("[multimodal] skipping image — too small (%d bytes)", len(image_bytes))
        return None

    ext = image_ext.lstrip(".").lower()
    # Normalise obscure PDF formats to their HTTP MIME equivalent
    if ext in ("jbig2", "jpeg2000", "jp2"):
        ext = "jpeg"
    mime = f"image/{ext}"

    try:
        b64 = base64.standard_b64encode(image_bytes).decode("utf-8")
        response = _llm.chat.completions.create(
            model=settings.vision_llm_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                        {"type": "text", "text": _PROMPT},
                    ],
                }
            ],
            max_tokens=200,
            extra_body={"provider": {"allow_fallbacks": True}},
        )
        description = (response.choices[0].message.content or "").strip()
        if not description:
            log.warning("[multimodal] vision model returned empty response — model may not support image input")
            return None
        log.debug("[multimodal] described image (%d bytes): %s", len(image_bytes), description[:80])
        return description
    except Exception as exc:
        log.warning("[multimodal] image description failed: %s", exc)
        return None
