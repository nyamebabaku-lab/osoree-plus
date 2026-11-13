# Ɔsɔreɛ Plus for Windows

The phone/web app (`npm run build:app` output) inside Electron, plus a projector window that fills the second screen.
Built on GitHub (`.github/workflows/windows.yml`, Windows runner): `OsoreePlus-Setup-<version>.exe` is attached to the release.

Local build on Windows: `VITE_TARGET=app npx vite build` in the project, copy `dist-app` to `desktop/app`, then `cd desktop && npm install && npm run dist`.
