import json, re, sys, os
raw, out = sys.argv[1], sys.argv[2]
META = [("kjv","KJV","King James Version","KJV.json"),("asv","ASV","American Standard Version","ASV.json"),
        ("bsb","BSB","Berean Standard Bible","BSB.json"),("web","WEB","World English Bible","WEB-getbible.json"),
        ("bbe","BBE","Bible in Basic English","BBE.json"),("ylt","YLT","Young's Literal Translation","YLT.json")]
heb = re.compile(r'[֐-׿]+')
def clean(t):
    t = heb.sub('', t)
    t = re.sub(r'[\[\]{}<>*+]', '', t)
    t = t.replace('¶','')
    return re.sub(r'\s+', ' ', t).strip()
ref = None
for vid, ab, name, f in META:
    d = json.load(open(os.path.join(raw, f), encoding='utf-8-sig'))
    books = d['books'][:66] if len(d['books'])>=66 else d['books']
    shape = [[len(c['verses']) for c in b['chapters']] for b in books]
    def place(c):
        n = max(v['verse'] for v in c['verses']); a = ['']*n
        for v in c['verses']: a[v['verse']-1] = clean(v['text'])
        return a
    data = [[place(c) for c in b['chapters']] for b in books]
    shape = [[len(c) for c in b] for b in data]
    # verify verse numbering is contiguous
    gaps = sum(1 for b in books for c in b['chapters'] for i,v in enumerate(c['verses']) if v['verse']!=i+1)
    empty = sum(1 for b in data for c in b for v in c if not v)
    if ref is None: ref = shape
    diff = sum(1 for i in range(min(len(shape),66)) if shape[i]!=ref[i])
    json.dump({"id":vid,"abbr":ab,"name":name,"books":data}, open(os.path.join(out, vid+'.json'),'w',encoding='utf-8'), ensure_ascii=False, separators=(',',':'))
    print(vid, len(d['books']), 'books', sum(map(sum,shape)), 'verses; gaps', gaps, 'empty', empty, 'books differing from KJV shape', diff, '|', data[42][2][15][:60], '|', data[18][118][0][:50])
