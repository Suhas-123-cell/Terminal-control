import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { terminalHtml } from '../terminalHtml';

export type TerminalWebViewHandle = {
  write: (data: string) => void;
  focus: () => void;
};

type Props = {
  visible: boolean;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
};

export const TerminalWebView = forwardRef<TerminalWebViewHandle, Props>(
  ({ visible, onInput, onResize }, ref) => {
    const webviewRef = useRef<WebView>(null);

    useImperativeHandle(ref, () => ({
      write: (data: string) => {
        const script = `window.termWrite(${JSON.stringify(JSON.stringify(data))}); true;`;
        webviewRef.current?.injectJavaScript(script);
      },
      focus: () => {
        webviewRef.current?.injectJavaScript('window.termFocus && window.termFocus(); true;');
      },
    }));

    const handleMessage = (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === 'input') {
          onInput(msg.data);
        } else if (msg.type === 'resize') {
          onResize(msg.cols, msg.rows);
        } else if (msg.type === 'html-error') {
          console.error('[TerminalWebView]', msg.data);
        }
      } catch {
        // ignore malformed bridge messages
      }
    };

    return (
      <View style={[StyleSheet.absoluteFill, { display: visible ? 'flex' : 'none' }]}>
        <WebView
          ref={webviewRef}
          source={{ html: terminalHtml }}
          onMessage={handleMessage}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          style={styles.webview}
          scrollEnabled={false}
          keyboardDisplayRequiresUserAction={false}
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
