import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "tools" / "local_pdf_extractor.py"
SPEC = importlib.util.spec_from_file_location("local_pdf_extractor", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ExtractProfileTest(unittest.TestCase):
    def test_extracts_requested_fields(self):
        result = MODULE.extract_profile("""Full Name: NGUYEN VAN A
Age: 28
Phone: 090-1234-5678
Email: a@example.com
Current Visa: Kỹ năng đặc định
Japanese Level: JLPT N2
""")

        self.assertEqual(result["full_name"], "NGUYEN VAN A")
        self.assertEqual(result["age"], 28)
        self.assertEqual(result["phone"], "090-1234-5678")
        self.assertEqual(result["email"], "a@example.com")
        self.assertEqual(result["current_visa"], "Kỹ năng đặc định")
        self.assertEqual(result["japanese_level"], "JLPT N2")


if __name__ == "__main__":
    unittest.main()
