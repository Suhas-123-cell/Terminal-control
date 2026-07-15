// HTML page loaded into each terminal WebView. Loads xterm.js + fit addon
// from CDN (the device has internet), wires it to the RN <-> WebView bridge:
//   - RN -> WebView: injectJavaScript("window.termWrite('<json-string>')")
//   - WebView -> RN: window.ReactNativeWebView.postMessage(JSON string)
export const terminalHtml = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
<style>
  html, body { margin: 0; padding: 0; background: #0b0e14; height: 100%; overflow: hidden; }
  #terminal { width: 100%; height: 100%; }
  .xterm { padding: 4px; }
</style>
</head>
<body>
<div id="terminal"></div>
<script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
<script>
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'Menlo, Consolas, monospace',
    theme: { background: '#0b0e14', foreground: '#e6e6e6' },
    scrollback: 5000,
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal'));
  fitAddon.fit();

  function post(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }

  term.onData((data) => post({ type: 'input', data }));

  let lastCols = term.cols, lastRows = term.rows;
  function reportResizeIfChanged() {
    if (term.cols !== lastCols || term.rows !== lastRows) {
      lastCols = term.cols;
      lastRows = term.rows;
      post({ type: 'resize', cols: term.cols, rows: term.rows });
    }
  }
  term.onResize(reportResizeIfChanged);

  window.addEventListener('resize', () => { fitAddon.fit(); });

  // Native code calls this to inject raw bytes/output into this terminal.
  window.termWrite = function (dataJson) {
    term.write(JSON.parse(dataJson));
  };

  post({ type: 'ready' });
  reportResizeIfChanged();
</script>
</body>
</html>`;
