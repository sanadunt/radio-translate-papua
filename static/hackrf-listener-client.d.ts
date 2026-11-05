// Types of client/hackrf-listener-client.js. The full message shapes are in
// src/client/app/embed-protocol.ts and docs/EMBED_API.md.

export const BRIDGE_CHANNEL: 'hackrf-listener-kit';
export const BRIDGE_VERSION: 1;

export type ListenMode = 'nfm' | 'wfm' | 'am' | 'usb' | 'lsb' | 'dsb' | 'cw' | 'raw';
export type ResultCode =
	| 'OK' | 'NOT_READY' | 'INVALID_COMMAND' | 'NO_WEBUSB' | 'NEEDS_PAIRING' | 'NEEDS_DEVICE_CHOICE'
	| 'MOCK_UNAVAILABLE' | 'CONNECT_FAILED' | 'SWEEP_BUSY' | 'RX_NOT_RUNNING' | 'OUT_OF_RANGE' | 'AUDIO_BLOCKED'
	| 'RECORDING_ACTIVE' | 'SWEEP_UNSUPPORTED' | 'SWEEP_FAILED' | 'MARKER_LIMIT' | 'MARKER_NOT_FOUND'
	| 'MARKER_SAVE_FAILED' | 'TIMEOUT';

interface Envelope { ch: 'hackrf-listener-kit'; v: 1 }

export interface TuneStamp { rev: number; by: 'host' | 'receiver'; id: string | null; receiverRev: number }

export interface ListenerResult extends Partial<Envelope> {
	type?: 'receiver:result';
	id: string | null;
	ok: boolean;
	code: ResultCode;
	message?: string;
	tune?: TuneStamp & { centerHz: number | null; vfoHz: number | null };
	markerId?: string;
}

export interface ListenerHello extends Envelope { type: 'receiver:hello'; protocol: number; mockAvailable: boolean; webusb: boolean }

export interface ListenerStatus extends Envelope {
	type: 'receiver:status';
	seq: number;
	tMs: number;
	webusb: boolean;
	mockAvailable: boolean;
	pairedCount: number | null;
	connected: boolean;
	mock: boolean;
	deviceName: string | null;
	running: boolean;
	busy: 'none' | 'sweep' | 'scan-listen';
	workspace: 'spectrum' | 'listener';
	centerHz: number | null;
	sampleRateHz: number | null;
	sampleRatesHz: number[];
	frequencyShiftHz: number;
	gains: { lnaDb: number | null; vgaDb: number | null; amp: boolean };
	vfo: {
		index: number; enabled: boolean; mode: string; frequencyHz: number | null; bandwidthHz: number | null;
		squelchEnabled: boolean; squelchDb: number | null; volume: number | null;
	} | null;
	squelchOpen: boolean;
	audio: 'none' | 'suspended' | 'running';
	recording: boolean;
	error: { code: 'USB_LOST' | 'RX_ERROR' | 'NO_WEBUSB' } | null;
	notice: string | null;
	tune: TuneStamp;
	display: { auto: boolean; minDb: number; maxDb: number };
	sweep: {
		phase: 'idle' | 'starting' | 'active' | 'stopping';
		source: 'native' | 'manual' | 'simulated';
		startHz: number; stopHz: number; fftSize: 4096 | 8192; resolutionHz: number;
		lnaDb: number | null; vgaDb: number | null; amp: boolean;
		displayMinDb: number; displayMaxDb: number; view: 'current' | 'average' | 'max';
	};
}

export interface ListenerSpectrum extends Envelope {
	type: 'receiver:spectrum';
	seq: number; tMs: number; centerHz: number; startHz: number; stopHz: number;
	sampleRateHz: number; fftSize: number; binCount: number; bins: Float32Array;
}

export interface ListenerSweep extends Envelope {
	type: 'receiver:sweep';
	seq: number; tMs: number; startHz: number; stopHz: number; resolutionHz: number | null;
	sweepCount: number | null; view: 'current' | 'average' | 'max'; binCount: number; bins: Float32Array;
}

export interface ListenerMarkers extends Envelope {
	type: 'receiver:markers';
	rev: number; setId: string | null; setName: string | null; frequencyShiftHz: number;
	markers: Array<{ id: string | null; frequencyHz: number; powerDb: number | null; label: string }>;
	total: number; truncated: boolean;
}

export interface ListenerAudio extends Envelope {
	type: 'receiver:audio';
	seq: number; sampleRateHz: 48000; gap: boolean; samples: Float32Array;
}

export interface ListenerEvents {
	hello: ListenerHello;
	status: ListenerStatus;
	spectrum: ListenerSpectrum;
	sweep: ListenerSweep;
	markers: ListenerMarkers;
	audio: ListenerAudio;
	result: ListenerResult;
	message: Envelope & { type: string; [key: string]: unknown };
}

export interface ListenerClient {
	readonly ready: Promise<ListenerHello>;
	hello: ListenerHello | null;
	status: ListenerStatus | null;
	markers: ListenerMarkers | null;
	on<E extends keyof ListenerEvents>(event: E, handler: (value: ListenerEvents[E]) => void): () => void;
	send(type: `host:${string}`, payload?: Record<string, unknown>): Promise<ListenerResult>;
	subscribe(options: { spectrum?: boolean; audio?: boolean; bins?: number; fps?: number; spanHz?: number }): Promise<ListenerResult>;
	start(options?: { mock?: boolean; listen?: boolean; mode?: ListenMode; centerHz?: number; vfoHz?: number }): Promise<ListenerResult>;
	stop(): Promise<ListenerResult>;
	tune(centerHz: number, vfoHz?: number): Promise<ListenerResult>;
	vfo(options: { frequencyHz?: number; mode?: ListenMode; volume?: number }): Promise<ListenerResult>;
	listen(enabled: boolean): Promise<ListenerResult>;
	display(options: { auto: boolean; minDb?: number; maxDb?: number }): Promise<ListenerResult>;
	gains(options: { lnaDb?: number; vgaDb?: number; amp?: boolean }): Promise<ListenerResult>;
	radio(options: { sampleRateHz: number; confirmRecording?: boolean }): Promise<ListenerResult>;
	sweepStart(options?: { mock?: boolean; confirmRecording?: boolean }): Promise<ListenerResult>;
	sweepStop(options?: { resumeRx: boolean }): Promise<ListenerResult>;
	sweepConfig(options: { startHz?: number; stopHz?: number; fftSize?: 4096 | 8192; lnaDb?: number; vgaDb?: number; amp?: boolean }): Promise<ListenerResult>;
	sweepDisplay(options: { minDb: number; maxDb: number }): Promise<ListenerResult>;
	addMarker(frequencyHz: number): Promise<ListenerResult>;
	removeMarker(markerId: string): Promise<ListenerResult>;
	appearance(options: { theme?: 'dark' | 'light'; lang?: 'en' | 'id' }): Promise<ListenerResult>;
	destroy(): void;
}

export function createListenerClient(
	iframe: HTMLIFrameElement,
	options?: { origin?: string; timeoutMs?: number; longTimeoutMs?: number },
): ListenerClient;
