# Regenera las fuentes web livianas (woff2 con subset). Correr cuando se use un icono Ionicons nuevo:
#   pip install fonttools brotli && python3 scripts/build/subset-fonts.py
# Ionicons: solo los glifos cuyo nombre aparece como literal en app/ components/ lib/ constants/ (380 KB -> ~11 KB).
# Nunito 400/700/900: latín + puntuación + monedas (₡) (129 KB c/u -> ~26 KB).
import glob, json, os, re
from fontTools import subset
VI = 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons'
gm = json.load(open(f'{VI}/glyphmaps/Ionicons.json'))
src = ''.join(open(f).read() for d in ('app', 'components', 'lib', 'constants') for f in glob.glob(f'{d}/**/*.ts*', recursive=True))
used = sorted(n for n in set(re.findall(r"""['"]([a-z0-9-]+)['"]""", src)) if n in gm)
json.dump(used, open('assets/fonts/ionicons-app.json', 'w'))
def run(src, out, uni):
    subset.main([src, f'--unicodes={uni}', '--flavor=woff2', f'--output-file={out}', '--layout-features=*', '--no-hinting', '--desubroutinize'])
    print(out, os.path.getsize(out) // 1024, 'KB')
run(f'{VI}/Fonts/Ionicons.ttf', 'assets/fonts/ionicons-app.woff2', ','.join('U+%04X' % gm[n] for n in used))
LATIN = 'U+0000-024F,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2212,U+2215,U+FEFF,U+FFFD'
for w, n in ((400, '400Regular'), (700, '700Bold'), (900, '900Black')):
    run(f'node_modules/@expo-google-fonts/nunito/{n}/Nunito_{n}.ttf', f'assets/fonts/nunito-{w}.woff2', LATIN)
