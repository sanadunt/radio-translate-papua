// Test adaptor host HackRF Listener Kit (static/hackrf-listener-client.js) dengan
// iframe & window palsu. Jalankan: npm test
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGE_CHANNEL, BRIDGE_VERSION, createListenerClient } from '../static/hackrf-listener-client.js';

const KIT = 'http://localhost:5050';

function fakeHost() {
	const listeners = new Map();
	globalThis.window = {
		location: { href: `${KIT}/` },
		addEventListener: (type, fn) => listeners.set(type, fn),
		removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
	};
	const frameWindow = { posted: [], postMessage(message, origin) { this.posted.push({ message, origin }); } };
	const iframeListeners = new Map();
	const iframe = {
		src: `${KIT}/listener/?theme=dark&lang=id&mock=1`,
		getAttribute: (name) => (name === 'src' ? `${KIT}/listener/?theme=dark&lang=id&mock=1` : null),
		contentWindow: frameWindow,
		addEventListener: (type, fn) => iframeListeners.set(type, fn),
		removeEventListener: (type, fn) => { if (iframeListeners.get(type) === fn) iframeListeners.delete(type); },
	};
	const fromKit = (data, { origin = KIT, source = frameWindow } = {}) => listeners.get('message')?.({ data, origin, source });
	const kitSays = (type, payload = {}) => fromKit({ ch: BRIDGE_CHANNEL, v: BRIDGE_VERSION, type, ...payload });
	const sent = () => frameWindow.posted.map((p) => p.message.type);
	return { iframe, frameWindow, fromKit, kitSays, iframeListeners, sent };
}

const HELLO = { protocol: 1, mockAvailable: true, webusb: true };

describe('adaptor HackRF Listener Kit', () => {
	beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
	afterEach(() => {
		mock.timers.reset();
		delete globalThis.window;
	});

	it('hanya mengirim ke origin kit, dan mengabaikan origin/sumber/amplop yang salah', () => {
		const host = fakeHost();
		const client = createListenerClient(host.iframe);
		assert.deepEqual(host.frameWindow.posted, [{ message: { ch: BRIDGE_CHANNEL, v: BRIDGE_VERSION, type: 'host:hello' }, origin: KIT }]);
		const seen = [];
		client.on('status', (s) => seen.push(s.seq));
		const status = { ch: BRIDGE_CHANNEL, v: BRIDGE_VERSION, type: 'receiver:status', seq: 1 };
		host.fromKit(status, { origin: 'http://127.0.0.1:5050' });      // origin lain
		host.fromKit(status, { origin: 'https://evil.example' });
		host.fromKit(status, { source: {} });                            // jendela lain
		host.fromKit({ ...status, ch: 'other' });                        // channel salah
		host.fromKit({ ...status, v: 2 });                               // versi salah
		assert.deepEqual(seen, []);
		assert.equal(client.status, null);
		host.fromKit(status);
		assert.deepEqual(seen, [1]);
	});

	it('mengantrikan perintah sampai receiver:hello, lalu mengirimnya berurutan', async () => {
		const host = fakeHost();
		const client = createListenerClient(host.iframe);
		const started = client.start({ mock: true, listen: true, centerHz: 155_950_000, vfoHz: 155_700_000 });
		const tuned = client.tune(433_920_000);
		assert.deepEqual(host.sent(), ['host:hello']);
		// receiver:hello dari origin lain tidak membuka antrian.
		host.fromKit({ ch: BRIDGE_CHANNEL, v: BRIDGE_VERSION, type: 'receiver:hello', ...HELLO }, { origin: 'https://evil.example' });
		assert.deepEqual(host.sent(), ['host:hello']);
		host.kitSays('receiver:hello', HELLO);
		assert.deepEqual(host.sent(), ['host:hello', 'host:hello', 'host:start', 'host:tune']);
		const [, , start, tune] = host.frameWindow.posted.map((p) => p.message);
		assert.match(start.id, /^[A-Za-z0-9_-]{1,64}$/);
		assert.equal(start.mock, true);
		host.kitSays('receiver:result', { id: start.id, ok: true, code: 'OK' });
		host.kitSays('receiver:result', { id: tune.id, ok: false, code: 'OUT_OF_RANGE' });
		assert.equal((await started).code, 'OK');
		assert.equal((await tuned).code, 'OUT_OF_RANGE');
	});

	it('memberi TIMEOUT setelah 8 s (20 s untuk start/radio/sweep-start/sweep-stop)', async () => {
		const host = fakeHost();
		const client = createListenerClient(host.iframe);
		host.kitSays('receiver:hello', HELLO);
		const settled = {};
		client.tune(155_700_000).then((r) => { settled.tune = r.code; });
		client.start({ mock: true }).then((r) => { settled.start = r.code; });
		client.sweepStart({ mock: true }).then((r) => { settled.sweep = r.code; });
		mock.timers.tick(7_999);
		await Promise.resolve();
		assert.deepEqual(settled, {});
		mock.timers.tick(1);
		await Promise.resolve();
		assert.deepEqual(settled, { tune: 'TIMEOUT' });
		mock.timers.tick(12_000);
		await Promise.resolve();
		assert.deepEqual(settled, { tune: 'TIMEOUT', start: 'TIMEOUT', sweep: 'TIMEOUT' });
		// Jawaban yang datang terlambat tidak mengubah apa pun.
		const late = host.frameWindow.posted.find((p) => p.message.type === 'host:tune').message;
		host.kitSays('receiver:result', { id: late.id, ok: true, code: 'OK' });
		await Promise.resolve();
		assert.equal(settled.tune, 'TIMEOUT');
	});

	it('iframe dimuat ulang: kirim host:hello lagi dan antrikan perintah sampai hello baru', async () => {
		const host = fakeHost();
		const client = createListenerClient(host.iframe);
		host.kitSays('receiver:hello', HELLO);
		host.frameWindow.posted.length = 0;
		host.iframeListeners.get('load')();
		assert.deepEqual(host.sent(), ['host:hello']);
		const stopped = client.stop();
		assert.deepEqual(host.sent(), ['host:hello']);
		host.kitSays('receiver:hello', HELLO);
		// hello baru dijawab host:hello (mengunci host untuk kit lintas-origin), lalu antrian dikirim.
		assert.deepEqual(host.sent(), ['host:hello', 'host:hello', 'host:stop']);
		const stop = host.frameWindow.posted.at(-1).message;
		host.kitSays('receiver:result', { id: stop.id, ok: true, code: 'OK' });
		assert.equal((await stopped).code, 'OK');
	});

	it('antrian penuh (16) dijawab NOT_READY, destroy() menutup yang tertunda', async () => {
		const host = fakeHost();
		const client = createListenerClient(host.iframe);
		const queued = Array.from({ length: 16 }, () => client.stop());
		assert.equal((await client.stop()).code, 'NOT_READY');
		client.destroy();
		const codes = await Promise.all(queued);
		assert.ok(codes.every((r) => r.code === 'NOT_READY'));
	});
});
