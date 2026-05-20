_REPORT_PROMPT = """\
You are a research assistant. Answer the user's question using only the context provided below.

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


def build_report_prompt(context: str, question: str) -> str:
    return _REPORT_PROMPT.format(context=context, question=question)
