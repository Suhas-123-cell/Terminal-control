import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = {
  onSend: (bytes: string) => void;
  ctrlSticky: boolean;
  onToggleCtrl: () => void;
};

const ARROW = { up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D' };

// Applies a sticky Ctrl to the first typed character: Ctrl+@,A..Z,[,\,],^,_
// map to 0x00..0x1f and Ctrl+Space to NUL. Other characters pass through.
// (Soft keyboards can deliver a whole word at once, hence "first".)
export function applyCtrl(data: string): string {
  const first = data.charAt(0);
  if (first === '' || first.charCodeAt(0) > 127) return data;
  const code = first === ' ' ? 64 : first.toUpperCase().charCodeAt(0);
  if (code < 64 || code > 95) return data;
  return String.fromCharCode(code - 64) + data.slice(1);
}

export function SpecialKeysToolbar({ onSend, ctrlSticky, onToggleCtrl }: Props) {
  const key = (label: string, bytes: string, opts?: { wide?: boolean }) => (
    <Pressable
      key={label}
      onPress={() => onSend(bytes)}
      style={[styles.key, opts?.wide && styles.keyWide]}
      accessibilityLabel={label}
    >
      <Text style={styles.keyText}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      style={styles.bar}
      contentContainerStyle={styles.barContent}
    >
      <Pressable
        onPress={onToggleCtrl}
        style={[styles.key, ctrlSticky && styles.keyActive]}
        accessibilityLabel="Ctrl modifier"
      >
        <Text style={styles.keyText}>Ctrl</Text>
      </Pressable>
      {key('^C', '\x03', { wide: true })}
      {key('^D', '\x04')}
      {key('^Z', '\x1a')}
      {key('Esc', '\x1b')}
      {key('Tab', '\x09')}
      {key('↑', ARROW.up)}
      {key('↓', ARROW.down)}
      {key('←', ARROW.left)}
      {key('→', ARROW.right)}
      {ctrlSticky && (
        <View style={styles.ctrlHint}>
          <Text style={styles.ctrlHintText}>Ctrl active — next letter sends its control code</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexGrow: 0, // ScrollView defaults to flexGrow 1 and would eat half the screen
    backgroundColor: '#161b22',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2f3a',
  },
  barContent: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    alignItems: 'center',
  },
  key: {
    minWidth: 44,
    height: 36,
    paddingHorizontal: 10,
    marginHorizontal: 3,
    borderRadius: 6,
    backgroundColor: '#22293a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyWide: {
    minWidth: 52,
  },
  keyActive: {
    backgroundColor: '#3b82f6',
  },
  keyText: {
    color: '#e6e6e6',
    fontSize: 14,
    fontWeight: '600',
  },
  ctrlHint: {
    marginLeft: 8,
    paddingHorizontal: 8,
  },
  ctrlHintText: {
    color: '#8b93a5',
    fontSize: 11,
  },
});
