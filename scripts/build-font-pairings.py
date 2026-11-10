#!/usr/bin/env python3
"""
Builds FOLD Motion's font pairings from the Google Fonts repository: twelve
families, all under the SIL Open Font License (free for commercial use).

Variable fonts are cut into static instances at the weights each pairing uses
(the renderer selects fonts by family and weight), named consistently, subset to
Latin characters to keep them small, then measured with public/font-metrics.mjs
into assets/fonts/pairings/metrics.json. Each family's OFL.txt is copied beside
its fonts.

Reproducible: `python3 scripts/build-font-pairings.py` rebuilds
assets/fonts/pairings. Needs network access, fontTools and Node.
"""
import json
import os
import subprocess
import urllib.request
from io import BytesIO

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'assets', 'fonts', 'pairings')
SOURCE = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'

# id: (folder, file, axis values or None for a static font, family, weight, italic)
FONTS = {
    'playfair-bold': ('playfairdisplay', 'PlayfairDisplay[wght].ttf', {'wght': 700}, 'Playfair Display', 700, False),
    'playfair-italic': ('playfairdisplay', 'PlayfairDisplay-Italic[wght].ttf', {'wght': 600}, 'Playfair Display', 600, True),
    'spacegrotesk-bold': ('spacegrotesk', 'SpaceGrotesk[wght].ttf', {'wght': 700}, 'Space Grotesk', 700, False),
    'inter-medium': ('inter', 'Inter[opsz,wght].ttf', {'opsz': 14, 'wght': 500}, 'Inter', 500, False),
    'inter-semibold': ('inter', 'Inter[opsz,wght].ttf', {'opsz': 14, 'wght': 600}, 'Inter', 600, False),
    'inter-bold': ('inter', 'Inter[opsz,wght].ttf', {'opsz': 14, 'wght': 700}, 'Inter', 700, False),
    'spacemono-bold': ('spacemono', 'SpaceMono-Bold.ttf', None, 'Space Mono', 700, False),
    'fredoka-semibold': ('fredoka', 'Fredoka[wdth,wght].ttf', {'wdth': 100, 'wght': 600}, 'Fredoka', 600, False),
    'nunito-medium': ('nunito', 'Nunito[wght].ttf', {'wght': 500}, 'Nunito', 500, False),
    'nunito-semibold': ('nunito', 'Nunito[wght].ttf', {'wght': 600}, 'Nunito', 600, False),
    'nunito-bold': ('nunito', 'Nunito[wght].ttf', {'wght': 800}, 'Nunito', 800, False),
    'caveat-bold': ('caveat', 'Caveat[wght].ttf', {'wght': 700}, 'Caveat', 700, False),
    'bebas': ('bebasneue', 'BebasNeue-Regular.ttf', None, 'Bebas Neue', 400, False),
    'archivo-medium': ('archivo', 'Archivo[wdth,wght].ttf', {'wdth': 100, 'wght': 500}, 'Archivo', 500, False),
    'archivo-semibold': ('archivo', 'Archivo[wdth,wght].ttf', {'wdth': 100, 'wght': 600}, 'Archivo', 600, False),
    'archivo-bold': ('archivo', 'Archivo[wdth,wght].ttf', {'wdth': 100, 'wght': 700}, 'Archivo', 700, False),
    'archivoblack': ('archivoblack', 'ArchivoBlack-Regular.ttf', None, 'Archivo Black', 400, False),
    'fraunces-semibold': ('fraunces', 'Fraunces[SOFT,WONK,opsz,wght].ttf', {'SOFT': 0, 'WONK': 0, 'opsz': 72, 'wght': 600}, 'Fraunces', 600, False),
    'fraunces-italic': ('fraunces', 'Fraunces-Italic[SOFT,WONK,opsz,wght].ttf', {'SOFT': 50, 'WONK': 1, 'opsz': 72, 'wght': 500}, 'Fraunces', 500, True),
    'dmsans-medium': ('dmsans', 'DMSans[opsz,wght].ttf', {'opsz': 14, 'wght': 500}, 'DM Sans', 500, False),
    'dmsans-semibold': ('dmsans', 'DMSans[opsz,wght].ttf', {'opsz': 14, 'wght': 600}, 'DM Sans', 600, False),
    'dmsans-bold': ('dmsans', 'DMSans[opsz,wght].ttf', {'opsz': 14, 'wght': 700}, 'DM Sans', 700, False),
}

# Latin, Latin-1, typographic punctuation, currency and a few symbols.
UNICODES = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + list(range(0x2010, 0x2028)) + list(range(0x2030, 0x203B)) + [0x20AC, 0x2122, 0x2190, 0x2192, 0x2022]


def fetch(folder, name, cache={}):
    key = f'{folder}/{name}'
    if key not in cache:
        url = SOURCE + folder + '/' + urllib.parse.quote(name)
        with urllib.request.urlopen(url) as response:
            cache[key] = response.read()
    return cache[key]


def name_font(font, family, weight, italic, font_id):
    style = 'Italic' if italic else 'Regular'
    names = font['name']
    # Clear typographic family names that would group instances differently.
    for name_id in (16, 17, 21, 22, 25):
        names.removeNames(nameID=name_id)
    full = f'{family} {weight}{" Italic" if italic else ""}'
    for name_id, value in ((1, family), (2, style), (4, full), (6, f'FoldMotion-{font_id}')):
        names.setName(value, name_id, 3, 1, 0x409)
        names.setName(value, name_id, 1, 0, 0)
    font['OS/2'].usWeightClass = weight
    selection = font['OS/2'].fsSelection & ~0b1100001  # clear italic, bold, regular
    font['OS/2'].fsSelection = selection | (0b1 if italic else 0b1000000)
    font['head'].macStyle = 0b10 if italic else 0


def main():
    os.makedirs(OUT, exist_ok=True)
    licences = set()
    for font_id, (folder, name, axes, family, weight, italic) in FONTS.items():
        font = TTFont(BytesIO(fetch(folder, name)))
        if axes:
            font = instancer.instantiateVariableFont(font, axes)
        name_font(font, family, weight, italic, font_id)
        options = subset.Options()
        options.layout_features = ['kern', 'liga', 'calt']
        options.name_IDs = ['*']
        options.notdef_outline = True
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=UNICODES)
        subsetter.subset(font)
        font.save(os.path.join(OUT, f'{font_id}.ttf'))
        if folder not in licences:
            with open(os.path.join(OUT, f'OFL-{folder}.txt'), 'wb') as handle:
                handle.write(fetch(folder, 'OFL.txt'))
            licences.add(folder)
        print(f'{font_id}: {os.path.getsize(os.path.join(OUT, font_id + ".ttf")) // 1024} KB')
    # Measure every font with the same reader the studio uses for brand fonts.
    script = """
import { readFileSync, writeFileSync } from 'node:fs';
import { readFontMetrics } from '%s';
const fonts = JSON.parse(process.argv[1]);
const out = { _note: 'Font pairings: SIL Open Font License fonts from Google Fonts, built by scripts/build-font-pairings.py.' };
for (const [id, italic] of Object.entries(fonts)) {
  const metrics = readFontMetrics(readFileSync('%s/' + id + '.ttf'));
  out[id] = { file: 'pairings/' + id + '.ttf', ...metrics, ...(italic ? { style: 'italic' } : {}) };
}
writeFileSync('%s/metrics.json', JSON.stringify(out, null, 1) + '\\n');
""" % (os.path.join(ROOT, 'public', 'font-metrics.mjs'), OUT, OUT)
    subprocess.run(['node', '--input-type=module', '-e', script, json.dumps({k: v[5] for k, v in FONTS.items()})], check=True)
    print('metrics.json written')


if __name__ == '__main__':
    import urllib.parse  # noqa: F401  (used by fetch)
    main()
