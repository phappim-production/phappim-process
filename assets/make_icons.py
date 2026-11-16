"""สร้างไอคอนแอปจากโลโก้ (ส่วนกล่อง "142") · ใช้: python make_icons.py <logo.webp> <out_dir> <preview.png>"""
import sys
from PIL import Image, ImageDraw

src, out, preview = sys.argv[1], sys.argv[2], sys.argv[3]
GREEN = (15, 74, 66, 255)       # #0f4a42 สีแบรนด์
logo = Image.open(src).convert('RGBA')
# ส่วน "142" + วงกลมทอง (ไม่เอาเส้นกรอบเดิมของโลโก้)
GOLD = (221, 165, 92, 255)
SLASH = (12, 60, 60, 255)
# ตัวเลข "142" ตัดจากโลโก้ตรงๆ · วงกลมทอง + เส้นเฉียง วาดใหม่ตามพิกัดที่วัดจากโลโก้
# (โลโก้เดิมมีเส้นกรอบแนวตั้งผ่านวงกลม ซึ่งไม่ต้องการในไอคอน)
S = 8                                   # วาดใหญ่ 8 เท่าให้ขอบเนียน
X0, Y0, X1, Y1 = 290, 44, 480, 112      # กรอบพื้นที่ในพิกัดโลโก้
text = logo.crop((290, Y0, 418, Y1))
mark = Image.new('RGBA', ((X1 - X0) * S, (Y1 - Y0) * S), (0, 0, 0, 0))
mark.alpha_composite(text.resize((text.width * S, text.height * S), Image.LANCZOS), (0, 0))
dm = ImageDraw.Draw(mark)
cx, cy, rr = 451, 78, 22
dm.ellipse(((cx - rr - X0) * S, (cy - rr - Y0) * S, (cx + rr - X0) * S, (cy + rr - Y0) * S), fill=GOLD)
dm.line(((427 - X0) * S, (102 - Y0) * S, (476 - X0) * S, (54 - Y0) * S), fill=SLASH, width=4 * S)
mark = mark.resize((mark.width // S * 2, mark.height // S * 2), Image.LANCZOS)
mark = mark.crop(mark.getbbox())

# แบบเข้ม (ไอคอนเล็กบนแท็บ): เส้นเฉียงสีเขียวเปลี่ยนเป็นขาว ให้เห็นบนพื้นเขียว
mark_dark = mark.copy()
pd = mark_dark.load()
for x in range(mark_dark.width):
    for y in range(mark_dark.height):
        r, g, b, a = pd[x, y]
        if a and g > r and r < 60:
            pd[x, y] = (255, 255, 255, a)


def icon(size: int, pad: float, frame: bool, radius: float, dark: bool = False) -> Image.Image:
    """pad = สัดส่วนขอบว่างรอบโลโก้ · frame = กรอบเขียว · radius = มุมโค้ง · dark = พื้นเขียวตัวเลขทอง"""
    big = size * 4  # วาดใหญ่แล้วย่อ ให้ขอบเนียน
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = int(big * radius)
    if dark:
        d.rounded_rectangle((0, 0, big - 1, big - 1), r, fill=GREEN)
        inner = big * (1 - 2 * pad)
        s = min(inner / mark_dark.width, inner / mark_dark.height)
        m = mark_dark.resize((int(mark_dark.width * s), int(mark_dark.height * s)), Image.LANCZOS)
        im.alpha_composite(m, ((big - m.width) // 2, (big - m.height) // 2))
        return im.resize((size, size), Image.LANCZOS)
    if frame:
        d.rounded_rectangle((0, 0, big - 1, big - 1), r, fill=GREEN)
        b = int(big * 0.045)
        d.rounded_rectangle((b, b, big - 1 - b, big - 1 - b), max(r - b, 0), fill=(255, 255, 255, 255))
    else:
        d.rounded_rectangle((0, 0, big - 1, big - 1), r, fill=(255, 255, 255, 255))
    inner = big * (1 - 2 * pad)
    s = min(inner / mark.width, inner / mark.height)
    m = mark.resize((int(mark.width * s), int(mark.height * s)), Image.LANCZOS)
    im.alpha_composite(m, ((big - m.width) // 2, (big - m.height) // 2))
    return im.resize((size, size), Image.LANCZOS)


files = {
    'favicon-32.png': icon(32, 0.04, False, 0.2, dark=True),
    'favicon-48.png': icon(48, 0.05, False, 0.2, dark=True),
    'apple-touch-icon.png': icon(180, 0.14, False, 0.0).convert('RGB'),  # iOS ใส่มุมโค้งเอง ห้ามโปร่งใส
    'icon-192.png': icon(192, 0.13, True, 0.22),
    'icon-512.png': icon(512, 0.13, True, 0.22),
    'icon-maskable-512.png': icon(512, 0.22, False, 0.0).convert('RGB'),  # Android ตัดเป็นวงกลม/สี่เหลี่ยมมนเอง
}
for name, im in files.items():
    im.save(f'{out}/{name}', optimize=True)
files['favicon-32.png'].save(f'{out}/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])

# ภาพตัวอย่างไว้ดูผล
sheet = Image.new('RGBA', (900, 300), (230, 233, 231, 255))
x = 10
for name in ['favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-maskable-512.png']:
    im = files[name].convert('RGBA')
    if im.width > 200: im = im.resize((200, 200), Image.LANCZOS)
    sheet.alpha_composite(im, (x, 40))
    x += im.width + 30
tab = Image.new('RGBA', (16, 16)); tab = files['favicon-32.png'].resize((16, 16), Image.LANCZOS)
sheet.alpha_composite(tab.resize((64, 64), Image.NEAREST), (x, 40))  # ขนาดจริงบนแท็บ (16px) ขยายให้ดู
sheet.save(preview)
print({k: v.size for k, v in files.items()})
