"""Verify the URL-safety regex used by the workflow's input validation.

Reads the pattern out of the workflow file itself so the test cannot drift from
what CI actually runs.
"""
import io
import re
import sys

wf = io.open(".github/workflows/process-video.yml", encoding="utf-8").read()
m = re.search(r"if re\.search\(r\"(\[[^\"]*\])\", url\)", wf)
if not m:
    print("FAIL: could not find the validator regex in the workflow")
    sys.exit(1)

pattern = re.compile(m.group(1))
print(f"pattern extracted from workflow: [{m.group(1)}]\n")

cases = [
    # (url, should_be_rejected, label)
    ("https://youtu.be/WISu-EM_aPc?si=sSd1HQhzvr0dOWQn", False, "youtube share link"),
    ("https://www.youtube.com/watch?v=abc&list=PLxyz", False, "youtube with &list"),
    ("https://www.youtube.com/live/dV0OgeSbYPM?si=x", False, "youtube live"),
    ("https://www.facebook.com/watch/?v=123&ref=share", False, "facebook with params"),
    ("https://clipmint.novamintnetworks.in/?fbclid=abc", False, "wrong host (caught by host allowlist, not this regex)"),
    ("https://example.com/video.mp4", False, "direct mp4"),
    ("https://vimeo.com/123456789", False, "vimeo"),
    ("https://drive.google.com/file/d/ABC123/view", False, "google drive"),
    ("https://youtu.be/abc`whoami`", True, "backtick command substitution"),
    ("https://youtu.be/abc$(whoami)", True, "dollar command substitution"),
    ("https://youtu.be/abc\\", True, "trailing backslash"),
    ("https://youtu.be/abc def", True, "literal space"),
    ("https://youtu.be/abc\nrm -rf /", True, "newline injection"),
]

mismatches = 0
for url, should_reject, label in cases:
    rejected = bool(pattern.search(url))
    ok = rejected == should_reject
    mismatches += 0 if ok else 1
    verdict = "REJECT" if rejected else "allow "
    print(f"  {'ok  ' if ok else 'FAIL'} {verdict}  {label}")

print(f"\n{len(cases) - mismatches}/{len(cases)} cases behave as intended")
sys.exit(1 if mismatches else 0)
