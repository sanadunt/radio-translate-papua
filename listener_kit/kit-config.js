// HackRF Listener Kit deployment settings. Edit after a build; no rebuild needed.
window.HACKRF_LISTENER_CONFIG = {
	// Origins (scheme://host[:port]) besides this page's own that may frame the kit
	// and drive it through postMessage. Exact origins only; "*" is ignored.
	// Example: ['https://ops.example.com', 'http://192.168.1.20:8080']
	allowedParentOrigins: [],
	// The Mock SDR (open with ?mock=1) is offered on localhost only, unless this is true.
	allowMockOnAnyHost: false,
};
