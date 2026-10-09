const { app, BrowserWindow, desktopCapturer } = require('electron');
const path = require('node:path');

const probe = process.argv[2] || 'screens-no-thumbnails';

const optionsByProbe = {
  'screens-no-thumbnails': {
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  },
  'screens-with-thumbnails': {
    types: ['screen'],
    thumbnailSize: { width: 320, height: 180 }
  },
  'windows-no-thumbnails': {
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false
  },
  'windows-with-thumbnails': {
    types: ['window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false
  },
  'windows-with-icons': {
    types: ['window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  },
  'serialize-thumbnails': {
    types: ['window', 'screen'],
    thumbnailSize: { width: 360, height: 220 },
    fetchWindowIcons: false
  },
  'serialize-icons': {
    types: ['window', 'screen'],
    thumbnailSize: { width: 360, height: 220 },
    fetchWindowIcons: true
  },
  'with-app-window': {
    types: ['window', 'screen'],
    thumbnailSize: { width: 360, height: 220 },
    fetchWindowIcons: true
  }
};

app.whenReady().then(async () => {
  try {
    const options = optionsByProbe[probe];
    if (!options) throw new Error(`Unknown probe: ${probe}`);
    let probeWindow;
    if (probe === 'with-app-window') {
      probeWindow = new BrowserWindow({ width: 520, height: 820, show: true, alwaysOnTop: true });
      await probeWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    }
    const sources = await desktopCapturer.getSources(options);
    const serializedLengths = (probe.startsWith('serialize-') || probe === 'with-app-window')
      ? sources.map((source) => ({
          thumbnail: source.thumbnail.toDataURL().length,
          icon: probe === 'serialize-icons' && source.appIcon
            ? source.appIcon.toDataURL().length
            : 0
        }))
      : [];
    process.stdout.write(JSON.stringify({ probe, ok: true, count: sources.length, serializedLengths }));
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    app.exit(1);
  }
});
