import fitz  # PyMuPDF

from backend.ingestion.parsers.base import BaseParser, ParsedPage


class PDFParser(BaseParser):
    def parse(self, source: str) -> list[ParsedPage]:
        pages = []
        with fitz.open(source) as doc:
            for page_num, page in enumerate(doc, start=1):
                text = page.get_text().strip()
                if text:
                    pages.append(ParsedPage(text=text, page_number=page_num))
        return pages
