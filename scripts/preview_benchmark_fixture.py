"""Create deterministic file previews for the Windows/SSH performance journey."""

import argparse
import hashlib
from pathlib import Path


def write_source(path: Path, marker: str) -> None:
    size = 8 * 1024 * 1024
    head = f"FIRST SOURCE BODY {marker}\n".encode()
    tail = f"\nLAST SOURCE BODY {marker}\n".encode()
    line = b"event=preview phase=receive subsystem=architecture status=stable revision=20261128\n"
    count, extra = divmod(size - len(head) - len(tail), len(line))
    path.write_bytes(head + line * count + line[:extra] + tail)


def write_design(path: Path, marker: str) -> None:
    blocks = [
        f"# SYSTEM DESIGN {marker}",
        f"FIRST DESIGN BODY {marker}",
        "[Jump to final acceptance][acceptance] and see the [review glossary][glossary].",
        "| Plane | Status |\n| --- | --- |\n| Control | OPENING TABLE CELL |",
        "```mermaid\nflowchart LR\n  A[DESIGN INPUT] --> B[DESIGN OUTPUT]\n```",
        "Opening energy $E=mc^2$ stays inside the paragraph.",
        "$$\n\\sum_{n=1}^{5} n = 15\n$$",
        "```text\n## FENCED TITLE\n[acceptance]: #wrong-target\n$$ must stay literal $$\n```",
    ]
    for section in range(1, 281):
        blocks.append(f"## Engineering section {section:03d}")
        for note in range(1, 9):
            blocks.append(
                f"Section {section:03d}, review note {note}. The controller records the accepted input, assigns "
                "a revision to each dependency, and reports the same clock interval to the diagnostics pipeline. "
                "The reviewer compares these values with the expected system boundary before releasing the change."
            )
        blocks.append(f"$$\n\\sum_{{k=1}}^{{{section}}} \\frac{{k^2 + {section}}}{{k + 1}}\n$$")
        if section % 30 == 0:
            blocks.append(f"```mermaid\nflowchart LR\n  A[Section {section} input] --> B[Verified output]\n```")
    blocks.extend([
        "## REVIEW GLOSSARY",
        "GLOBAL REFERENCE DESTINATION.",
        "## FINAL ACCEPTANCE",
        "LATE DESIGN SECTION REACHED.",
        "```mermaid\nsequenceDiagram\n  participant A as FINAL REVIEWER\n"
        "  participant B as DESIGN OWNER\n  A->>B: LATE DIAGRAM PROOF\n```",
        "Late inline term $a^2+b^2=c^2$ concludes the section.",
        "$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$",
        "[Back to first page](#)",
        "[acceptance]: #final-acceptance\n[glossary]: #review-glossary",
        f"FINAL DESIGN SOURCE MARKER {marker}",
    ])
    path.write_text("\n\n".join(blocks) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("location", choices=("NTFS", "SSH"))
    args = parser.parse_args()
    args.folder.mkdir(parents=True, exist_ok=True)
    for variant in ("A", "B"):
        marker = f"{args.location} {variant}"
        source = args.folder / f"0{1 if variant == 'A' else 2}-source-{variant}.txt"
        design = args.folder / f"0{3 if variant == 'A' else 4}-design-{variant}.md"
        write_source(source, marker)
        write_design(design, marker)
        for file in (source, design):
            content = file.read_bytes()
            words = f", {len(content.split())} words" if file == design else ""
            print(f"{file.name}: {len(content)} bytes{words}, sha256={hashlib.sha256(content).hexdigest()}")


if __name__ == "__main__":
    main()
