from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "assets"
TRANSCRIPT = ASSETS / "mcp-demo-v0.7.0-transcript.txt"
PNG = ASSETS / "mcp-demo-v0.7.0.png"
GIF = ASSETS / "mcp-demo-v0.7.0.gif"
WIDTH, HEIGHT = 1200, 760


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/consolab.ttf" if bold else "C:/Windows/Fonts/consola.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


BODY = font(27)
TITLE = font(18, True)
SMALL = font(20)
CHECK = ImageFont.truetype("C:/Windows/Fonts/seguisym.ttf", 27) if Path("C:/Windows/Fonts/seguisym.ttf").exists() else BODY


def render(lines: list[str], visible: int) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), "#0b1e24")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((28, 24, WIDTH - 28, HEIGHT - 24), radius=18, fill="#10232a", outline="#41605e", width=2)
    draw.rounded_rectangle((28, 24, WIDTH - 28, 82), radius=18, fill="#17323a")
    draw.rectangle((28, 62, WIDTH - 28, 82), fill="#17323a")
    for index, color in enumerate(("#ff6b6b", "#f3b94f", "#c8ff45")):
        x = 58 + index * 31
        draw.ellipse((x, 43, x + 15, 58), fill=color)
    draw.text((WIDTH - 300, 42), "RESILIREPLAY · MCP", fill="#abc0bd", font=TITLE)
    y = 112
    for line in lines[:visible]:
        if not line:
            y += 24
            continue
        color = "#dce7e3"
        line_font = BODY
        if line.startswith("$"):
            color = "#c8ff45"
        elif line.startswith("✓") or "passed." in line:
            color = "#c8ff45"
            line_font = CHECK if line.startswith("✓") else BODY
        elif line.startswith("Evidence:"):
            color = "#72d7cf"
            line_font = SMALL
        draw.text((66, y), line, fill=color, font=line_font)
        y += 45
    draw.text((66, HEIGHT - 40), "packed npm package · no account · no telemetry · temporary state removed", fill="#809895", font=TITLE)
    return image


lines = TRANSCRIPT.read_text(encoding="utf-8").splitlines()
frames = []
for visible in range(1, len(lines) + 1):
    frames.append(render(lines, visible))
frames[-1].save(PNG, optimize=True)
frames[0].save(
    GIF,
    save_all=True,
    append_images=frames[1:],
    duration=[700] * (len(frames) - 1) + [2600],
    loop=0,
    optimize=True,
)
print(f"Rendered {PNG.name} and {GIF.name} from {TRANSCRIPT.name}")
