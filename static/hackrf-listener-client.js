/**
 * Host-side client of the HackRF Listener Kit embed API (docs/EMBED_API.md).
 * Plain ES module, no dependencies: copy it into any page that frames the kit.
 *
 *   import { createListenerClient } from './hackrf-listener-client.js';
 *   const listener = createListenerClient(document.querySelector('iframe'));
 *   await listener.ready;
 *   listener.on('spectrum', frame => draw(frame.bins, frame.startHz, frame.stopHz));
 *   await listener.subscribe({ spectrum: true, bins: 512, fps: 10 });
 *   const result = await listener.start({ centerHz: 433_920_000, listen: true, mode: 'nfm' });
 *   if (!result.ok) console.log(result.code); // NEEDS_PAIRING: click Connect inside the kit once
 *
 * Every command resolves with the kit's receiver:result ({ id, ok, code, message?, tune?, ... });
 * it never rejects. A command the kit did not answer in time resolves with code TIMEOUT.
 */

export const BRIDGE_CHANNEL = 'hackrf-listener-kit';
export const BRIDGE_VERSION = 1;

/** Commands that may wait on the radio (connect, RX restart, scan start or stop). */
const LONG_COMMANDS = new Set(['host:start', 'host:radio', 'host:sweep-start', 'host:sweep-stop']);
const DEFAULT_TIMEOUT_MS = 8_000;
const LONG_TIMEOUT_MS = 20_000;
/** Commands sent before the kit's receiver:hello wait in this queue. */
const MAX_QUEUED = 16;
const EVENTS = ['hello', 'status', 'spectrum', 'sweep', 'markers', 'audio', 'result', 'message'];

function originOf(iframe) {
	const src = iframe.getAttribute('src') || iframe.src;
	if (!src) throw new TypeError('createListenerClient: the iframe has no src; pass options.origin');
	return new URL(src, window.location.href).origin;
}

/**
 * @param {HTMLIFrameElement} iframe the frame that shows the kit
 * @param {{ origin?: string, timeoutMs?: number, longTimeoutMs?: number }} [options]
 *   origin: the kit's origin (default: from the iframe's src); messages from any other origin are ignored.
 */
export function createListenerClient(iframe, options = {}) {
	const kitOrigin = options.origin || originOf(iframe);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const longTimeoutMs = options.longTimeoutMs ?? LONG_TIMEOUT_MS;
	const listeners = new Map(EVENTS.map(name => [name, new Set()]));
	const pending = new Map();
	const queue = [];
	let counter = 0;
	let helloSeen = false;
	let destroyed = false;
	let resolveReady;
	const ready = new Promise(resolve => { resolveReady = resolve; });

	const client = {
		ready,
		/** The latest receiver:hello, receiver:status and receiver:markers, or null. */
		hello: null,
		status: null,
		markers: null,
		on(event, handler) {
			const set = listeners.get(event);
			if (!set) throw new TypeError(`createListenerClient: unknown event ${event}`);
			set.add(handler);
			return () => set.delete(handler);
		},
		/** Sends any host:* command; payload fields as in docs/EMBED_API.md. */
		send(type, payload = {}) {
			if (destroyed) return Promise.resolve({ id: null, ok: false, code: 'NOT_READY' });
			const id = `h${++counter}-${Math.random().toString(36).slice(2, 8)}`;
			const message = { ch: BRIDGE_CHANNEL, v: BRIDGE_VERSION, type, id, ...payload };
			return new Promise(resolve => {
				const entry = { resolve, timer: null };
				pending.set(id, entry);
				const arm = () => {
					entry.timer = setTimeout(() => settle(id, { id, ok: false, code: 'TIMEOUT' }), LONG_COMMANDS.has(type) ? longTimeoutMs : timeoutMs);
				};
				if (helloSeen) {
					post(message);
					arm();
				} else if (queue.length >= MAX_QUEUED) {
					settle(id, { id, ok: false, code: 'NOT_READY' });
				} else {
					queue.push({ message, arm });
				}
			});
		},
		subscribe(subscription) { return client.send('host:subscribe', { spectrum: true, ...subscription }); },
		start(options = {}) { return client.send('host:start', options); },
		stop() { return client.send('host:stop'); },
		tune(centerHz, vfoHz) { return client.send('host:tune', vfoHz === undefined ? { centerHz } : { centerHz, vfoHz }); },
		vfo(options) { return client.send('host:vfo', options); },
		listen(enabled) { return client.send('host:listen', { enabled: Boolean(enabled) }); },
		display(options) { return client.send('host:display', options); },
		gains(options) { return client.send('host:gains', options); },
		radio(options) { return client.send('host:radio', options); },
		sweepStart(options = {}) { return client.send('host:sweep-start', options); },
		sweepStop(options = { resumeRx: false }) { return client.send('host:sweep-stop', options); },
		sweepConfig(options) { return client.send('host:sweep-config', options); },
		sweepDisplay(options) { return client.send('host:sweep-display', options); },
		addMarker(frequencyHz) { return client.send('host:marker-add', { frequencyHz }); },
		removeMarker(markerId) { return client.send('host:marker-remove', { markerId }); },
		appearance(options) { return client.send('host:appearance', options); },
		/** Silences (true) or restores the kit page's own speaker; receiver:audio keeps flowing. */
		outputMute(muted) { return client.send('host:output-mute', { muted: Boolean(muted) }); },
		/** Stops listening; commands still waiting resolve with NOT_READY. */
		destroy() {
			if (destroyed) return;
			destroyed = true;
			window.removeEventListener('message', onMessage);
			iframe.removeEventListener('load', onLoad);
			for (const { message } of queue.splice(0)) settle(message.id, { id: message.id, ok: false, code: 'NOT_READY' });
			for (const id of [...pending.keys()]) settle(id, { id, ok: false, code: 'NOT_READY' });
		},
	};

	function emit(event, value) {
		for (const handler of listeners.get(event)) {
			try {
				handler(value);
			} catch (error) {
				console.error(`hackrf-listener-client: a ${event} handler threw`, error);
			}
		}
	}

	function post(message) {
		iframe.contentWindow?.postMessage(message, kitOrigin);
	}

	function settle(id, result) {
		const entry = pending.get(id);
		if (!entry) return;
		pending.delete(id);
		if (entry.timer !== null) clearTimeout(entry.timer);
		entry.resolve(result);
	}

	function sayHello() {
		if (!destroyed) post({ ch: BRIDGE_CHANNEL, v: BRIDGE_VERSION, type: 'host:hello' });
	}

	function onMessage(event) {
		if (event.source !== iframe.contentWindow || event.origin !== kitOrigin) return;
		const data = event.data;
		if (!data || typeof data !== 'object' || data.ch !== BRIDGE_CHANNEL || data.v !== BRIDGE_VERSION || typeof data.type !== 'string') return;
		emit('message', data);
		switch (data.type) {
			case 'receiver:hello':
				client.hello = data;
				if (!helloSeen) {
					helloSeen = true;
					// Answering the hello fixes this page as the host of a cross-origin kit.
					sayHello();
					for (const { message, arm } of queue.splice(0)) {
						post(message);
						arm();
					}
					resolveReady(data);
				}
				emit('hello', data);
				return;
			case 'receiver:status':
				client.status = data;
				emit('status', data);
				return;
			case 'receiver:markers':
				client.markers = data;
				emit('markers', data);
				return;
			case 'receiver:result':
				emit('result', data);
				settle(data.id, data);
				return;
			case 'receiver:spectrum':
				emit('spectrum', data);
				return;
			case 'receiver:sweep':
				emit('sweep', data);
				return;
			case 'receiver:audio':
				emit('audio', data);
				return;
		}
	}

	function onLoad() {
		// A (re)loaded frame has a new kit page: commands wait for its hello again, and this hello asks for it.
		helloSeen = false;
		sayHello();
	}

	window.addEventListener('message', onMessage);
	iframe.addEventListener('load', onLoad);
	sayHello();
	return client;
}
