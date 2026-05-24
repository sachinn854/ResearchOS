_REPORT_PROMPT = """\
You are a research assistant. Answer the user's question using only the context provided below.
{history_section}
Context:
{context}

Question: {question}

Instructions:
- Base your answer strictly on the context above.
- Cite sources using [1], [2], etc. where relevant.
- If the context does not contain enough information to answer, say so clearly.
- Be concise and accurate.

Answer:\
"""

_HISTORY_SECTION = """\
Previous conversation (for continuity only — do not answer from memory):
{exchanges}

"""


def build_report_prompt(
    context: str,
    question: str,
    conversation_history: list[dict] | None = None,
) -> str:
    history_section = ""
    if conversation_history:
        exchanges = "\n".join(
            f"{m['role'].capitalize()}: {m['content'][:300]}"
            for m in conversation_history[-6:]  # last 3 Q&A pairs
        )
        history_section = _HISTORY_SECTION.format(exchanges=exchanges)

    return _REPORT_PROMPT.format(
        history_section=history_section,
        context=context,
        question=question,
    )
