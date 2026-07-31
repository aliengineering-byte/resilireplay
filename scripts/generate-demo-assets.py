#!/usr/bin/env python3
"""Capture the real no-key demo and render reproducible launch assets."""

from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "assets"
ANSI = re.compile(r"\x1b\[[0-9;]*m")
WIDTH = 1000
HEIGHT = 630


def font(candidates: tuple[str, ...], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


MONO = font(("DejaVuSansMono.ttf", "consola.ttf", "Menlo.ttc"), 20)
MONO_BOLD = font(("DejaVuSansMono-Bold.ttf", "consolab.ttf", "Menlo.ttc"), 20)
SANS_BOLD = font(("DejaVuSans-Bold.ttf", "arialbd.ttf", "Arial Bold.ttf"), 54)
SANS = font(("DejaVuSans.ttf", "arial.ttf", "Arial.ttf"), 28)


def run_demo() -> list[str]:
    pnpm = shutil.which("pnpm") or shutil.which("pnpm.cmd")
    if not pnpm:
        raise RuntimeError("pnpm was not found; install dependencies and place pnpm on PATH")
    result = subprocess.run(
        [pnpm, "demo"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env={**os.environ, "NO_COLOR": "1", "FORCE_COLOR": "0"},
        check=False,
    )
    output = ANSI.sub("", f"{result.stdout}\n{result.stderr}")
    if result.returncode != 0:
        raise RuntimeError(f"pnpm demo failed with exit {result.returncode}\n{output}")
    return [line.rstrip() for line in output.splitlines()]


def select_transcript(lines: list[str]) -> list[str]:
    prefixes = (
        "1/5 ",
        "Recorded ",
        "2/5 ",
        "ResiliReplay ",
        "Recovery score",
        "Recovery        ",
        "3/5 ",
        "First critical",
        "4/5 ",
        "# tests ",
        "# pass ",
        "# fail ",
        "ℹ tests ",
        "ℹ pass ",
        "ℹ fail ",
        "5/5 ",
        "Source → fixture hash:",
    )
    selected = [line for line in lines if line.startswith(prefixes)]
    required = (
        "Recorded 8 sanitized events.",
        "ResiliReplay v0.1.0  PASS",
        "Recovery score  100/100",
        "ResiliReplay v0.1.0  FAIL",
        "Recovery score  67/100",
        "5/5 Demo complete",
    )
    missing = [entry for entry in required if entry not in selected]
    if not any(line.endswith("pass 1") for line in selected):
        missing.append("generated regression pass count")
    if not any(line.endswith("fail 0") for line in selected):
        missing.append("generated regression failure count")
    if missing:
        raise RuntimeError(f"demo output is missing verified milestones: {', '.join(missing)}")
    return selected


def color_for(line: str) -> str:
    if " PASS" in line or line.endswith("pass 1") or line.endswith("fail 0"):
        return "#65d89a"
    if " FAIL" in line or "67/100" in line:
        return "#ff7b72"
    if re.match(r"^[1-5]/5 ", line):
        return "#79c0ff"
    if line.startswith("Source →"):
        return "#d2a8ff"
    return "#d8dee9"


def render_terminal(lines: list[str], step: int) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), "#07111f")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((20, 20, WIDTH - 20, HEIGHT - 20), radius=18, fill="#0d1726", outline="#26364a", width=2)
    draw.rounded_rectangle((20, 20, WIDTH - 20, 72), radius=18, fill="#182538")
    draw.rectangle((20, 52, WIDTH - 20, 72), fill="#182538")
    for x, color in ((48, "#ff5f57"), (76, "#febc2e"), (104, "#28c840")):
        draw.ellipse((x - 7, 39 - 7, x + 7, 39 + 7), fill=color)
    draw.text((132, 31), "ResiliReplay · deterministic no-key demo", font=MONO_BOLD, fill="#e6edf3")
    draw.text((48, 96), "$ pnpm demo", font=MONO_BOLD, fill="#65d89a")
    draw.rounded_rectangle((820, 92, 944, 128), radius=18, fill="#17385d")
    draw.text((841, 98), f"STEP {step}/5", font=MONO_BOLD, fill="#79c0ff")
    y = 142
    for line in lines:
        draw.text((48, y), line, font=MONO_BOLD if color_for(line) != "#d8dee9" else MONO, fill=color_for(line))
        y += 30
    draw.text((48, HEIGHT - 56), "record → inject → replay → regression", font=MONO, fill="#8b9bb4")
    return image


def transcript_frames(lines: list[str]) -> list[list[str]]:
    boundaries = [
        next(i for i, line in enumerate(lines) if line.startswith("2/5 ")),
        next(i for i, line in enumerate(lines) if line.startswith("3/5 ")),
        next(i for i, line in enumerate(lines) if line.startswith("4/5 ")),
        next(i for i, line in enumerate(lines) if line.startswith("5/5 ")),
        len(lines),
    ]
    start = 0
    frames = []
    for end in boundaries:
        frames.append(lines[start:end])
        start = end
    return frames


def write_demo_assets(lines: list[str]) -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    (ASSETS / "demo-transcript.txt").write_text("$ pnpm demo\n" + "\n".join(lines) + "\n", encoding="utf-8")
    frames = [render_terminal(segment, index + 1) for index, segment in enumerate(transcript_frames(lines))]
    frames[0].save(
        ASSETS / "resilireplay-demo.gif",
        save_all=True,
        append_images=frames[1:],
        duration=[1700, 2600, 2400, 2500, 2100],
        loop=0,
        optimize=True,
        disposal=2,
    )


def social_svg() -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640" role="img" aria-labelledby="title desc">
  <title id="title">ResiliReplay</title>
  <desc id="desc">Chaos testing for AI agents and MCP servers. Record, Inject, Replay, Regression.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#07111f"/>
      <stop offset="1" stop-color="#102542"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#65d89a"/>
      <stop offset="1" stop-color="#79c0ff"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="640" fill="url(#bg)"/>
  <circle cx="1140" cy="90" r="240" fill="#17385d" opacity=".45"/>
  <circle cx="80" cy="610" r="220" fill="#153a35" opacity=".45"/>
  <rect x="72" y="70" width="12" height="116" rx="6" fill="url(#accent)"/>
  <text x="116" y="170" fill="#f0f6fc" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="84" font-weight="750">ResiliReplay</text>
  <text x="82" y="254" fill="#b8c7d9" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="38">Chaos testing for AI agents and MCP servers</text>
  <g transform="translate(82 338)" font-family="Inter,Segoe UI,Arial,sans-serif">
    <rect width="1116" height="142" rx="28" fill="#0d1726" stroke="#2c4462" stroke-width="2"/>
    <g fill="#e6edf3" font-size="30" font-weight="650" text-anchor="middle">
      <text x="134" y="86">Record</text>
      <text x="414" y="86">Inject</text>
      <text x="694" y="86">Replay</text>
      <text x="974" y="86">Regression</text>
    </g>
    <g fill="#79c0ff" font-size="42" text-anchor="middle">
      <text x="274" y="88">→</text>
      <text x="554" y="88">→</text>
      <text x="834" y="88">→</text>
    </g>
    <g fill="none" stroke-width="5">
      <circle cx="134" cy="38" r="10" stroke="#65d89a"/>
      <path d="M404 32l20 12-20 12z" stroke="#ffb86b"/>
      <path d="M682 39a12 12 0 1 1 6 11" stroke="#79c0ff"/>
      <path d="M965 31h18v18h-18z" stroke="#d2a8ff"/>
    </g>
  </g>
  <text x="82" y="565" fill="#8b9bb4" font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="24">deterministic · model-agnostic · local-first</text>
</svg>
"""


def write_social_preview() -> None:
    svg = social_svg()
    (ASSETS / "social-preview.svg").write_text(svg, encoding="utf-8")
    image = Image.new("RGB", (1280, 640), "#07111f")
    draw = ImageDraw.Draw(image)
    for y in range(640):
        ratio = y / 639
        color = (
            int(7 + (16 - 7) * ratio),
            int(17 + (37 - 17) * ratio),
            int(31 + (66 - 31) * ratio),
        )
        draw.line((0, y, 1280, y), fill=color)
    draw.ellipse((930, -150, 1410, 330), fill="#17385d")
    draw.ellipse((-140, 390, 300, 830), fill="#153a35")
    draw.rounded_rectangle((72, 70, 84, 186), radius=6, fill="#65d89a")
    draw.text((116, 100), "ResiliReplay", font=SANS_BOLD, fill="#f0f6fc")
    draw.text((82, 218), "Chaos testing for AI agents and MCP servers", font=SANS, fill="#b8c7d9")
    draw.rounded_rectangle((82, 338, 1198, 480), radius=28, fill="#0d1726", outline="#2c4462", width=2)
    labels = ("Record", "Inject", "Replay", "Regression")
    centers = (216, 496, 776, 1056)
    for label, center in zip(labels, centers, strict=True):
        box = draw.textbbox((0, 0), label, font=SANS)
        draw.text((center - (box[2] - box[0]) / 2, 387), label, font=SANS, fill="#e6edf3")
    for center in (356, 636, 916):
        draw.text((center - 14, 383), "→", font=SANS, fill="#79c0ff")
    draw.text((82, 548), "deterministic · model-agnostic · local-first", font=MONO, fill="#8b9bb4")
    image.save(ASSETS / "social-preview.png", optimize=True)


def main() -> int:
    lines = select_transcript(run_demo())
    write_demo_assets(lines)
    write_social_preview()
    print("Generated docs/assets/resilireplay-demo.gif and social preview assets from a verified pnpm demo run.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
