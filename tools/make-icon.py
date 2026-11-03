"""Génère build/icon.png (512×512) : tuile verte « A/27 » sur bleu nuit. Aucun logo ni marque tierce."""
from PIL import Image, ImageDraw, ImageFont
S = 512
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((16, 16, S - 16, S - 16), radius=110, fill=(11, 27, 46, 255))
d.rounded_rectangle((56, 56, S - 56, S - 56), radius=84, fill=(31, 169, 113, 255))
def font(size):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'):
        try: return ImageFont.truetype(p, size)
        except OSError: pass
    return ImageFont.load_default()
d.text((S // 2, S // 2 - 30), 'A', font=font(260), fill=(4, 40, 27, 255), anchor='mm')
d.text((S // 2, S - 130), '/27', font=font(80), fill=(4, 40, 27, 255), anchor='mm')
img.save('build/icon.png')
