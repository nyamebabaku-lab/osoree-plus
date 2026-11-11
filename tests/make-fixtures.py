"""Writes small test files: a 3-page PDF, a Zefania XML Bible with Twi-style book names, and a Twi song."""
import os
here = os.path.join(os.path.dirname(__file__), 'fixtures')
os.makedirs(here, exist_ok=True)

# --- a plain 3-page PDF (hand-written objects, valid xref) ---
pages = ['Welcome to Service', 'Sermon Point 1: Grace', 'Announcements']
objs = ['<< /Type /Catalog /Pages 2 0 R >>', None, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>']
kids = []
for i, text in enumerate(pages):
    content = f'BT /F1 48 Tf 72 300 Td ({text}) Tj ET'.encode()
    objs.append(f'<< /Length {len(content)} >>\nstream\n{content.decode()}\nendstream')
    content_no = len(objs)
    objs.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents {content_no} 0 R /Resources << /Font << /F1 3 0 R >> >> >>')
    kids.append(f'{len(objs)} 0 R')
objs[1] = f'<< /Type /Pages /Kids [{" ".join(kids)}] /Count {len(kids)} >>'
out = b'%PDF-1.4\n'
offsets = []
for n, o in enumerate(objs, 1):
    offsets.append(len(out))
    out += f'{n} 0 obj\n{o}\nendobj\n'.encode()
xref = len(out)
out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode()
out += ''.join(f'{o:010d} 00000 n \n' for o in offsets).encode()
out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
open(os.path.join(here, 'slides.pdf'), 'wb').write(out)

# --- a Zefania Bible with its own book names (sample text only, for testing) ---
names = {1: 'Genesis', 19: 'Nnwom', 43: 'Yohane', 45: 'Romafoɔ'}
xml = ['<?xml version="1.0" encoding="utf-8"?>', '<XMLBIBLE biblename="Test Twi Bible">']
for bn, name in names.items():
    xml.append(f'<BIBLEBOOK bnumber="{bn}" bname="{name}">')
    for c in range(1, 4 if bn != 19 else 24):
        xml.append(f'<CHAPTER cnumber="{c}">')
        for v in range(1, 40):
            xml.append(f'<VERS vnumber="{v}">Nsɛm {name} {c}:{v} — Ɔdɔ ɛwɔ hɔ.</VERS>')
        xml.append('</CHAPTER>')
    xml.append('</BIBLEBOOK>')
xml.append('</XMLBIBLE>')
open(os.path.join(here, 'TWI-TEST.xml'), 'w', encoding='utf-8').write('\n'.join(xml))

# an OpenSong-style file, to test choosing two files at once
os_xml = ['<?xml version="1.0" encoding="utf-8"?>', '<bible>']
nt = ['Mateo', 'Marko', 'Luka', 'Yohane'] + [f'Book {i}' for i in range(5, 28)]
for i, name in enumerate(nt):  # a New Testament only, like many Ghanaian-language Bibles
    chapters = ''.join(f'<c n="{c}">' + ''.join(f'<v n="{v}">Ga {name} {c}:{v}</v>' for v in range(1, 37)) + '</c>' for c in range(1, 4))
    os_xml.append(f'<b n="{name}">{chapters}</b>')
os_xml.append('</bible>')
open(os.path.join(here, 'GA-TEST.xml'), 'w', encoding='utf-8').write('\n'.join(os_xml))

open(os.path.join(here, 'Yesu Ne Me Hwɛfoɔ.txt'), 'w', encoding='utf-8').write('Yesu Ne Me Hwɛfoɔ\nVerse 1\nƆdɔ a ɛwɔ wo mu\nƐyɛ me de\n\nChorus\nMe dɔ wo Yesu\nMe dɔ wo\n')
# a book listed with chapters but no verses (as in one real Twi file's Daniel)
eb = ['<?xml version="1.0" encoding="utf-8"?>', '<bible translation="Empty Book Test Bible">']
for n in (26, 27, 28):
    eb.append(f'<book number="{n}">' + ''.join(f'<chapter number="{c}">' + ('' if n == 27 else ''.join(f'<verse number="{v}">Book {n} {c}:{v}</verse>' for v in range(1, 30))) + '</chapter>' for c in range(1, 13)) + '</book>')
eb.append('</bible>')
open(os.path.join(here, 'EMPTYBOOK-TEST.xml'), 'w', encoding='utf-8').write('\n'.join(eb))

# a Bible saved in an older encoding (ISO-8859-1), and one damaged by a block of empty bytes
lat = ['<?xml version="1.0" encoding="ISO-8859-1"?>', '<XMLBIBLE biblename="Latin One Test Bible">', '<BIBLEBOOK bnumber="43" bname="John">']
for c in range(1, 4):
    lat.append(f'<CHAPTER cnumber="{c}">' + ''.join(f'<VERS vnumber="{v}">Café fiancé {c}:{v}</VERS>' for v in range(1, 40)) + '</CHAPTER>')
lat += ['</BIBLEBOOK>', '</XMLBIBLE>']
open(os.path.join(here, 'LATIN1-TEST.xml'), 'wb').write('\n'.join(lat).encode('latin-1'))
dmg = ['<?xml version="1.0" encoding="utf-8"?>', '<XMLBIBLE biblename="Damaged Test Bible">', '<BIBLEBOOK bnumber="26" bname="Ezekiel">']
for c in range(1, 31):
    dmg.append(f'<CHAPTER cnumber="{c}">' + ''.join(f'<VERS vnumber="{v}">Ezekiel {c}:{v} text</VERS>' for v in range(1, 40)) + '</CHAPTER>')
dmg += ['</BIBLEBOOK>', '</XMLBIBLE>']
raw = '\n'.join(dmg).encode('utf-8')
cut = raw.index(b'Ezekiel 4:20'), raw.index(b'Ezekiel 22:3')  # chapters 5–21 lost, 4 and 22 partly
open(os.path.join(here, 'DAMAGED-TEST.xml'), 'wb').write(raw[:cut[0] + 5] + b'\x00' * 4096 + raw[cut[1] + 3:])

import zipfile
with zipfile.ZipFile(os.path.join(here, 'bibles.zip'), 'w', zipfile.ZIP_DEFLATED) as z:  # both Bibles in sub-folders, plus files to skip
    z.write(os.path.join(here, 'TWI-TEST.xml'), 'Bibles/TWI-TEST.xml')
    z.write(os.path.join(here, 'GA-TEST.xml'), 'Bibles/Ga/GA-TEST.xml')
    z.writestr('__MACOSX/Bibles/._TWI-TEST.xml', 'junk')
    z.writestr('readme.txt', 'hello')
print('fixtures written:', sorted(os.listdir(here)))
