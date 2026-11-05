# NOTICE

HackRF Listener Kit is a modified version of **BrowSDR** by jLynx
(<https://github.com/jLynx/BrowSDR>), licensed under the GNU Affero General
Public License version 3 (see `LICENSE`). The kit is distributed under the same
license, AGPL-3.0-only.

Provenance, in this repository's history:

1. BrowSDR history up to commit `54f6cb7` ("Implement advanced wide-spectrum
   sweep"), from the fork `sanadunt/BrowSDR`. Original copyright notices in the
   source files are kept.
2. "Apply the SDR-DoA Ground Console Receiver overlay": the Receiver changes of
   `sanadunt/sdr-doa-ground-control` (commit `a5bcee2`,
   `tools/browsdr_receiver_overlay` and the anchor patches of
   `tools/build_browsdr_receiver.py`): Listener dB scale, spectrum markers on the
   Listener, tuning stamps, the postMessage bridge, theme tokens, and more.
3. The kit's own changes: the Records archive and every server call removed
   (marker sets in localStorage, VFO audio recordings as local downloads), the
   bridge turned into a documented embed API with configurable parent origins,
   relative build paths, no service worker, PWA, WebRTC remote or live
   transcription, and the host client, example and documentation.

The WebAssembly DSP in `hackrf-web/` (Rust, RustFFT) is upstream BrowSDR code;
`hackrf-web/pkg/` is its prebuilt output.

AGPL-3.0 section 13: if you let users interact with a modified version of this
kit over a network, you must offer those users the corresponding source code of
your version, for example with a visible link to your repository.
