// Uji ujung-ke-ujung integrasi HackRF Listener Kit di Chrome headless (Mock SDR,
// tanpa HackRF). Menjalankan tombol-tombol halaman Set Radio milik aplikasi ini dan
// mencatat setiap perintah host:* beserta receiver:result-nya.
//
//   1. Jalankan aplikasi: YALI_PORT=5050 .venv/bin/python app_faster_whisper_lokal.py
//   2. npm run test:e2e        (opsional: APP_URL=..., CHROME=..., SCREENSHOT=panel.png)
//
// Chrome dijalankan dengan --mute-audio karena Mock SDR menghasilkan audio noise.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_URL = process.env.APP_URL || 'http://localhost:5050';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.CDP_PORT || 9333);
// Origin lain yang TIDAK terdaftar di listener_kit/kit-config.js (localhost != 127.0.0.1).
const FOREIGN_URL = APP_URL.replace('localhost', '127.0.0.1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function check(name, ok, detail = '') {
	checks.push({ name, ok });
	console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function cdpPage(url) {
	const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
	const target = await res.json();
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
	let seq = 0;
	const pending = new Map();
	const exceptions = [];
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.id && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		} else if (msg.method === 'Runtime.exceptionThrown') {
			exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
		}
	};
	const send = (method, params = {}) => new Promise((resolve) => {
		const id = ++seq;
		pending.set(id, resolve);
		ws.send(JSON.stringify({ id, method, params }));
	});
	await send('Runtime.enable');
	await send('Page.enable');
	const evaluate = async (expression) => {
		const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description || 'evaluate failed');
		return reply.result?.result?.value;
	};
	const waitFor = async (expression, timeoutMs = 10_000) => {
		const until = Date.now() + timeoutMs;
		while (Date.now() < until) {
			try { if (await evaluate(expression)) return true; } catch { /* halaman belum siap */ }
			await sleep(150);
		}
		return false;
	};
	return { send, evaluate, waitFor, exceptions, close: () => ws.close() };
}

// Hasil perintah host:* terakhir dengan type ini (dicatat oleh instrumentasi di halaman).
const resultOf = (type) => `(window.__kit.results.filter(r => r.type === ${JSON.stringify(type)}).at(-1) || null)`;

async function expectResult(page, label, type, action, timeoutMs = 10_000, expected = 'OK') {
	const before = await page.evaluate(`window.__kit.results.filter(r => r.type === ${JSON.stringify(type)}).length`);
	if (typeof action === 'function') await action();
	else await page.evaluate(action);
	const arrived = await page.waitFor(`window.__kit.results.filter(r => r.type === ${JSON.stringify(type)}).length > ${before}`, timeoutMs);
	const result = arrived ? await page.evaluate(resultOf(type)) : null;
	check(label, result?.code === expected, result ? result.code : 'tidak ada receiver:result');
}

const click = (id) => `document.getElementById(${JSON.stringify(id)}).click()`;

// Klik mouse sungguhan (CDP Input) supaya browser memberi user activation, seperti
// operator menekan tombol; .click() dari skrip tidak membuka AudioContext di kit.
async function realClick(page, id) {
	const box = await page.evaluate(`(() => {
		const el = document.getElementById(${JSON.stringify(id)});
		el.scrollIntoView({ block: 'center' });
		const r = el.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	})()`);
	for (const type of ['mousePressed', 'mouseReleased']) {
		await page.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
	}
}
const setValue = (id, value) => `(document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(value)})`;
const selectSource = (value) => `(() => { const s = document.getElementById('radioSourceSelect'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); })()`;

const INSTRUMENT = `(() => {
	window.__kit = { sent: {}, results: [], types: {} };
	window.addEventListener('message', (e) => {
		const d = e.data;
		if (!d || d.ch !== 'hackrf-listener-kit') return;
		window.__kit.types[d.type] = (window.__kit.types[d.type] || 0) + 1;
		if (d.type === 'receiver:result') window.__kit.results.push({ type: window.__kit.sent[d.id] || '?', code: d.code });
	});
	const frame = document.getElementById('listenerFrame').contentWindow;
	const original = frame.postMessage.bind(frame);
	frame.postMessage = (message, origin, transfer) => {
		if (message && message.id) window.__kit.sent[message.id] = message.type;
		return original(message, origin, transfer);
	};
	return true;
})()`;

// Halaman host minimal di origin `pageUrl` yang membingkai kit di APP_URL dan menghitung receiver:hello.
const FRAME_PROBE = `(async () => {
	const kitOrigin = ${JSON.stringify(new URL(APP_URL).origin)};
	const iframe = document.createElement('iframe');
	iframe.allow = 'usb; autoplay';
	let hellos = 0;
	window.addEventListener('message', (e) => {
		if (e.source === iframe.contentWindow && e.data && e.data.type === 'receiver:hello') hellos++;
	});
	iframe.addEventListener('load', () => iframe.contentWindow.postMessage({ ch: 'hackrf-listener-kit', v: 1, type: 'host:hello' }, kitOrigin));
	iframe.src = kitOrigin + '/listener/?mock=1';
	document.body.appendChild(iframe);
	await new Promise((r) => setTimeout(r, 6000));
	return hellos;
})()`;

async function main() {
	const profile = mkdtempSync(join(tmpdir(), 'listener-e2e-'));
	const chrome = spawn(CHROME, [
		'--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
		`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--window-size=1440,1400', 'about:blank',
	], { stdio: ['ignore', 'ignore', 'pipe'] });
	let chromeStderr = '';
	chrome.stderr.on('data', (chunk) => { chromeStderr = (chromeStderr + chunk).slice(-2000); });
	try {
		let up = false;
		for (let i = 0; i < 100 && !up; i++) {
			try { up = (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok; } catch { await sleep(200); }
		}
		if (!up) throw new Error(`Chrome headless tidak bisa dihubungi lewat CDP.\n${chromeStderr}`);

		const page = await cdpPage(`${APP_URL}/`);
		if (!(await page.waitFor(`document.readyState === 'complete' && !!document.getElementById('radioSourceSelect')`, 20_000))) {
			const where = await page.evaluate(`JSON.stringify({ url: location.href, state: document.readyState, title: document.title })`).catch((e) => String(e));
			throw new Error(`Halaman aplikasi tidak termuat: ${where}`);
		}
		await page.evaluate(`${click('navSetRadioBtn')}; ${selectSource('webusb')}`);
		const ready = await page.waitFor(`[...document.querySelectorAll('#logBox > *')].some(e => e.textContent.includes('panel radio siap'))`, 15_000);
		check('kit siap (receiver:hello)', ready);
		await page.evaluate(INSTRUMENT);

		// Keluar lalu masuk lagi ke sumber webusb: host:subscribe false lalu true.
		await expectResult(page, 'subscribe', 'host:subscribe', `${selectSource('network')}; ${selectSource('webusb')}`);
		await page.waitFor(`window.__kit.results.filter(r => r.type === 'host:subscribe').length >= 2`);
		const subs = await page.evaluate(`window.__kit.results.filter(r => r.type === 'host:subscribe').map(r => r.code)`);
		check('subscribe (berhenti, lalu langganan lagi)', subs.length >= 2 && subs.every((c) => c === 'OK'), subs.join(', '));

		await page.evaluate(`document.getElementById('listenerMock').checked = true`);
		await expectResult(page, 'start {mock: true, listen: true} (klik operator)', 'host:start', () => realClick(page, 'listenerStartBtn'), 20_000);
		const audio = await page.waitFor(`document.querySelector('#listenerStatus dd:nth-of-type(6)')?.textContent === 'aktif'`, 5_000);
		check('audio VFO aktif (tidak ditahan browser)', audio, await page.evaluate(`document.querySelector('#listenerStatus dd:nth-of-type(6)')?.textContent`));
		const gains = await page.evaluate(resultOf('host:gains'));
		check('gains (dikirim sebelum start)', gains?.code === 'OK', gains?.code);
		const spectrum = await page.waitFor(`(window.__kit.types['receiver:spectrum'] || 0) >= 3`);
		check('receiver:spectrum datang', spectrum, `${await page.evaluate(`window.__kit.types['receiver:spectrum'] || 0`)} frame`);
		const axis = await page.evaluate(`document.getElementById('axisCenter').textContent`);
		check('spektrum digambar di kanvas halaman (sumbu frekuensi)', /155\.9500/.test(axis), axis);
		check('label MOCK tampil di toolbar', /MOCK/.test(await page.evaluate(`document.getElementById('spectrumStatusPill').textContent`)));

		await expectResult(page, 'tala dekat (geser VFO)', 'host:vfo', `${setValue('freqManual', '160.000')}; ${click('freqSetBtn')}`);
		await expectResult(page, 'tune jauh (pindah pusat RX)', 'host:tune', `${setValue('freqManual', '433.920')}; ${click('freqSetBtn')}`);
		const vfoHz = await page.waitFor(`window.__kit && document.querySelector('#listenerStatus dd:nth-of-type(5)')?.textContent.startsWith('433.920000')`);
		check('status kit mengikuti frekuensi baru', vfoHz, await page.evaluate(`document.querySelector('#listenerStatus dd:nth-of-type(5)')?.textContent`));
		await expectResult(page, 'mode (AM)', 'host:vfo', `(() => { const m = document.getElementById('modeSelect'); m.value = 'AM'; m.dispatchEvent(new Event('change')); })()`);

		await expectResult(page, 'marker-add', 'host:marker-add', click('listenerMarkerAddBtn'));
		const markerShown = await page.waitFor(`!!document.querySelector('#listenerMarkers button[data-marker-id]')`);
		check('marker tampil di daftar', markerShown);
		if (markerShown) await expectResult(page, 'marker-remove', 'host:marker-remove', `document.querySelector('#listenerMarkers button[data-marker-id]').click()`);

		await expectResult(page, 'sweep-config 400–500 MHz', 'host:sweep-config', `${setValue('listenerSweepStart', '400')}; ${setValue('listenerSweepStop', '500')}; ${click('listenerSweepConfigBtn')}`);
		await expectResult(page, 'sweepStart {mock: true}', 'host:sweep-start', click('listenerSweepStartBtn'), 20_000);
		const sweep = await page.waitFor(`(window.__kit.types['receiver:sweep'] || 0) >= 2`, 15_000);
		check('receiver:sweep datang', sweep, `${await page.evaluate(`window.__kit.types['receiver:sweep'] || 0`)} frame`);
		check('hasil scan berlabel SIMULASI', /SIMULASI/.test(await page.evaluate(`document.getElementById('listenerSweepInfo').textContent`)));
		await expectResult(page, 'start saat scan dijawab SWEEP_BUSY', 'host:start', click('listenerStartBtn'), 10_000, 'SWEEP_BUSY');
		await expectResult(page, 'sweepStop {resumeRx: true}', 'host:sweep-stop', click('listenerSweepStopBtn'), 20_000);
		await page.waitFor(`document.getElementById('listenerStatusPill').textContent.startsWith('RX')`, 10_000);

		// Rekam & Translate dari Radio V2 (browser): audio kit -> POST /webusb/audio -> /record-radio.
		const audioBefore = await page.evaluate(`window.__kit.types['receiver:audio'] || 0`);
		check('tanpa rekaman, kit tidak mengirim receiver:audio', audioBefore === 0, `${audioBefore} pesan`);
		await page.evaluate(`${click('navTranslateBtn')}; (() => { const d = document.getElementById('deviceSelect'); d.value = '-2'; d.dispatchEvent(new Event('change')); })()`);
		await realClick(page, 'playRadioBtn');
		const forwarding = await page.waitFor(`[...document.querySelectorAll('#logBox > *')].some(e => e.textContent.includes('audio VFO diteruskan ke backend'))`, 8_000);
		check('Rekam & Translate memakai Radio V2 (browser) (audio diteruskan)', forwarding);
		await page.waitFor(`/Merekam ucapan/.test(document.getElementById('statusPill').textContent)`, 8_000);
		await sleep(2500);
		const audioDuring = await page.evaluate(`window.__kit.types['receiver:audio'] || 0`);
		check('receiver:audio datang selama rekaman', audioDuring >= 10, `${audioDuring} pesan`);
		await realClick(page, 'playRadioBtn');
		const transcript = await page.waitFor(`/\\[TANPA MODEL\\] Audio [0-9.]+ dtk/.test(document.getElementById('whisperOutput').value)`, 20_000);
		check('rekaman Radio V2 sampai Whisper (mode tanpa model)', transcript, await page.evaluate(`document.getElementById('whisperOutput').value`));
		await sleep(1500);
		const audioAfterStop = await page.evaluate(`window.__kit.types['receiver:audio'] || 0`);
		await sleep(1500);
		const audioLater = await page.evaluate(`window.__kit.types['receiver:audio'] || 0`);
		check('setelah berhenti, kit berhenti mengirim audio', audioLater === audioAfterStop, `${audioLater - audioAfterStop} pesan baru`);
		await page.evaluate(click('navSetRadioBtn'));

		await expectResult(page, 'stop', 'host:stop', click('listenerStopBtn'));

		// Peringatan yang diharapkan: start yang sengaja dikirim saat scan, dan
		// squelch Mock SDR yang mati waktu merekam.
		const errors = await page.evaluate(`[...document.querySelectorAll('#logBox .type-warn, #logBox .type-err')]
			.map(e => e.textContent).filter(t => t.includes('Radio V2') && !t.includes('sedang dipakai wide scan') && !t.includes('squelch VFO mati'))`);
		check('log aplikasi tanpa peringatan/error tak terduga', errors.length === 0, errors.join(' | '));
		check('tanpa exception JavaScript di halaman', page.exceptions.length === 0, page.exceptions.join(' | '));

		if (process.env.SCREENSHOT) {
			await page.evaluate(`document.getElementById('listenerPanel').scrollIntoView()`);
			await sleep(500);
			const shot = await page.send('Page.captureScreenshot', { format: 'png' });
			writeFileSync(process.env.SCREENSHOT, Buffer.from(shot.result.data, 'base64'));
		}
		page.close();

		// Origin: host lintas-origin yang tidak terdaftar tidak boleh mendapat receiver:hello.
		const foreign = await cdpPage(`${FOREIGN_URL}/health`);
		await foreign.waitFor(`document.readyState === 'complete'`);
		const foreignHellos = await foreign.evaluate(FRAME_PROBE);
		check(`host dari ${new URL(FOREIGN_URL).origin} (tidak terdaftar) TIDAK mendapat receiver:hello`, foreignHellos === 0, `${foreignHellos} hello`);
		foreign.close();
		const same = await cdpPage(`${APP_URL}/health`);
		await same.waitFor(`document.readyState === 'complete'`);
		const sameHellos = await same.evaluate(FRAME_PROBE);
		check(`kontrol: host same-origin ${new URL(APP_URL).origin} mendapat receiver:hello`, sameHellos > 0, `${sameHellos} hello`);
		same.close();
	} finally {
		chrome.kill();
		await sleep(300);
		rmSync(profile, { recursive: true, force: true });
	}
	const failed = checks.filter((c) => !c.ok).length;
	console.log(`\n${checks.length - failed}/${checks.length} cek lulus`);
	process.exit(failed ? 1 : 0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
