import { fitAddonJs, xtermCss, xtermJs } from './generated/xterm';

// HTML page loaded into each terminal WebView. xterm.js + the fit addon are
// inlined (see scripts/inline-xterm.js), so it works offline. Bridge:
//   - RN -> WebView: injectJavaScript("window.termWrite('<json-string>')"),
//     window.termReset(), window.termFocus()
//   - WebView -> RN: window.ReactNativeWebView.postMessage(JSON string):
//     ready {cols, rows}, input {data}, resize {cols, rows},
//     written {chars} (output fully parsed — drives server flow control),
//     html-error {data}
export const terminalHtml = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>${xtermCss}</style>
<style>
  html, body { margin: 0; padding: 0; background: #0b0e14; height: 100%; overflow: hidden; }
  #terminal { width: 100%; height: 100%; }
  .xterm { padding: 4px; }
</style>
</head>
<body>
<div id="terminal"></div>
<script>
  window.onerror = function (message, source, lineno) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'html-error',
        data: 'onerror: ' + message + ' @ ' + source + ':' + lineno,
      }));
    }
  };
</script>
<script>${xtermJs}</script>
<script>${fitAddonJs}</script>
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

  // Shell commands are not prose: stop the soft keyboard from
  // autocorrecting/predicting/capitalizing what gets typed here.
  var helperTextarea = document.querySelector('.xterm-helper-textarea');
  if (helperTextarea) {
    helperTextarea.setAttribute('autocomplete', 'off');
    helperTextarea.setAttribute('autocorrect', 'off');
    helperTextarea.setAttribute('autocapitalize', 'off');
    helperTextarea.setAttribute('spellcheck', 'false');
  }
  fitAddon.fit();

  function post(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }

  term.onData((data) => post({ type: 'input', data }));
  term.onResize(({ cols, rows }) => post({ type: 'resize', cols, rows }));
  window.addEventListener('resize', () => { fitAddon.fit(); });

  // Native code calls this to inject raw bytes/output into this terminal.
  window.termWrite = function (dataJson) {
    const data = JSON.parse(dataJson);
    term.write(data, () => post({ type: 'written', chars: data.length }));
  };

  // Clears screen + scrollback before the server replays a session's history.
  window.termReset = function () {
    term.reset();
  };

  // Native code calls this when this terminal's tab becomes active, so the
  // soft keyboard follows focus between tabs.
  window.termFocus = function () {
    term.focus();
  };

  // Always report the real size once: the server's PTY starts at whatever the
  // phone asked for (or 80x24) and must learn the fitted size.
  post({ type: 'ready', cols: term.cols, rows: term.rows });
  term.focus();
</script>
</body>
</html>`;
