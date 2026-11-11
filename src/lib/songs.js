// Songs: lyrics are plain text. A blank line starts a new slide; a line such as
// "Chorus", "[Verse 2]" or "Bridge:" names the slide that follows and is not shown on screen.
const LABEL = /^\s*\[?\s*((verse|v|chorus|c|refrain|pre-?chorus|bridge|b|tag|ending|intro|outro|interlude|stanza)\s*\d*)\s*\]?\s*:?\s*$/i;

export function songSlides(lyrics, maxLines = 0) {
  const slides = [];
  let label = '', lines = [], verseNo = 0;
  const flush = () => {
    if (!lines.length) return;
    let name = label;
    if (!name) name = `Verse ${++verseNo}`;
    else if (/^(verse|v)\s*\d+/i.test(name)) verseNo = parseInt(name.replace(/\D/g, ''), 10) || verseNo + 1;
    if (maxLines > 0 && lines.length > maxLines) {
      for (let i = 0, k = 1; i < lines.length; i += maxLines, k++) slides.push({ label: `${name} (${k})`, lines: lines.slice(i, i + maxLines) });
    } else slides.push({ label: name, lines });
    label = ''; lines = [];
  };
  String(lyrics || '').replace(/\r/g, '').split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    const m = line.match(LABEL);
    if (m && lines.length === 0) { label = tidyLabel(m[1]); return; }
    if (m) { flush(); label = tidyLabel(m[1]); return; }
    lines.push(line);
  });
  flush();
  return slides;
}

function tidyLabel(s) {
  const t = s.trim().replace(/\s+/g, ' ');
  const short = { v: 'Verse', c: 'Chorus', b: 'Bridge' }[t.replace(/\s*\d+$/, '').toLowerCase()];
  const word = short || t.replace(/\s*\d+$/, '').replace(/^\w/, (x) => x.toUpperCase());
  const num = t.match(/\d+$/);
  return num ? `${word} ${num[0]}` : word;
}

// A text file becomes a song: the first line is the title unless the file name says otherwise.
export function songFromText(text, fileName = '') {
  const body = String(text).replace(/\r/g, '').trim();
  const lines = body.split('\n');
  let title = fileName.replace(/\.[^.]+$/, '').trim();
  let lyrics = body;
  if (!title || /^(song|untitled|new)/i.test(title)) { title = lines[0].trim(); lyrics = lines.slice(1).join('\n').trim(); }
  // The file often repeats its own name as the first line.
  else if (lines[0].trim().toLowerCase() === title.toLowerCase()) lyrics = lines.slice(1).join('\n').trim();
  return { title: title || 'Untitled song', author: '', lyrics };
}

export const newSongId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Public-domain hymns so the library is not empty on first use.
export const STARTER_SONGS = [
  {
    id: 'pd-amazing-grace', title: 'Amazing Grace', author: 'John Newton (1779)',
    lyrics: `Verse 1
Amazing grace! How sweet the sound
That saved a wretch like me!
I once was lost, but now am found;
Was blind, but now I see.

Verse 2
'Twas grace that taught my heart to fear,
And grace my fears relieved;
How precious did that grace appear
The hour I first believed.

Verse 3
Through many dangers, toils and snares,
I have already come;
'Tis grace hath brought me safe thus far,
And grace will lead me home.

Verse 4
When we've been there ten thousand years,
Bright shining as the sun,
We've no less days to sing God's praise
Than when we'd first begun.`,
  },
  {
    id: 'pd-it-is-well', title: 'It Is Well with My Soul', author: 'Horatio G. Spafford (1873)',
    lyrics: `Verse 1
When peace, like a river, attendeth my way,
When sorrows like sea billows roll;
Whatever my lot, Thou hast taught me to say,
It is well, it is well with my soul.

Chorus
It is well with my soul,
It is well, it is well with my soul.

Verse 2
Though Satan should buffet, though trials should come,
Let this blest assurance control,
That Christ has regarded my helpless estate,
And hath shed His own blood for my soul.

Verse 3
My sin, oh, the bliss of this glorious thought!
My sin, not in part but the whole,
Is nailed to the cross, and I bear it no more,
Praise the Lord, praise the Lord, O my soul!

Verse 4
And Lord, haste the day when my faith shall be sight,
The clouds be rolled back as a scroll;
The trump shall resound, and the Lord shall descend,
Even so, it is well with my soul.`,
  },
  {
    id: 'pd-blessed-assurance', title: 'Blessed Assurance', author: 'Fanny J. Crosby (1873)',
    lyrics: `Verse 1
Blessed assurance, Jesus is mine!
Oh, what a foretaste of glory divine!
Heir of salvation, purchase of God,
Born of His Spirit, washed in His blood.

Chorus
This is my story, this is my song,
Praising my Savior all the day long;
This is my story, this is my song,
Praising my Savior all the day long.

Verse 2
Perfect submission, perfect delight,
Visions of rapture now burst on my sight;
Angels descending bring from above
Echoes of mercy, whispers of love.

Verse 3
Perfect submission, all is at rest;
I in my Savior am happy and blest,
Watching and waiting, looking above,
Filled with His goodness, lost in His love.`,
  },
  {
    id: 'pd-holy-holy-holy', title: 'Holy, Holy, Holy', author: 'Reginald Heber (1826)',
    lyrics: `Verse 1
Holy, holy, holy! Lord God Almighty!
Early in the morning our song shall rise to Thee;
Holy, holy, holy, merciful and mighty!
God in three Persons, blessed Trinity!

Verse 2
Holy, holy, holy! All the saints adore Thee,
Casting down their golden crowns around the glassy sea;
Cherubim and seraphim falling down before Thee,
Who wast, and art, and evermore shalt be.

Verse 3
Holy, holy, holy! Though the darkness hide Thee,
Though the eye of sinful man Thy glory may not see,
Only Thou art holy; there is none beside Thee,
Perfect in power, in love and purity.

Verse 4
Holy, holy, holy! Lord God Almighty!
All Thy works shall praise Thy name, in earth and sky and sea;
Holy, holy, holy, merciful and mighty!
God in three Persons, blessed Trinity!`,
  },
  {
    id: 'pd-what-a-friend', title: 'What a Friend We Have in Jesus', author: 'Joseph M. Scriven (1855)',
    lyrics: `Verse 1
What a friend we have in Jesus,
All our sins and griefs to bear!
What a privilege to carry
Everything to God in prayer!
O what peace we often forfeit,
O what needless pain we bear,
All because we do not carry
Everything to God in prayer!

Verse 2
Have we trials and temptations?
Is there trouble anywhere?
We should never be discouraged;
Take it to the Lord in prayer.
Can we find a friend so faithful
Who will all our sorrows share?
Jesus knows our every weakness;
Take it to the Lord in prayer.

Verse 3
Are we weak and heavy laden,
Cumbered with a load of care?
Precious Saviour, still our refuge;
Take it to the Lord in prayer.
Do thy friends despise, forsake thee?
Take it to the Lord in prayer!
In His arms He'll take and shield thee;
Thou wilt find a solace there.`,
  },
];
