import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { terminalHtml } from '../terminalHtml';

export type TerminalWebViewHandle = {
  write: (data: string) => void;
  reset: () => void;
  focus: () => void;
};

type Props = {
  visible: boolean;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  // Output chars that are done with (rendered, or discarded): acked to the
  // server so it keeps the shell's output flowing.
  onWritten: (chars: number) => void;
  // The page was reloaded after its content process died and is now empty;
  // the owner should re-request the session's scrollback.
  onReload: () => void;
};

const FLUSH_INTERVAL_MS = 16;

export const TerminalWebView = forwardRef<TerminalWebViewHandle, Props>(
  ({ visible, onInput, onResize, onWritten, onReload }, ref) => {
    const webviewRef = useRef<WebView>(null);
    // Output is buffered until xterm.js has loaded (anything injected before
    // that is lost), and bursts are coalesced into one injection per frame.
    const pending = useRef('');
    const ready = useRef(false);
    const reloading = useRef(false);
    const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Chars injected into the page that it hasn't confirmed as written yet.
    const inFlight = useRef(0);

    const discardPending = () => {
      if (pending.current) onWritten(pending.current.length);
      pending.current = '';
    };

    const flush = () => {
      flushTimer.current = null;
      if (!ready.current || pending.current === '') return;
      const data = pending.current;
      pending.current = '';
      inFlight.current += data.length;
      webviewRef.current?.injectJavaScript(
        `window.termWrite(${JSON.stringify(JSON.stringify(data))}); true;`
      );
    };

    const scheduleFlush = () => {
      if (!flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_INTERVAL_MS);
    };

    useImperativeHandle(ref, () => ({
      write: (data: string) => {
        pending.current += data;
        scheduleFlush();
      },
      reset: () => {
        discardPending();
        if (ready.current) webviewRef.current?.injectJavaScript('window.termReset(); true;');
      },
      focus: () => {
        webviewRef.current?.injectJavaScript('window.termFocus && window.termFocus(); true;');
      },
    }));

    const handleMessage = (event: WebViewMessageEvent) => {
      let msg;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return; // ignore malformed bridge messages
      }
      if (msg.type === 'ready') {
        ready.current = true;
        onResize(msg.cols, msg.rows);
        if (reloading.current) {
          reloading.current = false;
          discardPending();
          onReload();
        } else {
          flush();
        }
      } else if (msg.type === 'written') {
        inFlight.current = Math.max(0, inFlight.current - msg.chars);
        onWritten(msg.chars);
      } else if (msg.type === 'input') {
        onInput(msg.data);
      } else if (msg.type === 'resize') {
        onResize(msg.cols, msg.rows);
      } else if (msg.type === 'html-error') {
        console.error('[TerminalWebView]', msg.data);
      }
    };

    // The OS can kill a WebView's renderer (memory pressure, long time in the
    // background), leaving a blank page — and on Android a dead WebView can't
    // even be reloaded. Remount a fresh one and replay the scrollback into it.
    const [generation, setGeneration] = useState(0);
    const recover = () => {
      // Whatever the dead page never confirmed will never be confirmed.
      onWritten(inFlight.current);
      inFlight.current = 0;
      ready.current = false;
      reloading.current = true;
      setGeneration((g) => g + 1);
    };

    return (
      <View style={[StyleSheet.absoluteFill, { display: visible ? 'flex' : 'none' }]}>
        <WebView
          key={generation}
          ref={webviewRef}
          source={{ html: terminalHtml }}
          onMessage={handleMessage}
          onContentProcessDidTerminate={recover}
          onRenderProcessGone={recover}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          style={styles.webview}
          scrollEnabled={false}
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView
        />
      </View>
    );
  }
);

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: '#0b0e14',
  },
});
