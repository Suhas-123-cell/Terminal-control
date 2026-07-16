import React, { useEffect, useRef, useState } from 'react';
import {
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

export function ScreenControlScreen({ client }: Props) {
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [remoteSize, setRemoteSize] = useState<{ width: number; height: number } | null>(null);
  const [layout, setLayout] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const keyboardInputRef = useRef<TextInput>(null);
  const panState = useRef({ startX: 0, startY: 0, moved: false });

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const remoteSizeRef = useRef(remoteSize);
  remoteSizeRef.current = remoteSize;

  useEffect(() => {
    client.screenStart();
    const unsub = client.onMessage((msg) => {
      if (msg.type === 'screen-frame') {
        setFrameUri(`data:image/jpeg;base64,${msg.data}`);
        if (msg.width && msg.height) {
          setRemoteSize({ width: msg.width, height: msg.height });
        }
      }
    });
    return () => {
      unsub();
      client.screenStop();
    };
  }, [client]);

  const toRemoteCoords = (localX: number, localY: number) => {
    const { width, height } = layoutRef.current;
    const remote = remoteSizeRef.current;
    if (!remote || width === 0 || height === 0) return null;
    return {
      x: (localX / width) * remote.width,
      y: (localY / height) * remote.height,
    };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        panState.current = { startX: locationX, startY: locationY, moved: false };
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const dx = locationX - panState.current.startX;
        const dy = locationY - panState.current.startY;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          panState.current.moved = true;
        }
      },
      onPanResponderRelease: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const start = toRemoteCoords(panState.current.startX, panState.current.startY);
        const end = toRemoteCoords(locationX, locationY);
        if (!start || !end) return;
        if (panState.current.moved) {
          client.screenInput({ action: 'drag', x: start.x, y: start.y, toX: end.x, toY: end.y });
        } else {
          client.screenInput({ action: 'click', x: end.x, y: end.y });
        }
      },
    })
  ).current;

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
  };

  const sendKey = (key: string) => client.screenInput({ action: 'key', key });

  return (
    <View style={styles.container}>
      <View style={styles.imageArea} onLayout={handleLayout} {...panResponder.panHandlers}>
        {frameUri ? (
          <Image source={{ uri: frameUri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
        ) : (
          <Text style={styles.waiting}>Waiting for screen…</Text>
        )}
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

      <TextInput
        ref={keyboardInputRef}
        style={styles.hiddenInput}
        value=""
        autoCorrect={false}
        autoCapitalize="none"
        onChangeText={(text) => {
          if (text.length > 0) {
            client.screenInput({ action: 'type', text });
          }
        }}
        blurOnSubmit={false}
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
    color: '#5b6270',
    textAlign: 'center',
    marginTop: 40,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#161b22',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2f3a',
    padding: 6,
    paddingBottom: Platform.OS === 'ios' ? 24 : 6,
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
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
    bottom: 0,
  },
});
