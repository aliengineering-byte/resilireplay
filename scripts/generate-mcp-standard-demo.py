#!/usr/bin/env python3
"""Render the verified MCP reliability transcript as a 32-second GIF and PNG."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
TRANSCRIPT = ROOT / "docs" / "assets" / "mcp-reliability-standard-demo-transcript.txt"
GIF = ROOT / "docs" / "assets" / "mcp-reliability-standard-demo.gif"
PNG = ROOT / "docs" / "assets" / "mcp-reliability-standard-demo.png"
WIDTH = 1200
HEIGHT = 760


def load_font(candidates: tuple[str, ...], size: int) -> ImageFont.ImageFont:
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


MONO = load_font(("DejaVuSansMono.ttf", "consola.ttf"), 22)
MONO_BOLD = load_font(("DejaVuSansMono-Bold.ttf", "consolab.ttf"), 22)
SANS_BOLD = load_font(("DejaVuSans-Bold.ttf", "arialbd.ttf"), 34)
SANS = load_font(("DejaVuSans.ttf", "arial.ttf"), 22)


def read_verified_lines() -> list[str]:
    lines = TRANSCRIPT.read_text(encoding="utf-8").splitlines()
    required = (
        "Reviewed campaign mcp-reliability-stdio",
        "Scenarios       3/3 matched expectations",
        "PASSED    canary-expected-failure (fixture; mcp-malicious-canary-instruction)",
        "PASS reproduces the captured ResiliReplay failure (12.5697ms)",
        "INFO pass 1",
        "INFO fail 0",
    )
    missing = [line for line in required if line not in lines]
    if missing:
        raise RuntimeError(f"verified transcript is missing: {', '.join(missing)}")
    if any("E:\\" in line or "C:\\Users\\" in line for line in lines):
        raise RuntimeError("transcript contains a private absolute path")
    return lines


def color(line: str) -> str:
    if line.startswith("$"):
        return "#79c0ff"
    if "PASS" in line or "PASSED" in line or line == "INFO fail 0":
        return "#65d89a"
    if line.startswith("Evidence hash") or line.startswith("Campaign hash"):
        return "#d2a8ff"
    return "#d8dee9"


def render(lines: list[str], step: int, caption: str) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), "#07111f")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((24, 24, WIDTH - 24, HEIGHT - 24), radius=20, fill="#0d1726", outline="#2c4462", width=2)
    draw.rounded_rectangle((24, 24, WIDTH - 24, 84), radius=20, fill="#182538")
    draw.rectangle((24, 64, WIDTH - 24, 84), fill="#182538")
    for x, dot in ((52, "#ff5f57"), (80, "#febc2e"), (108, "#28c840")):
        draw.ellipse((x - 7, 54 - 7, x + 7, 54 + 7), fill=dot)
    draw.text((142, 38), "MCP Reliability Standard - public v0.6.0 run", font=SANS_BOLD, fill="#f0f6fc")
    draw.rounded_rectangle((1010, 36, 1150, 74), radius=18, fill="#17385d")
    draw.text((1030, 42), f"{step}/4", font=MONO_BOLD, fill="#79c0ff")
    draw.text((52, 112), caption, font=SANS, fill="#a9bad0")
    y = 160
    for line in lines:
        shown = line if len(line) <= 91 else line[:88] + "..."
        draw.text((52, y), shown, font=MONO_BOLD if color(line) != "#d8dee9" else MONO, fill=color(line))
        y += 34
    draw.text((52, HEIGHT - 58), "synthetic local fixture - metadata-only evidence - not certification", font=MONO, fill="#8b9bb4")
    return image


def main() -> int:
    lines = read_verified_lines()
    command = lines[0]
    hash_line = next(line for line in lines if line.startswith("Campaign hash"))
    evidence_line = next(line for line in lines if line.startswith("Evidence hash"))
    frames = [
        render([command, lines[1], hash_line], 1, "1. Public package + integrity-bound campaign"),
        render(lines[3:11], 2, "2. Clean control, bounded retry, and expected failure"),
        render([evidence_line, *lines[13:17]], 3, "3. One machine result; the negative control stays failed"),
        render(lines[19:29], 4, "4. Generated causal regression executes with zero failures"),
    ]
    frames[-1].save(PNG, optimize=True)
    frames[0].save(
        GIF,
        save_all=True,
        append_images=frames[1:],
        duration=[8000, 8000, 8000, 8000],
        loop=0,
        optimize=True,
        disposal=2,
    )
    print("Rendered 32-second MCP standard demo from verified transcript.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
