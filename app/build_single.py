from pathlib import Path
import json, re

root = Path(__file__).resolve().parent
html = (root / 'index.html').read_text()
css = (root / 'styles.css').read_text()
order = ['complex', 'geometry', 'models', 'physics', 'bridge', 'analysis', 'plot', 'export', 'circuit', 'coupler-view', 'app']
mods = {name: (root / 'src' / f'{name}.js').read_text() for name in order}

html = re.sub(r'\s*<link rel="manifest"[^>]*>', '', html)
html = re.sub(r'\s*<link rel="icon"[^>]*>', '', html)
html = html.replace('  <link rel="stylesheet" href="styles.css" />', f'  <style>\n{css}\n  </style>')
html = html.replace('  <script type="module" src="src/app.js"></script>', '')
source_json = json.dumps(mods, ensure_ascii=False).replace('</script>', '<\\/script>')

# Create module Blob URLs in dependency order and replace each static relative import
# with the generated URL before the dependent Blob is created.
bootstrap = f'''  <script type="module">
    const source = {source_json};
    const url = {{}};
    const dependencies = {{
      geometry: {{}},
      models: {{ './complex.js': 'complex' }},
      physics: {{ './complex.js': 'complex', './geometry.js': 'geometry', './models.js': 'models' }},
      bridge: {{}},
      analysis: {{ './complex.js': 'complex', './models.js': 'models', './physics.js': 'physics' }},
      plot: {{}},
      export: {{ './models.js': 'models', './physics.js': 'physics', './bridge.js': 'bridge' }},
      circuit: {{ './physics.js': 'physics', './models.js': 'models', './geometry.js': 'geometry' }},
      'coupler-view': {{ './physics.js': 'physics', './complex.js': 'complex' }},
      app: {{
        './circuit.js': 'circuit', './physics.js': 'physics', './models.js': 'models',
        './complex.js': 'complex', './coupler-view.js': 'coupler-view', './analysis.js': 'analysis',
        './plot.js': 'plot', './export.js': 'export', './bridge.js': 'bridge'
      }}
    }};
    const order = {json.dumps(order)};
    for (const name of order) {{
      let code = source[name];
      for (const [specifier, dependency] of Object.entries(dependencies[name] || {{}})) code = code.split(specifier).join(url[dependency]);
      url[name] = URL.createObjectURL(new Blob([code], {{ type: 'text/javascript' }}));
    }}
    await import(url.app);
  </script>'''
html = html.replace('</body>', bootstrap + '\n</body>')
dist = root / 'dist'
dist.mkdir(exist_ok=True)
out = dist / 'PicSetup-Lab-10x-preview.html'
out.write_text(html)

print(out, out.stat().st_size)
