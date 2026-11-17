"""Final card art: cut the ChatGPT card sheets into one image per card.

Inputs in tools/src-art/club/final/:
  sheet-y / sheet-r / sheet-g / sheet-b   13 cards each on black, in reading order: 0-9, +2, reverse, skip
  wild, wild4, back, deck                  one full card each (deck = the draw pile)

Every card is found on the black background, cut out with a transparent outside (rounded corners stay round),
and resized to one common size so all cards line up in a hand. Writes public/assets/cards/<slot>.webp:
  y0..y9, y-draw2, y-rev, y-skip (same for r g b), wild, wild4, back, deck

Usage: python -I tools/cut_card_sheets.py [--preview out.jpg]
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools/src-art/club/final"
OUT = ROOT / "public/assets/cards"
W, H = 360, 474  # every card ends up this size (the sheets vary a little, so each is fitted to it)
SHEET_ORDER = [str(n) for n in range(10)] + ["-draw2", "-rev", "-skip"]


def src(name: str) -> Path:
    return next(p for p in SRC.glob(name + ".*"))


def cards_in(img: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Boxes of the cards on a black sheet, in reading order."""
    m = (img.max(axis=2) > 60).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    _, _, st, _ = cv2.connectedComponentsWithStats(m)
    boxes = [tuple(int(v) for v in s[:4]) for s in st[1:] if s[2] > 150 and s[3] > 250]
    return sorted(boxes, key=lambda b: (b[1] // 150, b[0]))


def cut(img: np.ndarray, box: tuple[int, int, int, int]) -> Image.Image:
    x, y, w, h = box
    crop = img[y : y + h, x : x + w]
    # silhouette: everything that is not the black background, with holes inside the card filled
    m = (crop.max(axis=2) > 45).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    pad = cv2.copyMakeBorder(m, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    flood = pad.copy()
    cv2.floodFill(flood, None, (0, 0), 255)
    inside = (pad | cv2.bitwise_not(flood))[1:-1, 1:-1]
    inside = cv2.erode(inside, np.ones((3, 3), np.uint8))  # drop the glow fringe
    alpha = cv2.GaussianBlur(inside, (3, 3), 0)
    rgba = np.dstack([crop, alpha])
    im = Image.fromarray(rgba, "RGBA").convert("RGBa")  # premultiplied, so edges don't pick up black when resized
    return im.resize((W, H), Image.LANCZOS).convert("RGBA")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    made: list[tuple[str, Image.Image]] = []
    for color in "yrgb":
        img = np.array(Image.open(src(f"sheet-{color}")).convert("RGB"))
        boxes = cards_in(img)
        assert len(boxes) == 13, f"sheet-{color}: found {len(boxes)} cards, expected 13"
        for slot, box in zip(SHEET_ORDER, boxes):
            made.append((color + slot, cut(img, box)))
    for one in ["wild", "wild4", "back", "deck"]:
        img = np.array(Image.open(src(one)).convert("RGB"))
        made.append((one, cut(img, max(cards_in(img), key=lambda b: b[2] * b[3]))))
    for name, im in made:
        im.save(OUT / f"{name}.webp", quality=80, method=6)
    print(len(made), "cards ->", OUT)

    if "--preview" in sys.argv:
        cols = 13
        rows = (len(made) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (W // 2 + 8), rows * (H // 2 + 8)), (18, 58, 92))
        for i, (_, im) in enumerate(made):
            t = im.resize((W // 2, H // 2), Image.LANCZOS)
            sheet.paste(t, ((i % cols) * (W // 2 + 8) + 4, (i // cols) * (H // 2 + 8) + 4), t)
        sheet.save(sys.argv[sys.argv.index("--preview") + 1], quality=88)


if __name__ == "__main__":
    main()
