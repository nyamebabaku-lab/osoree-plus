# Ɔsɔreɛ Plus

Project Bible verses, songs, pictures, videos and PDFs from a phone to a projector or TV — with or without internet.

**Download for Android:** https://github.com/nyamebabaku-lab/osoree-plus/releases/latest/download/OsoreePlus.apk
(allow "Install unknown apps" when asked).

**Web version (laptops):** https://nyamebabaku-lab.github.io/osoree-plus/

## What it does
- Bible: KJV, KJV with Strong's (Hebrew/Greek word study), BSB, WEB, ASV, BBE, YLT built in; add other Bibles you have the right to use from XML files or a zip (Zefania, OpenSong, bible.com exports).
- Find verses by typing (`jn 3 16`, `rom 5 8; 6 23`), by words, or by voice; show several verses together, combine passages, compare two versions.
- Songs with lyrics slides; pictures, MP4 videos and PDFs; idle screen and backgrounds; 14 fonts.
- Screens: HDMI cable or wireless display from the phone, laptops/TVs over Wi-Fi or hotspot, OBS/vMix overlay.
- Live video: phone camera, a second phone as a Wi-Fi camera, or a laptop webcam/capture card, with verses, songs and names as a lower third and a scrolling ticker.

## Development
```
npm install
npm run dev          # operator app in the browser
npm run build:app    # web files for the Android app, then Capacitor sync
tests/run-e2e.sh     # browser tests
tests/run-server.sh  # tests for the phone's screen server
```
Release builds are signed in GitHub Actions with the key from repository secrets. The key itself is kept outside this repository.

## Credits
Public-domain texts: KJV, ASV, BBE, YLT, WEB, BSB; KJV with Strong's numbers from eBible.org. Strong's Hebrew and Greek dictionaries: digital text © Open Scriptures, CC BY-SA. Fonts under the SIL Open Font License.
