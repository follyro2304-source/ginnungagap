"""Bundle src/ and textures/ into a single self-contained index.html."""
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
S = ROOT / 'src'
css = (S/'style.css').read_text()
body = (S/'body.html').read_text()
js = '\n'.join((S/f).read_text() for f in ['physics.js','shaders.js','renderer.js','app1.js','space_data.js','space_sim.js','space_shaders.js','space_render.js','space_ui.js','app2.js','feedback.js'])
import base64
T = ROOT / 'textures'
def uri(name, mime):
    return f'data:{mime};base64,' + base64.b64encode((T/name).read_bytes()).decode()
for key, name in [('__TEX_EARTH__', 'earth.jpg'), ('__TEX_LIGHTS__', 'lights.jpg'), ('__TEX_MOONALB__', 'moon_albedo.jpg'), ('__TEX_MOONH__', 'moon_height.jpg')]:
    js = js.replace(key, uri(name, 'image/jpeg'))
html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Ginnungagap</title>
<meta name="description" content="Ginnungagap: a physically based laboratory for extreme astrophysics, from a ray-traced Schwarzschild black hole to the curved spacetime around Earth and the Moon.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..500&family=Schibsted+Grotesk:wght@400..700&display=swap" rel="stylesheet">
<style>
{css}
</style>
<script>
  window.va = window.va || function () {{ (window.vaq = window.vaq || []).push(arguments); }};
</script>
<script defer src="/_vercel/insights/script.js"></script>
</head>
<body>
{body}
<script>
'use strict';
{js}
</script>
</body>
</html>
'''
out = ROOT / 'index.html'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding='utf-8')
print(len(html), 'bytes')
