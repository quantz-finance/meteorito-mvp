# Genera constants/splashImages.ts: la mascota y sus 3 llamas en WebP chico (2x de 140 px) como data URI,
# para que el splash del HTML pinte en el primer frame sin esperar ninguna descarga.
#   python3 scripts/build/splash-images.py
import base64, io
from PIL import Image
D = 'assets/images/space/'
SPEC = {'mascot': ('mascot.webp', (280, 264), 76), 'f1': ('trail-f1.webp', (238, 112), 70), 'f2': ('trail-f2.webp', (190, 73), 70), 'f3': ('trail-f3.webp', (202, 67), 70)}
out = ['// Generado por scripts/build/splash-images.py (no editar a mano).', 'export const SPLASH_IMG = {']
total = 0
for k, (f, size, q) in SPEC.items():
    b = io.BytesIO(); Image.open(D + f).convert('RGBA').resize(size, Image.LANCZOS).save(b, 'WEBP', quality=q, method=6, alpha_quality=80)
    s = base64.b64encode(b.getvalue()).decode(); total += len(s)
    out.append(f"  {k}: 'data:image/webp;base64,{s}',")
out.append('};')
open('constants/splashImages.ts', 'w').write('\n'.join(out) + '\n')
print('splash inline:', total // 1024, 'KB base64')
