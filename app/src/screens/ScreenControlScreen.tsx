import React, { useEffect, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  Image,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { TerminalClient } from '../lib/wsClient';

type Props = {
  client: TerminalClient;
};

const DRAG_THRESHOLD = 12; // px on the phone screen before a tap counts as a drag
const LONG_PRESS_MS = 500; // hold this long without moving = right-click
const DOUBLE_TAP_MS = 250; // second tap within this window = double-click
const DOUBLE_TAP_SLOP = 30; // px between the two taps of a double-tap

type Size = { width: number; height: number };

// Where a remote frame of `remote` size lands inside `box` with "contain"
// scaling (centered, aspect ratio kept, letterboxed).
function containRect(box: Size, remote: Size) {
  const scale = Math.min(box.width / remote.width, box.height / remote.height);
  const width = remote.width * scale;
  const height = remote.height * scale;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height, scale };
}

export function ScreenControlScreen({ client }: Props) {
  // Two image layers, ping-ponged: Android blanks an Image while it decodes a
  // new source, so each frame loads into the hidden layer and is only brought
  // to the front once loaded. Frames arriving mid-decode collapse to the latest.
  const [layers, setLayers] = useState<[string | null, string | null]>([null, null]);
  const [front, setFront] = useState<0 | 1>(0);
  const frontRef = useRef<0 | 1>(0);
  const loadingRef = useRef(false);
  const nextFrameRef = useRef<string | null>(null);
  const [remoteSize, setRemoteSize] = useState<Size | null>(null);
  const [layout, setLayout] = useState<Size>({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  const keyboardInputRef = useRef<TextInput>(null);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const remoteSizeRef = useRef(remoteSize);
  remoteSizeRef.current = remoteSize;

  const showFrame = (uri: string) => {
    if (loadingRef.current) {
      nextFrameRef.current = uri;
      return;
    }
    loadingRef.current = true;
    const back = frontRef.current === 0 ? 1 : 0;
    setLayers((prev) => (back === 0 ? [uri, prev[1]] : [prev[0], uri]));
  };

  const handleLayerLoad = (layer: 0 | 1) => {
    if (layer === frontRef.current) return;
    frontRef.current = layer;
    setFront(layer);
    loadingRef.current = false;
    const next = nextFrameRef.current;
    nextFrameRef.current = null;
    if (next) showFrame(next);
  };

  // A frame that fails to decode must not wedge the stream.
  const handleLayerError = () => {
    loadingRef.current = false;
    const next = nextFrameRef.current;
    nextFrameRef.current = null;
    if (next) showFrame(next);
  };

  useEffect(() => {
    client.screenStart();
    const unsub = client.onMessage((msg) => {
      if (msg.type === 'screen-frame') {
        showFrame(`data:image/jpeg;base64,${msg.data}`);
        setError(null);
        if (msg.width && msg.height) {
          setRemoteSize({ width: msg.width, height: msg.height });
        }
      } else if (msg.type === 'screen-error') {
        setError(msg.message);
      }
    });
    // The server forgets screen subscribers on reconnect: re-subscribe.
    const unsubStatus = client.onStatus((s) => {
      if (s === 'connected') client.screenStart();
    });
    return () => {
      unsub();
      unsubStatus();
      client.screenStop();
    };
  }, [client]);

  // Phone-local point -> remote screen point, or null if it's in the letterbox.
  const toRemoteCoords = (localX: number, localY: number) => {
    const remote = remoteSizeRef.current;
    const box = layoutRef.current;
    if (!remote || box.width === 0 || box.height === 0) return null;
    const rect = containRect(box, remote);
    const x = (localX - rect.x) / rect.scale;
    const y = (localY - rect.y) / rect.scale;
    // 1px of slack for float error at the image edges, then clamp on-screen.
    if (x < -1 || y < -1 || x > remote.width + 1 || y > remote.height + 1) return null;
    return {
      x: Math.min(Math.max(x, 0), remote.width - 1),
      y: Math.min(Math.max(y, 0), remote.height - 1),
    };
  };

  const gesture = useRef({
    startX: 0,
    startY: 0,
    moved: false,
    longPressed: false,
    longPressTimer: null as ReturnType<typeof setTimeout> | null,
    lastTap: null as { x: number; y: number; time: number } | null,
    clickTimer: null as ReturnType<typeof setTimeout> | null,
  }).current;

  const clearLongPress = () => {
    if (gesture.longPressTimer) clearTimeout(gesture.longPressTimer);
    gesture.longPressTimer = null;
  };

  const handleTap = (x: number, y: number) => {
    const now = Date.now();
    const last = gesture.lastTap;
    if (
      last &&
      gesture.clickTimer &&
      now - last.time < DOUBLE_TAP_MS &&
      Math.hypot(x - last.x, y - last.y) < DOUBLE_TAP_SLOP
    ) {
      // Second tap: replace the pending single click with a double-click.
      clearTimeout(gesture.clickTimer);
      gesture.clickTimer = null;
      gesture.lastTap = null;
      const point = toRemoteCoords(last.x, last.y);
      if (point) client.screenInput({ action: 'doubleclick', ...point });
      return;
    }
    gesture.lastTap = { x, y, time: now };
    gesture.clickTimer = setTimeout(() => {
      gesture.clickTimer = null;
      const point = toRemoteCoords(x, y);
      if (point) client.screenInput({ action: 'click', ...point });
    }, DOUBLE_TAP_MS);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        gesture.startX = locationX;
        gesture.startY = locationY;
        gesture.moved = false;
        gesture.longPressed = false;
        clearLongPress();
        gesture.longPressTimer = setTimeout(() => {
          gesture.longPressed = true;
          const point = toRemoteCoords(locationX, locationY);
          if (point) client.screenInput({ action: 'rightclick', ...point });
        }, LONG_PRESS_MS);
      },
      onPanResponderMove: (_evt, g) => {
        if (Math.abs(g.dx) > DRAG_THRESHOLD || Math.abs(g.dy) > DRAG_THRESHOLD) {
          gesture.moved = true;
          clearLongPress();
        }
      },
      onPanResponderRelease: (_evt, g) => {
        clearLongPress();
        if (gesture.longPressed) return;
        // Use start + gesture delta: the release event's locationX can be
        // relative to whatever view the finger ended up over.
        const endX = gesture.startX + g.dx;
        const endY = gesture.startY + g.dy;
        if (gesture.moved) {
          const start = toRemoteCoords(gesture.startX, gesture.startY);
          const end = toRemoteCoords(endX, endY);
          if (start && end) {
            client.screenInput({ action: 'drag', x: start.x, y: start.y, toX: end.x, toY: end.y });
          }
        } else {
          handleTap(gesture.startX, gesture.startY);
        }
      },
      onPanResponderTerminate: clearLongPress,
    })
  ).current;

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
  };

  const sendKey = (key: string) => client.screenInput({ action: 'key', key });

  const imageRect = remoteSize && layout.width > 0 ? containRect(layout, remoteSize) : null;
  const hasFrame = layers[0] !== null || layers[1] !== null;

  return (
    <View style={styles.container}>
      <View style={styles.imageArea} onLayout={handleLayout} {...panResponder.panHandlers}>
        {/* pointerEvents none: touches must land on imageArea itself so
            locationX/Y are relative to it, not to a child. */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {hasFrame && imageRect ? (
            ([0, 1] as const).map((layer) =>
              layers[layer] ? (
                <Image
                  key={layer}
                  source={{ uri: layers[layer]! }}
                  onLoad={() => handleLayerLoad(layer)}
                  onError={handleLayerError}
                  style={{
                    position: 'absolute',
                    left: imageRect.x,
                    top: imageRect.y,
                    width: imageRect.width,
                    height: imageRect.height,
                    zIndex: layer === front ? 1 : 0,
                  }}
                  fadeDuration={0}
                />
              ) : null
            )
          ) : (
            <Text style={styles.waiting}>{error ?? 'Waiting for screen…'}</Text>
          )}
          {error && hasFrame && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.toolbar}>
        <Pressable style={styles.key} onPress={() => sendKey('esc')}>
          <Text style={styles.keyText}>Esc</Text>
        </Pressable>
        <Pressable style={styles.key} onPress={() => sendKey('tab')}>
          <Text style={styles.keyText}>Tab</Text>
        </Pressable>
        <Pressable style={styles.key} onPress={() => sendKey('enter')}>
          <Text style={styles.keyText}>Enter</Text>
        </Pressable>
        <Pressable style={styles.key} onPress={() => sendKey('backspace')}>
          <Text style={styles.keyText}>⌫</Text>
        </Pressable>
        <Pressable style={styles.key} onPress={() => sendKey('up')}>
          <Text style={styles.keyText}>↑</Text>
        </Pressable>
        <Pressable style={styles.key} onPress={() => sendKey('down')}>
          <Text style={styles.keyText}>↓</Text>
        </Pressable>
        <Pressable style={styles.key} onPress={() => sendKey('left')}>
          <Text style={styles.keyText}>←</Text>
        </Pressable>
        <Pressable style={styles.key} onPress={() => sendKey('right')}>
          <Text style={styles.keyText}>→</Text>
        </Pressable>
        <Pressable
          style={styles.keyWide}
          onPress={() => keyboardInputRef.current?.focus()}
          accessibilityLabel="Show keyboard"
        >
          <Text style={styles.keyText}>⌨︎ Type</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>Tap = click · double-tap = double-click · hold = right-click · drag = drag</Text>

      <TextInput
        ref={keyboardInputRef}
        style={styles.hiddenInput}
        value=""
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        // Stops Android IMEs from composing/predicting, so each keystroke
        // arrives as typed instead of as rewritten words.
        keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
        onChangeText={(text) => {
          if (text.length > 0) {
            client.screenInput({ action: 'type', text });
          }
        }}
        // The field is always empty, so Backspace never changes its text.
        onKeyPress={(e) => {
          if (e.nativeEvent.key === 'Backspace') sendKey('backspace');
        }}
        submitBehavior="submit"
        onSubmitEditing={() => sendKey('enter')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0e14',
  },
  imageArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  waiting: {
    color: '#8b93a5',
    textAlign: 'center',
    marginTop: 40,
    paddingHorizontal: 24,
  },
  errorBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#5b3d0a',
    padding: 6,
  },
  errorText: {
    color: '#ffd580',
    fontSize: 12,
    textAlign: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#161b22',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2f3a',
    padding: 6,
  },
  key: {
    minWidth: 44,
    height: 40,
    paddingHorizontal: 10,
    margin: 3,
    borderRadius: 6,
    backgroundColor: '#22293a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyWide: {
    height: 40,
    paddingHorizontal: 14,
    margin: 3,
    borderRadius: 6,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: {
    color: '#e6e6e6',
    fontSize: 14,
    fontWeight: '600',
  },
  hint: {
    color: '#5b6270',
    fontSize: 11,
    textAlign: 'center',
    backgroundColor: '#161b22',
    paddingBottom: 6,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
    bottom: 0,
  },
});
