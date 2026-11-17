"""A shareable poster of every كورة البط duck, each in the blue and the red kit, grouped like the club roster.
usage: python -I tools/pixel/poster.py out.html   (then: node tools/pixel/shot.mjs out.html out.jpg)"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ART = os.path.join(ROOT, "public", "assets", "football").replace("\\", "/")
LOGO = os.path.join(ROOT, "tools", "src-art", "club", "team", "logo.png").replace("\\", "/")
FW, FH, NF, S = 64, 72, 6, 2.5

NAMES = {
    "camel": "الجمل", "abdullah": "عبدالله", "motivator": "المحفّز", "ahmad": "أحمد", "abdulrahman": "عبدالرحمن", "fayzah": "فايزة",
    "rawan": "روان", "shouq": "شوق", "loujain": "لجين", "bassam": "بسام", "ali": "علي", "ruaa": "رؤى", "hora": "حوراء",
    "zainab": "زينب", "amna": "آمنة", "tima": "تيما", "hajar": "هاجر", "jenan": "جنان", "maha": "مها", "samiyeh": "سامية",
    "ritaj": "رتاج", "sheikha": "شيخة", "aya": "آية", "maryam": "مريم", "haneen": "حنين", "abdullah2": "عبدالله أ",
}
GROUPS = [
    ("الإدارة", ["camel", "abdullah", "motivator", "ahmad", "abdulrahman", "fayzah"]),
    ("الفريق الإعلامي", ["bassam", "rawan", "shouq", "loujain", "ali", "ruaa", "hora", "zainab", "amna", "tima", "hajar"]),
    ("الفريق الثقافي", ["abdullah2", "jenan", "maha", "samiyeh", "ritaj", "sheikha", "aya", "maryam", "haneen"]),
]


def sprite(id, kit, scale=S, frame=0):
    w, h = FW * scale, FH * scale
    return (f'<i class="sp" style="width:{w}px;height:{h}px;background-image:url(\'file:///{ART}/{id}-{kit}.png\');'
            f'background-size:{w * NF}px {h}px;background-position:{-w * frame}px 0"></i>')


def card(id):
    return f'<div class="c"><div class="pair">{sprite(id, "blue")}{sprite(id, "red")}</div><b>{NAMES[id]}</b></div>'


sections = "".join(
    f'<section><h2>{t}</h2><div class="row">{"".join(card(i) for i in ids)}</div></section>' for t, ids in GROUPS
)
html = f"""<!doctype html><html dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@600;800&display=swap" rel="stylesheet">
<style>
* {{ box-sizing:border-box; margin:0; }}
body {{ width:1800px; font-family:"Baloo Bhaijaan 2"; color:#fff8e6; padding:40px 44px 34px;
  background: repeating-linear-gradient(90deg, #2f8a3c 0 150px, #287a33 150px 300px); }}
header {{ display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:28px; margin-bottom:6px; }}
.logo {{ width:150px; height:118px; background:#fff8e6 url('file:///{LOGO}') center/contain no-repeat; border-radius:18px; border:4px solid #14451b; }}
h1 {{ font-size:78px; line-height:1; text-shadow:0 6px 0 #14451b; }}
h1 small {{ display:block; font-size:26px; font-weight:600; opacity:.9; text-shadow:none; margin-top:12px; }}
.ref {{ display:flex; align-items:flex-end; gap:12px; background:#14451bdd; padding:12px 24px 12px 18px; border-radius:20px; border:4px solid #ffd23a; }}
.ref b {{ font-size:28px; display:block; }} .ref span {{ font-size:18px; opacity:.85; font-weight:600; }}
section {{ margin-top:22px; }}
h2 {{ font-size:32px; display:inline-block; background:#0e3a16; padding:2px 22px 6px; border-radius:14px; margin-bottom:6px; border:3px solid #ffd23a; }}
.row {{ display:flex; flex-wrap:wrap; gap:4px 6px; justify-content:center; }}
.c {{ width:208px; text-align:center; position:relative; }}
.pair {{ display:flex; justify-content:center; align-items:flex-end; height:{FH * S + 6}px; position:relative; }}
.pair::before {{ content:""; position:absolute; bottom:4px; left:50%; width:170px; height:24px; translate:-50% 0; border-radius:50%; background:#0f3d1880; }}
.sp {{ display:block; image-rendering:pixelated; position:relative; flex:none; }}
.pair .sp + .sp {{ margin-inline-start:-74px; }}
.c b {{ display:block; font-size:27px; margin-top:-8px; text-shadow:0 3px 0 #14451b; }}
footer {{ margin-top:22px; display:flex; justify-content:space-between; align-items:center; font-size:20px; font-weight:600; opacity:.9; }}
footer .k {{ display:inline-block; width:18px; height:18px; border-radius:5px; vertical-align:-2px; margin:0 6px; border:2px solid #fff8e6; }}
</style></head><body>
<header><div class="logo"></div><h1>تشكيلة كورة البط<small>كل أعضاء نادي العلوم البيولوجية بالبكسل، بالفانيلة الزرقا والحمرا</small></h1>
<div class="ref">{sprite("zahraa", "ref", 2.2)}<div><b>د. زهراء</b><span>حكم المباراة</span></div></div></header>
{sections}
<footer><span><i class="k" style="background:#2d5fd8"></i>الفريق الأزرق <i class="k" style="background:#d8323a"></i>الفريق الأحمر</span><span>حفلة البط · BSC</span></footer>
</body></html>"""
open(sys.argv[1], "w", encoding="utf8").write(html)
print("ok")
