from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
TRANSCRIPT = ROOT / "docs" / "assets" / "everywhere-demo-transcript.txt"
PNG = ROOT / "docs" / "assets" / "everywhere-demo.png"
GIF = ROOT / "docs" / "assets" / "everywhere-demo.gif"

lines = TRANSCRIPT.read_text(encoding="utf-8").splitlines()
font_path = Path("C:/Windows/Fonts/consola.ttf")
bold_path = Path("C:/Windows/Fonts/consolab.ttf")
font = ImageFont.truetype(str(font_path), 23) if font_path.exists() else ImageFont.load_default()
bold = ImageFont.truetype(str(bold_path), 24) if bold_path.exists() else font

WIDTH, HEIGHT = 1240, 720

def frame(visible: int) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), "#0d1117")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((20, 20, WIDTH - 20, HEIGHT - 20), radius=18, fill="#161b22", outline="#30363d", width=2)
    draw.ellipse((45, 43, 61, 59), fill="#ff5f56")
    draw.ellipse((70, 43, 86, 59), fill="#ffbd2e")
    draw.ellipse((95, 43, 111, 59), fill="#27c93f")
    draw.text((WIDTH - 250, 38), "EVERYWHERE / v0.6.0", font=font, fill="#8b949e")
    y = 86
    for index, line in enumerate(lines[:visible]):
        color = "#f0f6fc"
        active_font = font
        if index == 0:
            color, active_font = "#79c0ff", bold
        elif line.startswith("$"):
            color = "#7ee787"
        elif line.startswith("Failure:"):
            color = "#ffa657"
        elif line.startswith("Evidence:"):
            color = "#d2a8ff"
        elif line.startswith("PASS"):
            color, active_font = "#56d364", bold
        elif line.startswith("wall=") or line.startswith("capture="):
            color = "#8b949e"
        display = line if len(line) <= 92 else line[:89] + "..."
        draw.text((52, y), display, font=active_font, fill=color)
        y += 42
    draw.text((52, HEIGHT - 52), "Sanitized fixture · passive capture · deterministic regression", font=font, fill="#8b949e")
    return image

final = frame(len(lines))
final.save(PNG, optimize=True)
stages = [3, 6, 9, len(lines)]
frames = [frame(value) for value in stages]
frames[0].save(GIF, save_all=True, append_images=frames[1:], duration=[2200, 2600, 2800, 4200], loop=0, optimize=True)
print(f"wrote {PNG} and {GIF}")
