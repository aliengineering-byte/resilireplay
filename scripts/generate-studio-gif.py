from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
frames_dir = ROOT / ".artifacts" / "studio-capture" / "frames"
output = ROOT / "docs" / "assets" / "studio-campaign.gif"
paths = sorted(frames_dir.glob("*.png"))
if not paths:
    raise SystemExit("No verified Studio capture frames were found")

frames = []
for path in paths:
    image = Image.open(path).convert("RGB")
    image.thumbnail((1200, 750), Image.Resampling.LANCZOS)
    frames.append(image.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))

frames[0].save(
    output,
    save_all=True,
    append_images=frames[1:],
    duration=[1400, 1400, 1900, 1800, 1600, 1800][: len(frames)],
    loop=0,
    optimize=True,
    disposal=2,
)
print(f"Generated verified Studio GIF {output}")
