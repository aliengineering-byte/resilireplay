#!/usr/bin/env python3
"""Capture the packed v0.4 CLI and render its genuine demo output."""

from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import time

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "assets"
TARBALL = ROOT / ".artifacts" / "package-smoke" / "resilireplay-0.4.0.tgz"
PACKED_CLI = (
    ROOT
    / ".artifacts"
    / "package-smoke"
    / "installed"
    / "node_modules"
    / "resilireplay"
    / "bin"
    / "resilireplay.mjs"
)
ANSI = re.compile(r"\x1b\[[0-9;]*m")
WIDTH = 1200
HEIGHT = 675


def font(candidates: tuple[str, ...], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


MONO = font(("DejaVuSansMono.ttf", "consola.ttf", "Menlo.ttc"), 23)
MONO_BOLD = font(("DejaVuSansMono-Bold.ttf", "consolab.ttf", "Menlo.ttc"), 23)


def capture() -> tuple[list[str], int]:
    if not TARBALL.is_file() or not PACKED_CLI.is_file():
        raise RuntimeError("run `pnpm package:smoke` before generating adoption assets")
    node_value = os.environ.get("RESILIREPLAY_MEDIA_NODE") or os.environ.get("NODE")
    if not node_value:
        node_value = "node.exe" if os.name == "nt" else "node"
    with tempfile.TemporaryDirectory(prefix="resilireplay-adopt-media-") as temporary:
        temporary_path = Path(temporary)
        started = time.perf_counter()
        result = subprocess.run(
            [
                node_value,
                str(PACKED_CLI),
                "demo",
                "--no-color",
            ],
            cwd=temporary_path,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="strict",
            env={
                **os.environ,
                "NO_COLOR": "1",
                "FORCE_COLOR": "0",
            },
            timeout=30,
            check=False,
        )
        wall_ms = round((time.perf_counter() - started) * 1000)
        output = ANSI.sub("", result.stdout).strip()
        if result.returncode != 0:
            raise RuntimeError(
                f"packed demo exited {result.returncode}: {output}\n{result.stderr.strip()}"
            )
        lines = output.splitlines()
        required = (
            "PASS ResiliReplay demo completed in ",
            "Clean control passed",
            "Generated regression executed successfully",
            "Evidence ",
            "Next: npx --yes resilireplay@0.4.0 adopt --config ./mcp.json --dry-run",
        )
        for expected in required:
            if not any(line.startswith(expected) for line in lines):
                raise RuntimeError(f"packed demo output is missing {expected!r}")
        cli_ms = int(re.search(r"completed in (\d+)ms", lines[0]).group(1))
        if cli_ms >= 30_000 or wall_ms >= 30_000:
            raise RuntimeError(f"demo exceeded 30 seconds: cli={cli_ms}ms wall={wall_ms}ms")
        joined = "\n".join(lines)
        if re.search(r"[A-Za-z]:\\Users\\|/home/|@users\.noreply|PRIVATE|Bearer ", joined):
            raise RuntimeError("captured output contains a personal path or private marker")
        remaining = [entry.name for entry in temporary_path.iterdir()]
        if remaining:
            raise RuntimeError(f"demo left unexpected files: {remaining}")
        return lines, wall_ms


def line_color(line: str) -> str:
    if line.startswith("PASS") or "successfully" in line:
        return "#65d89a"
    if line.startswith("Evidence"):
        return "#d2a8ff"
    if line.startswith("Next:"):
        return "#79c0ff"
    return "#d8dee9"


def render(lines: list[str], visible: int) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), "#07111f")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (24, 24, WIDTH - 24, HEIGHT - 24),
        radius=18,
        fill="#0d1726",
        outline="#26364a",
        width=2,
    )
    draw.rounded_rectangle((24, 24, WIDTH - 24, 80), radius=18, fill="#182538")
    draw.rectangle((24, 58, WIDTH - 24, 80), fill="#182538")
    for x, color in ((54, "#ff5f57"), (84, "#febc2e"), (114, "#28c840")):
        draw.ellipse((x - 7, 51 - 7, x + 7, 51 + 7), fill=color)
    draw.text((146, 39), "ResiliReplay v0.4.0 - genuine packed CLI", font=MONO_BOLD, fill="#e6edf3")
    draw.text((52, 112), "$ npx --yes resilireplay@0.4.0 demo", font=MONO_BOLD, fill="#65d89a")
    y = 178
    for line in lines[:visible]:
        color = line_color(line)
        segments = textwrap.wrap(
            line,
            width=72,
            subsequent_indent="  ",
            break_long_words=False,
            break_on_hyphens=False,
        ) or [""]
        for segment in segments:
            draw.text(
                (52, y),
                segment,
                font=MONO_BOLD if color != "#d8dee9" else MONO,
                fill=color,
            )
            y += 48
    draw.text(
        (52, HEIGHT - 58),
        "clean control -> injected failure -> bounded recovery -> executable regression",
        font=MONO,
        fill="#8b9bb4",
    )
    return image


def main() -> None:
    lines, wall_ms = capture()
    ASSETS.mkdir(parents=True, exist_ok=True)
    transcript = [
        "# Genuine v0.4.0 release-candidate tarball capture",
        "$ node ./node_modules/resilireplay/bin/resilireplay.mjs demo --no-color",
        *lines,
        f"captureWallMs={wall_ms}",
        "networkTarget=local-tarball telemetry=false externalMcp=false apiKeys=false",
    ]
    (ASSETS / "adopt-demo-transcript.txt").write_text(
        "\n".join(transcript) + "\n", encoding="utf-8"
    )
    frames = [render(lines, visible) for visible in (2, 4, len(lines))]
    frames[-1].save(ASSETS / "adopt-demo.png", optimize=True)
    frames[0].save(
        ASSETS / "adopt-demo.gif",
        save_all=True,
        append_images=frames[1:],
        duration=[1800, 2200, 3200],
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(f"Generated genuine v0.4 demo media: cli={lines[0]} wall={wall_ms}ms")


if __name__ == "__main__":
    main()
