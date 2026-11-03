import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.join(__dirname, 'uploads');
const STATE_FILE = path.join(UPLOADS, '.lan-share-state.json');
const DIST = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 3000;
fs.mkdirSync(UPLOADS, { recursive: true });

const safe = (n) => path.join(UPLOADS, path.basename(n));
const storedFile = (name) => {
  if (typeof name !== 'string' || !name || name !== path.basename(name) || name.startsWith('.')) return false;
  try {
    return fs.statSync(safe(name)).isFile();
  } catch {
    return false;
  }
};

const readState = () => {
  try {
    const value = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      devices: Array.isArray(value.devices) ? value.devices : [],
      files: value.files && typeof value.files === 'object' ? value.files : {},
    };
  } catch {
    return { devices: [], files: {} };
  }
};
const state = readState();
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const tokenMatches = (a, b) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const storage = multer.diskStorage({
  destination: UPLOADS,
  filename: (req, file, cb) => {
    const { name, ext } = path.parse(path.basename(file.originalname));
    let final = name + ext;
    let i = 1;
    while (fs.existsSync(path.join(UPLOADS, final))) final = `${name} (${i++})${ext}`;
    cb(null, final);
  },
});
const upload = multer({ storage }); // no size limit, streams to disk

const app = express();
app.use(express.json({ limit: '10kb' }));

function sessionToken(req) {
  const cookies = (req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== 'lan_share_session') continue;
    try {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function requireDevice(req, res, next) {
  const token = sessionToken(req);
  if (!token) return res.status(401).json({ error: 'Register this device first' });
  const tokenHash = hashToken(token);
  const device = state.devices.find((item) => tokenMatches(item.tokenHash, tokenHash));
  if (!device) return res.status(401).json({ error: 'Device session expired' });
  device.lastSeen = Date.now();
  req.device = device;
  next();
}

const canSee = (name, deviceId) => {
  const sharing = state.files[name];
  // Files uploaded before device sharing was added stay available to the whole LAN.
  if (!sharing || sharing.recipients === null) return true;
  return sharing.ownerId === deviceId || sharing.recipients.includes(deviceId);
};

app.post('/api/devices/register', (req, res) => {
  const { id, token } = req.body || {};
  const deviceId = typeof id === 'string' ? id : '';
  const deviceToken = typeof token === 'string' ? token : '';
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(deviceId) || !/^[A-Fa-f0-9]{32,128}$/.test(deviceToken)) {
    return res.status(400).json({ error: 'Invalid device identity' });
  }

  const tokenHash = hashToken(deviceToken);
  let device = state.devices.find((item) => item.id === deviceId);
  if (device && !tokenMatches(device.tokenHash, tokenHash)) {
    return res.status(401).json({ error: 'This device identity is already registered' });
  }
  if (!device) {
    if (state.devices.some((item) => tokenMatches(item.tokenHash, tokenHash))) {
      return res.status(409).json({ error: 'This device token is already in use' });
    }
    device = { id: deviceId, tokenHash, name: 'My device', lastSeen: Date.now() };
    state.devices.push(device);
  }

  const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 40) : '';
  device.name = name || 'My device';
  device.lastSeen = Date.now();
  saveState();

  res.setHeader(
    'Set-Cookie',
    `lan_share_session=${encodeURIComponent(deviceToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
  );
  res.json({ id: device.id, name: device.name });
});

app.post('/api/devices/heartbeat', requireDevice, (_req, res) => res.json({ ok: true }));

app.get('/api/devices', requireDevice, (req, res) => {
  const now = Date.now();
  res.json(state.devices.map(({ id, name, lastSeen }) => ({
    id,
    name,
    online: now - lastSeen < 30_000,
    self: id === req.device.id,
  })));
});

app.get('/api/files', requireDevice, (req, res) => {
  const files = fs.readdirSync(UPLOADS)
    .filter((name) => storedFile(name) && canSee(name, req.device.id))
    .map((name) => {
      const s = fs.statSync(path.join(UPLOADS, name));
      const sharing = state.files[name];
      return {
        name,
        size: s.size,
        time: s.mtimeMs,
        ownerId: sharing?.ownerId ?? null,
        recipients: sharing?.recipients ?? null,
      };
    })
    .sort((a, b) => b.time - a.time);
  res.json(files);
});

app.post('/api/upload', requireDevice, upload.array('files'), (req, res) => {
  const visibility = req.body.visibility === 'selected' ? 'selected' : 'all';
  let recipients = null;
  if (visibility === 'selected') {
    try {
      const parsed = JSON.parse(req.body.recipients || '[]');
      if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) throw new Error();
      recipients = [...new Set(parsed)];
    } catch {
      for (const file of req.files) fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'Invalid recipient list' });
    }

    const knownDevices = new Set(state.devices.map((device) => device.id));
    if (recipients.some((id) => !knownDevices.has(id))) {
      for (const file of req.files) fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'A selected device is no longer registered' });
    }
    recipients = recipients.filter((id) => id !== req.device.id);
  }

  for (const file of req.files) {
    state.files[file.filename] = { ownerId: req.device.id, recipients };
  }
  if (req.files.length) saveState();
  res.json({ ok: true, count: req.files.length });
});

app.delete('/api/files/:name', requireDevice, (req, res) => {
  const name = req.params.name;
  if (!storedFile(name)) return res.status(404).json({ error: 'File not found' });
  const sharing = state.files[name];
  if (sharing && sharing.ownerId !== req.device.id) return res.status(403).json({ error: 'Only the uploader can delete this file' });

  fs.unlink(safe(name), (err) => {
    if (err) return res.status(404).json({ error: 'File not found' });
    delete state.files[name];
    saveState();
    res.json({ ok: true });
  });
});

function streamFile(req, res, name, attachment) {
  const filePath = safe(name);
  const size = fs.statSync(filePath).size;
  let start = 0;
  let end = size - 1;
  const range = req.headers.range;

  if (size === 0) {
    if (range) {
      res.setHeader('Content-Range', 'bytes */0');
      return res.status(416).end();
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', 0);
    if (attachment) res.attachment(name);
    else res.type(name);
    return res.end();
  }

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      start = Math.max(size - suffixLength, 0);
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : end;
    }
    end = Math.min(end, size - 1);
    if (start >= size || start > end) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', end - start + 1);
  if (attachment) res.attachment(name);
  else res.type(name);

  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).end();
    else res.destroy();
  });
  stream.pipe(res);
}

app.get('/files/:name', requireDevice, (req, res) => {
  const name = req.params.name;
  if (!storedFile(name) || !canSee(name, req.device.id)) return res.status(404).send('File not found');
  streamFile(req, res, name, true);
});
app.get('/raw/:name', requireDevice, (req, res) => {
  const name = req.params.name;
  if (!storedFile(name) || !canSee(name, req.device.id)) return res.status(404).send('File not found');
  streamFile(req, res, name, false);
});

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('\nOpen on any device connected to the same Wi-Fi:');
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list ?? [])
      if (i.family === 'IPv4' && !i.internal) console.log(`  http://${i.address}:${PORT}`);
  console.log(fs.existsSync(DIST) ? '' : '\n(no dist/ build found: run "npm run build" for the production UI)\n');
});
