import os
from PIL import Image, ImageDraw, ImageFont

res_dir = r"C:\Gemini\HouseOps\android\res\drawable"
os.makedirs(res_dir, exist_ok=True)

# Generate 192x192 App Icon
icon = Image.new("RGBA", (192, 192), (0, 0, 0, 255))
draw = ImageDraw.Draw(icon)

# Subtle rounded border
draw.rounded_rectangle([(10, 10), (181, 181)], radius=38, fill=(10, 14, 23, 255), outline=(56, 189, 248, 255), width=4)

# House Roof
draw.polygon([(96, 38), (38, 86), (154, 86)], fill=(56, 189, 248, 255))

# House Body
draw.rectangle([(54, 86), (138, 150)], fill=(15, 23, 42, 255), outline=(56, 189, 248, 255), width=3)

# Lightning Bolt in Center (HouseOps logo)
bolt_pts = [
    (100, 92),
    (80, 118),
    (96, 118),
    (92, 144),
    (114, 114),
    (98, 114)
]
draw.polygon(bolt_pts, fill=(245, 158, 11, 255))

icon.save(os.path.join(res_dir, "icon.png"), "PNG")
print("App icon generated successfully at", os.path.join(res_dir, "icon.png"))
