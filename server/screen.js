// Screen capture + mouse/keyboard injection for the laptop's real desktop.
// Deliberately built on well-tested macOS CLI tools instead of writing
// custom native capture/injection code: `screencapture` (built into macOS)
// for frames, `sips` (built in) to scale them, and `cliclick`
// (brew install cliclick) for input.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FRAME_INTERVAL_MS = 400; // ~2.5 fps, enough to see and click around
const JPEG_QUALITY = 60;

function findCliclick() {
  for (const candidate of ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'cliclick'; // fall back to PATH lookup
}

const CLICLICK = findCliclick();
const framePath = path.join(os.tmpdir(), `remote-terminal-screen-${process.pid}.jpg`);
process.on('exit', () => fs.rmSync(framePath, { force: true }));

// Main display size in points — the coordinate space cliclick uses.
// screencapture saves at backing-pixel resolution (2x on Retina), so frames
// are scaled down to this width; then frame pixels == click coordinates.
let pointWidth = null;

function queryPointWidth(callback) {
  execFile(
    'osascript',
    ['-l', 'JavaScript', '-e', 'ObjC.import("AppKit"); $.NSScreen.mainScreen.frame.size.width'],
    (err, stdout) => {
      const width = Math.round(Number(stdout));
      callback(!err && width > 0 ? width : null);
    }
  );
}

// Re-read on every stream start so a resolution change is picked up.
function refreshScreenInfo() {
  pointWidth = null;
  queryPointWidth((width) => { pointWidth = width; });
}

function captureFrame(callback) {
  execFile('screencapture', ['-x', '-t', 'jpg', framePath], (err) => {
    if (err) return callback(err);
    const sipsArgs = ['-s', 'formatOptions', String(JPEG_QUALITY), framePath];
    if (pointWidth) sipsArgs.unshift('--resampleWidth', String(pointWidth));
    execFile('sips', sipsArgs, (sipsErr) => {
      if (sipsErr) return callback(sipsErr);
      fs.readFile(framePath, callback);
    });
  });
}

// Minimal JPEG dimension reader: walks the marker segments to the first
// start-of-frame (SOF0..SOF15, excluding DHT/JPG/DAC which share the range).
function jpegDimensions(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) { // fill byte
      i++;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

// cliclick invocations run strictly one at a time, so a quick click-then-type
// can't be reordered by two child processes racing each other.
let inputQueue = Promise.resolve();
let onInputError = null;

function runCliclick(args) {
  inputQueue = inputQueue.then(() => new Promise((resolve) => {
    execFile(CLICLICK, args, (err) => {
      if (err && onInputError) onInputError(err);
      resolve();
    });
  }));
}

const KEY_MAP = {
  enter: 'return',
  return: 'return',
  tab: 'tab',
  esc: 'esc',
  escape: 'esc',
  backspace: 'delete',
  delete: 'delete',
  up: 'arrow-up',
  down: 'arrow-down',
  left: 'arrow-left',
  right: 'arrow-right',
  space: 'space',
};

// cliclick coordinates: non-negative integers (negatives would need a "="
// prefix, and nothing on the main display is negative anyway).
function coord(n) {
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function performInput(action) {
  const x = coord(action.x);
  const y = coord(action.y);
  const hasPoint = x !== null && y !== null;
  switch (action.action) {
    case 'move':
      if (hasPoint) runCliclick([`m:${x},${y}`]);
      break;
    case 'click':
      if (hasPoint) runCliclick([`c:${x},${y}`]);
      break;
    case 'rightclick':
      if (hasPoint) runCliclick([`rc:${x},${y}`]);
      break;
    case 'doubleclick':
      if (hasPoint) runCliclick([`dc:${x},${y}`]);
      break;
    case 'drag': {
      const toX = coord(action.toX);
      const toY = coord(action.toY);
      if (hasPoint && toX !== null && toY !== null) {
        // dm: in between so apps see an actual drag, not a teleport.
        runCliclick([`dd:${x},${y}`, `dm:${toX},${toY}`, `du:${toX},${toY}`]);
      }
      break;
    }
    case 'type':
      if (typeof action.text === 'string' && action.text.length > 0) {
        runCliclick([`t:${action.text}`]);
      }
      break;
    case 'key': {
      const key = KEY_MAP[String(action.key).toLowerCase()];
      if (key) runCliclick([`kp:${key}`]);
      break;
    }
    default:
      break;
  }
}

function setInputErrorHandler(handler) {
  onInputError = handler;
}

module.exports = {
  captureFrame,
  jpegDimensions,
  performInput,
  refreshScreenInfo,
  setInputErrorHandler,
  FRAME_INTERVAL_MS,
};
