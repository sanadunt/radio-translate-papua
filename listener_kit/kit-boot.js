// Runs before the stylesheet so the kit paints in the right theme and language
// from the first frame. A host passes both in the iframe URL (?theme=&lang=);
// the stored choice covers a direct visit.
(function () {
	var root = document.documentElement;
	var params = new URLSearchParams(window.location.search);
	var theme = params.get('theme');
	var lang = params.get('lang');
	try {
		if (theme !== 'light' && theme !== 'dark') theme = window.localStorage.getItem('hackrf-listener-kit:theme');
		if (lang !== 'en' && lang !== 'id') lang = window.localStorage.getItem('hackrf-listener-kit:lang');
	} catch (error) {
		// Storage can be blocked; fall back to the defaults below.
	}
	root.dataset.theme = theme === 'light' ? 'light' : 'dark';
	root.lang = lang === 'id' ? 'id' : 'en';
})();
