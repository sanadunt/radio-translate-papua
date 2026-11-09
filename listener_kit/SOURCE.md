# HackRF Listener Kit (build)

Folder ini berisi hasil build (`dist/`) HackRF Listener Kit, disajikan oleh Flask di `/listener/`.

- Source: https://github.com/sanadunt/hackrf-listener-kit (commit `3978646`, branch `main`), tanpa perubahan.
- Lisensi: AGPL-3.0-only (lihat `LICENSE` dan `NOTICE.md`), turunan BrowSDR (https://github.com/jLynx/BrowSDR).
- `static/hackrf-listener-client.js` dan `.d.ts` disalin tanpa perubahan dari `client/` di repo yang sama.

Build ulang: di repo kit jalankan `npm ci && npm run build`, lalu salin isi `dist/` ke folder ini
(beserta `LICENSE` dan `NOTICE.md`) dan perbarui commit di atas. Hapus `hackrf-web/pkg/.gitignore`
bawaan wasm-pack (isinya `*`), kalau tidak file `.wasm` tidak ikut masuk git.
