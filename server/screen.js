// Screen capture + mouse/keyboard injection for the laptop's real desktop.
// Deliberately built on two well-tested macOS CLI tools instead of writing
// custom native capture/injection code: `screencapture` (built into macOS)
// for frames, and `cliclick` (brew install cliclick) for input.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FRAME_INTERVAL_MS = 400; // ~2.5 fps, enough to see and click around

function findCliclick() {
  for (const candidate of ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'cliclick'; // fall back to PATH lookup
}

const CLICLICK = findCliclick();
const framePath = path.join(os.tmpdir(), `remote-terminal-screen-${process.pid}.jpg`);

function captureFrame(callback) {
  execFile('screencapture', ['-x', '-t', 'jpg', framePath], (err) => {
    if (err) return callback(err);
    fs.readFile(framePath, callback);
  });
}

// Minimal JPEG dimension reader: scans for the SOF0/SOF2 marker.
function jpegDimensions(buf) {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function runCliclick(args) {
  execFile(CLICLICK, args, () => {});
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

function performInput(action) {
  const x = Math.round(action.x);
  const y = Math.round(action.y);
  switch (action.action) {
    case 'move':
      runCliclick([`m:${x},${y}`]);
      break;
    case 'click':
      runCliclick([`c:${x},${y}`]);
      break;
    case 'rightclick':
      runCliclick([`rc:${x},${y}`]);
      break;
    case 'doubleclick':
      runCliclick([`dc:${x},${y}`]);
      break;
    case 'drag':
      runCliclick([`dd:${x},${y}`, `du:${Math.round(action.toX)},${Math.round(action.toY)}`]);
      break;
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

module.exports = { captureFrame, jpegDimensions, performInput, FRAME_INTERVAL_MS };
