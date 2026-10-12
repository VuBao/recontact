#!/usr/bin/env python3
import argparse
import json
import re
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO

from pdfminer.high_level import extract_text


MAX_PDF_BYTES = 15 * 1024 * 1024


def first_match(patterns, text):
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            return match.group(1).strip(" \t:-")
    return None


def parse_age(text):
    value = first_match([
        r"^(?:age|tuổi|年齢)\s*[:：]?\s*(\d{1,3})\b",
    ], text)
    if value and 0 < int(value) <= 120:
        return int(value)

    born = first_match([
        r"^(?:date of birth|dob|ngày sinh|生年月日)\s*[:：]?\s*(\d{1,4}[./-]\d{1,2}[./-]\d{1,4})",
    ], text)
    if not born:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y"):
        try:
            birth_date = datetime.strptime(born, fmt).date()
            today = date.today()
            age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
            return age if 0 <= age <= 120 else None
        except ValueError:
            pass
    return None


def parse_phone(text):
    for match in re.finditer(r"(?<!\d)(?:\+?\d[\d ()-]{7,}\d)(?!\d)", text):
        value = match.group(0).strip()
        digits = re.sub(r"\D", "", value)
        if 9 <= len(digits) <= 15:
            return value
    return None


def extract_profile(text):
    return {
        "full_name": first_match([
            r"^(?:full name|name|họ tên|氏名)\s*[:：]\s*(.+)$",
        ], text),
        "age": parse_age(text),
        "phone": parse_phone(text),
        "email": first_match([
            r"\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b",
        ], text),
        "current_visa": first_match([
            r"^(?:current visa|visa status|visa hiện tại|在留資格|在留ステータス)\s*[:：]\s*(.+)$",
        ], text),
        "japanese_level": first_match([
            r"\b((?:JLPT\s*)?N[1-5])\b",
            r"^(?:trình độ tiếng nhật|japanese level|日本語能力)\s*[:：]\s*(.+)$",
        ], text),
    }


def pdf_to_text(source):
    return extract_text(source).strip()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True})
        else:
            self.send_json(404, {"error": "Not found."})

    def do_POST(self):
        if self.path != "/extract":
            self.send_json(404, {"error": "Not found."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if size <= 0 or size > MAX_PDF_BYTES:
            self.send_json(413, {"error": "PDF must be between 1 byte and 15 MB."})
            return

        try:
            text = pdf_to_text(BytesIO(self.rfile.read(size)))
        except Exception:
            self.send_json(422, {"error": "Could not read this PDF."})
            return
        if not text:
            self.send_json(422, {"error": "PDF has no selectable text. OCR is required."})
            return
        self.send_json(200, extract_profile(text))

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return


def main():
    parser = argparse.ArgumentParser(description="Extract CV fields from a local PDF without AI.")
    parser.add_argument("pdf", nargs="?")
    parser.add_argument("--text", action="store_true")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--port", type=int, default=8790)
    args = parser.parse_args()

    if args.serve:
        ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
        return
    if not args.pdf:
        parser.error("provide a PDF path or use --serve")
    text = pdf_to_text(args.pdf)
    print(text if args.text else json.dumps(extract_profile(text), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
