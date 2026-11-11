"""KJV with Strong's numbers (eBible.org eng-kjv2006 USFM, public domain) and Strong's dictionaries
(OpenScriptures, CC-BY-SA) → public/bibles/kjvs.json and public/strongs/{hebrew,greek}.json.

Tagged words are written as [word|H7225]; the app strips the tags for display and search.
Usage: python3 scripts/convert-strongs.py <usfm-folder> <hebrew-dictionary.js> <greek-dictionary.js>
"""
import json, os, re, sys

usfm_dir, heb_js, grk_js = sys.argv[1:4]
out_bible, out_dict = 'public/bibles/kjvs.json', 'public/strongs'

def norm(num):  # H0430 → H430
    return num[0] + str(int(num[1:]))

def inline(t):
    t = re.sub(r'\\f .*?\\f\*', '', t)  # footnotes
    t = re.sub(r'\\x .*?\\x\*', '', t)  # cross references
    def word(m):
        nums = [norm(n) for n in re.findall(r'[HG]\d+', m.group(2))]
        return '[%s|%s]' % (m.group(1).strip(), ','.join(nums)) if nums else m.group(1)
    t = re.sub(r'\\\+?w ([^|\\]*)\|strong="([^"]*)"\\\+?w\*', word, t)
    t = re.sub(r'\\\+?(?:add|nd|wj|qs|sc|it|bd|em)\*?', '', t)  # keep the words, drop the markers
    t = re.sub(r'\\[a-z]+\d*\*?\s?', '', t)  # any other marker
    t = t.replace('\u00b6', '')  # paragraph marks
    return re.sub(r'\s+', ' ', t).strip()

files = sorted(f for f in os.listdir(usfm_dir) if re.match(r'\d\d-[A-Z0-9]{3}', f) and f.endswith('.usfm'))
books = []
for f in files:
    chapters, ch, vn, heading = [], None, None, ''
    for line in open(os.path.join(usfm_dir, f), encoding='utf-8-sig'):
        line = line.rstrip('\n')
        m = re.match(r'\\c (\d+)', line)
        if m:
            ch = []; chapters.append(ch); vn = None; continue
        if ch is None: continue
        m = re.match(r'\\d (.*)', line)
        if m:
            heading = inline(m.group(1)); continue  # psalm titles go in front of verse 1, as in the other KJV
        for part in re.split(r'(?=\\v \d+ )', line):
            m = re.match(r'\\v (\d+) (.*)', part)
            if m:
                vn = int(m.group(1))
                while len(ch) < vn: ch.append('')
                ch[vn - 1] = ((heading + ' ') if heading and vn == 1 else '') + inline(m.group(2))
                heading = ''
            elif vn and part.strip() and not re.match(r'\\(p|q\d?|b|m|nb|pi\d?|li\d?)\s*$', part.strip()):
                ch[vn - 1] = (ch[vn - 1] + ' ' + inline(part)).strip()
    books.append(chapters)

plain = lambda s: re.sub(r'\[([^|\]]*)\|[^\]]*\]', r'\1', s)
assert len(books) == 66, len(books)
total = sum(len(c) for b in books for c in b)
ref = json.load(open('public/bibles/kjv.json'))['books']
shape_diff = sum(1 for i in range(66) if [len(c) for c in books[i]] != [len(c) for c in ref[i]])
empty = sum(1 for b in books for c in b for v in c if not v)
tagged = sum(len(re.findall(r'\[[^|\]]*\|', v)) for b in books for c in b for v in c)
json.dump({'id': 'kjvs', 'abbr': 'KJV+', 'name': "King James Version with Strong's numbers", 'strongs': True, 'books': books},
          open(out_bible, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('verses', total, '| books differing in shape from kjv.json', shape_diff, '| empty', empty, '| tagged words', tagged)
print(plain(books[42][2][15]))
print(books[42][2][15][:160])
print(plain(books[18][22][0]))

def load_js(path, var):
    s = open(path, encoding='utf-8').read()
    return json.loads(s[s.index('{', s.index(var)):s.rindex('}') + 1])

os.makedirs(out_dict, exist_ok=True)
for path, var, name in [(heb_js, 'strongsHebrewDictionary', 'hebrew'), (grk_js, 'strongsGreekDictionary', 'greek')]:
    d = load_js(path, var)
    slim = {}
    for k, e in d.items():
        slim[k] = {
            'l': e.get('lemma', ''), 'x': e.get('xlit') or e.get('translit', ''), 'p': e.get('pron', ''),
            'd': (e.get('strongs_def') or '').strip(), 'k': (e.get('kjv_def') or '').strip(), 'o': (e.get('derivation') or '').strip(),
        }
    json.dump(slim, open(os.path.join(out_dict, name + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(name, len(slim), 'entries', os.path.getsize(os.path.join(out_dict, name + '.json')) // 1000, 'KB')
