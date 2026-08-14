"""Erzeugt die App-Icons für Bier-Locator (PWA/manifest) mit Pillow.
Zeichnet einen stilisierten Bierkrug im Farbschema der App.
"""
from PIL import Image, ImageDraw
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT_DIR, exist_ok=True)

BG_DARK = (32, 28, 23, 255)      # --header-bg
AMBER = (184, 114, 42, 255)      # --accent
AMBER_DARK = (156, 95, 32, 255)  # --accent-hover
FOAM = (250, 244, 230, 255)
GLASS = (255, 250, 240, 60)      # leicht transparentes Glas-Highlight
OUTLINE = (20, 17, 13, 255)


def draw_mug(size, padding_ratio=0.0):
    """Zeichnet den Krug zentriert auf ein quadratisches Canvas der Größe `size`,
    mit `padding_ratio` zusätzlichem Rand (für maskable Icons)."""
    img = Image.new("RGBA", (size, size), BG_DARK)
    d = ImageDraw.Draw(img)

    pad = size * padding_ratio
    content = size - 2 * pad
    s = content / 100.0  # Skalierungsfaktor, Zeichnung im 100x100-Raster

    def pt(x, y):
        return (pad + x * s, pad + y * s)

    body_box = [pt(22, 30), pt(72, 88)]

    # Henkel: volles Oval mit ausgeschnittenem Loch, zuerst gezeichnet — der Körper
    # wird danach darüber gelegt, sodass nur die rechte "Öse" als Henkel stehen bleibt.
    handle_outer = [pt(56, 36), pt(92, 80)]
    handle_inner = [pt(64, 45), pt(84, 71)]
    d.ellipse(handle_outer, fill=OUTLINE)
    d.ellipse([pt(58, 38), pt(90, 78)], fill=AMBER_DARK)
    d.ellipse(handle_inner, fill=BG_DARK)

    # Krug-Körper (abgerundetes Rechteck) über den linken Teil des Henkels
    d.rounded_rectangle(body_box, radius=8 * s, fill=AMBER, outline=OUTLINE, width=max(1, round(2.2 * s)))

    # Bierstand (helleres Amber oben im Glas)
    d.rectangle([pt(26, 34), pt(68, 46)], fill=AMBER_DARK)

    # Schaum obenauf
    foam_box = [pt(18, 16), pt(76, 36)]
    d.ellipse(foam_box, fill=FOAM, outline=OUTLINE, width=max(1, round(2 * s)))
    # ein paar Schaumblasen
    for bx, by, br in [(30, 14, 5), (45, 10, 6), (60, 15, 4.5)]:
        d.ellipse([pt(bx - br, by - br), pt(bx + br, by + br)], fill=FOAM, outline=OUTLINE, width=max(1, round(1.5 * s)))

    # Glanzlicht am Krug
    d.line([pt(30, 40), pt(30, 78)], fill=(255, 255, 255, 90), width=max(1, round(3 * s)))

    return img


def save(img, name):
    path = os.path.join(OUT_DIR, name)
    img.save(path)
    print("wrote", path)


# Standard-Icons (any purpose)
save(draw_mug(192), "icon-192.png")
save(draw_mug(512), "icon-512.png")
save(draw_mug(180), "apple-touch-icon.png")
save(draw_mug(32), "favicon-32.png")
save(draw_mug(16), "favicon-16.png")

# Maskable Icon: 512px mit ~15% Sicherheitsrand, damit Android es beliebig beschneiden kann
save(draw_mug(512, padding_ratio=0.12), "icon-512-maskable.png")
save(draw_mug(192, padding_ratio=0.12), "icon-192-maskable.png")

print("done")
