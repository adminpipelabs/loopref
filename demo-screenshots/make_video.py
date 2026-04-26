"""
Creates a Pinterest Standard access demo video for LoopRef.
Assembles screenshots + title cards into an MP4.
"""
import os, subprocess, shutil
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
FRAMES_DIR = os.path.join(OUT, 'frames')
os.makedirs(FRAMES_DIR, exist_ok=True)

W, H = 1280, 720
BG_CREAM = (255, 253, 249)
ORANGE = (255, 107, 53)
DARK = (26, 18, 8)
GREY = (90, 79, 64)

def get_font(size, bold=False):
    """Try to load a system font, fall back to default."""
    font_paths = [
        '/System/Library/Fonts/Helvetica.ttc',
        '/System/Library/Fonts/Arial.ttf',
        '/System/Library/Fonts/SFNSDisplay.ttf',
        '/Library/Fonts/Arial.ttf',
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except:
                continue
    return ImageFont.load_default()

def title_card(label, title, subtitle='', bg=BG_CREAM, accent=ORANGE):
    """Create a title slide."""
    img = Image.new('RGB', (W, H), bg)
    draw = ImageDraw.Draw(img)

    # Orange accent bar top-left
    draw.rectangle([80, 0, 80+4, H], fill=accent)

    # Label
    if label:
        font_label = get_font(14)
        draw.text((120, 200), label.upper(), fill=accent, font=font_label)

    # Title
    font_title = get_font(52, bold=True)
    draw.text((120, 230), title, fill=DARK, font=font_title)

    # Subtitle
    if subtitle:
        font_sub = get_font(22)
        draw.text((120, 330), subtitle, fill=GREY, font=font_sub)

    # LoopRef wordmark bottom
    font_logo = get_font(20)
    draw.text((120, H-60), 'loopref', fill=DARK, font=font_logo)
    # Orange 'ref' part approximation
    bbox = draw.textbbox((120, H-60), 'loop', font=font_logo)
    draw.text((bbox[2], H-60), 'ref', fill=accent, font=font_logo)

    return img

def pad_screenshot(path, target_w=W, target_h=H):
    """Resize and pad screenshot to target dimensions, keeping aspect ratio."""
    img = Image.open(path).convert('RGB')
    iw, ih = img.size

    # Scale to fit within target (with some padding)
    pad = 40
    avail_w = target_w - pad * 2
    avail_h = target_h - pad * 2
    scale = min(avail_w / iw, avail_h / ih)
    nw, nh = int(iw * scale), int(ih * scale)
    img_resized = img.resize((nw, nh), Image.LANCZOS)

    # Place on cream background
    canvas = Image.new('RGB', (target_w, target_h), BG_CREAM)
    x = (target_w - nw) // 2
    y = (target_h - nh) // 2
    canvas.paste(img_resized, (x, y))
    return canvas

def save_frame(img, name, count):
    path = os.path.join(FRAMES_DIR, f'{count:03d}_{name}.png')
    img.save(path)
    return path

# ── Build frame sequence ─────────────────────────────────────────────────────

frame = 0

# 1. Title card - intro
img = title_card(
    'Pinterest Standard Access Demo',
    'LoopRef',
    'Venue referral & rewards platform — powered by Pinterest'
)
save_frame(img, 'title', frame); frame += 1

# 2. Home page
img = pad_screenshot(os.path.join(OUT, '01-home.png'))
save_frame(img, 'home', frame); frame += 1

# Caption card
img = title_card('', 'How it works', 'Customers visit venues, share with friends, earn discounts')
save_frame(img, 'howitworks', frame); frame += 1

# 3. Venue directory (mobile)
img = pad_screenshot(os.path.join(OUT, '02-app-discover.png'))
save_frame(img, 'discover', frame); frame += 1

# 4. Venue detail + share flow
img = pad_screenshot(os.path.join(OUT, '03-venue-detail.png'))
save_frame(img, 'venue', frame); frame += 1

# 5. Places desktop directory
img = pad_screenshot(os.path.join(OUT, '07-places.png'))
save_frame(img, 'places', frame); frame += 1

# 6. Admin panel title
img = title_card('Venue Management', 'Admin Panel', '69 venues listed across the US — all active')
save_frame(img, 'admin_title', frame); frame += 1

# 7. Admin panel logged in
img = pad_screenshot(os.path.join(OUT, '05-admin-loggedin.png'))
save_frame(img, 'admin', frame); frame += 1

# 8. Admin scrolled
img = pad_screenshot(os.path.join(OUT, '05b-admin-venues.png'))
save_frame(img, 'admin_venues', frame); frame += 1

# 9. Pinterest integration title
img = title_card(
    'Pinterest Integration',
    'Pinterest API',
    'LoopRef posts venue pins to our board using OAuth + Pins API'
)
save_frame(img, 'pinterest_title', frame); frame += 1

# 10. Pinterest connect page (the redirect to Pinterest OAuth)
img = title_card(
    'Step 1',
    'OAuth Connect',
    'Admin initiates Pinterest OAuth at /auth/loopref-pinterest\nUser is redirected to Pinterest authorization'
)
save_frame(img, 'oauth_step1', frame); frame += 1

# 11. After OAuth - pin creation
img = title_card(
    'Step 2',
    'Pin Creation',
    'After OAuth approval, venue pins are created via POST /v5/pins\nEach pin links back to the venue page on LoopRef'
)
save_frame(img, 'pin_creation', frame); frame += 1

# 12. Outro
img = title_card(
    '',
    'Thank you',
    'loopref.com — find venues, share with friends, earn discounts'
)
save_frame(img, 'outro', frame); frame += 1

print(f'Created {frame} frames in {FRAMES_DIR}')

# ── Assemble with ffmpeg ──────────────────────────────────────────────────────

output_mp4 = os.path.join(OUT, 'loopref-pinterest-demo.mp4')

cmd = [
    'ffmpeg', '-y',
    '-framerate', '1/4',          # 4 seconds per frame
    '-pattern_type', 'glob',
    '-i', os.path.join(FRAMES_DIR, '*.png'),
    '-vf', f'scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=fffdf9,format=yuv420p',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '20',
    '-movflags', '+faststart',
    output_mp4
]

print('Building MP4...')
result = subprocess.run(cmd, capture_output=True, text=True)
if result.returncode == 0:
    size_mb = os.path.getsize(output_mp4) / 1024 / 1024
    print(f'✅ Video saved: {output_mp4} ({size_mb:.1f} MB)')
else:
    print('ffmpeg error:', result.stderr[-500:])
