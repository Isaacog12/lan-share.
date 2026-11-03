import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = process.env.LAN_SHARE_UPLOAD_DIR
  ? path.resolve(process.env.LAN_SHARE_UPLOAD_DIR)
  : path.join(__dirname, 'uploads');
const DATA_DIR = process.env.LAN_SHARE_DATA_DIR
  ? path.resolve(process.env.LAN_SHARE_DATA_DIR)
  : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'lan-share.json');
const DIST = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 3000;
const SESSION_AGE = 14 * 24 * 60 * 60 * 1000;
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const safe = (name) => path.join(UPLOADS, path.basename(name));
const visibleName = (name) => typeof name === 'string' && name && name === path.basename(name) && !name.startsWith('.');
const freshStore = () => ({ users: [], sessions: [], folders: [], files: [], legacyImported: false });

function loadStore() {
  if (!fs.existsSync(DB_FILE)) return freshStore();
  const value = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  return {
    users: Array.isArray(value.users) ? value.users : [],
    sessions: Array.isArray(value.sessions) ? value.sessions : [],
    folders: Array.isArray(value.folders) ? value.folders : [],
    files: Array.isArray(value.files) ? value.files : [],
    legacyImported: Boolean(value.legacyImported),
  };
}

let store;
try {
  store = loadStore();
} catch (error) {
  console.error(`Could not read ${DB_FILE}; refusing to overwrite the local account database.`, error);
  process.exit(1);
}

function saveStore() {
  const temporary = `${DB_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, DB_FILE);
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const randomId = () => crypto.randomUUID();
const userFor = (id) => store.users.find((user) => user.id === id);
const findFolder = (id) => store.folders.find((folder) => folder.id === id);
const findFile = (name) => store.files.find((file) => file.name === name);
const canAccessFolder = (folder, userId) =>
  Boolean(folder && (folder.ownerId === userId || folder.members.includes(userId)));

function importOldUploads(ownerId) {
  const oldStatePath = path.join(UPLOADS, '.lan-share-state.json');
  let names = [];
  try {
    names = fs.readdirSync(UPLOADS).filter((name) => {
      if (!visibleName(name)) return false;
      try { return fs.statSync(safe(name)).isFile() && !findFile(name); } catch { return false; }
    });
  } catch {}

  const folder = {
    id: randomId(),
    name: 'Previous uploads',
    ownerId,
    members: [],
    createdAt: Date.now(),
    legacy: true,
  };

  if (names.length) {
    store.folders.push(folder);
    for (const name of names) {
      const stat = fs.statSync(safe(name));
      store.files.push({ name, folderId: folder.id, size: stat.size, time: stat.mtimeMs, uploadedBy: ownerId });
    }
  }
  store.legacyImported = true;
  if (fs.existsSync(oldStatePath)) console.log('Imported existing uploads into the first account’s private folder.');
}

function sessionToken(req) {
  for (const cookie of (req.headers.cookie || '').split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== 'lan_share_session') continue;
    try { return decodeURIComponent(cookie.slice(separator + 1).trim()); } catch { return ''; }
  }
  return '';
}

function currentUser(req) {
  const token = sessionToken(req);
  if (!token) return null;
  const digest = hashToken(token);
  const session = store.sessions.find((item) => item.tokenHash === digest && item.expiresAt > Date.now());
  return session ? userFor(session.userId) || null : null;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to continue' });
  req.user = user;
  next();
}

function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  store.sessions = store.sessions.filter((item) => item.expiresAt > now);
  store.sessions.push({ tokenHash: hashToken(token), userId, expiresAt: now + SESSION_AGE });
  saveStore();
  res.setHeader(
    'Set-Cookie',
    `lan_share_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_AGE / 1000}`,
  );
}

function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName };
}

function parseMembers(value, ownerId) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) return null;
  const ids = [...new Set(value)].filter((id) => id !== ownerId);
  return ids.every((id) => userFor(id)) ? ids : null;
}

function fileCanBeRead(file, userId) {
  const folder = findFolder(file.folderId);
  return canAccessFolder(folder, userId);
}

function streamFile(req, res, name, attachment) {
  const filePath = safe(name);
  let size;
  try { size = fs.statSync(filePath).size; } catch { return res.status(404).send('File not found'); }
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
    if (!match[1]) start = Math.max(size - Number(match[2]), 0);
    else {
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

const storage = multer.diskStorage({
  destination: UPLOADS,
  filename: (_req, file, callback) => {
    const safeOriginal = path.basename(file.originalname).replace(/[<>:"|?*\u0000-\u001f\u007f]/g, '_').slice(0, 180) || 'file';
    const parsed = path.parse(safeOriginal);
    const base = parsed.name.startsWith('.') ? `file${parsed.name}` : (parsed.name || 'file');
    const ext = parsed.ext;
    let finalName = `${base}${ext}`;
    let suffix = 1;
    while (fs.existsSync(safe(finalName))) finalName = `${base} (${suffix++})${ext}`;
    callback(null, finalName);
  },
});
const upload = multer({ storage });
const app = express();
app.use(express.json({ limit: '32kb' }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.post('/api/auth/register', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim().slice(0, 40) : '';
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–32 letters, numbers, dots, dashes, or underscores.' });
  }
  if (password.length < 8 || password.length > 256) return res.status(400).json({ error: 'Use a password between 8 and 256 characters.' });
  if (store.users.some((user) => user.username === username)) return res.status(409).json({ error: 'That username is already taken.' });

  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: randomId(),
    username,
    displayName: displayName || username,
    salt,
    passwordHash: crypto.scryptSync(password, salt, 64).toString('hex'),
    createdAt: Date.now(),
  };
  const firstUser = store.users.length === 0;
  store.users.push(user);
  if (firstUser && !store.legacyImported) importOldUploads(user.id);
  setSession(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const user = store.users.find((item) => item.username === username);
  const salt = user?.salt || 'lan-share-unknown-user';
  const expected = user?.passwordHash || Buffer.alloc(64).toString('hex');
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const valid = user && expectedBuffer.length === actual.length && crypto.timingSafeEqual(expectedBuffer, actual);
  if (!valid) return res.status(401).json({ error: 'Username or password is incorrect.' });
  setSession(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = sessionToken(req);
  if (token) store.sessions = store.sessions.filter((session) => session.tokenHash !== hashToken(token));
  saveStore();
  res.setHeader('Set-Cookie', 'lan_share_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/auth/session', (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

app.get('/api/users', requireAuth, (req, res) => {
  res.json(store.users
    .filter((user) => user.id !== req.user.id)
    .map((user) => publicUser(user))
    .sort((a, b) => a.username.localeCompare(b.username)));
});

app.get('/api/folders', requireAuth, (req, res) => {
  const folders = store.folders
    .filter((folder) => canAccessFolder(folder, req.user.id))
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      ownerId: folder.ownerId,
      ownerName: userFor(folder.ownerId)?.displayName || userFor(folder.ownerId)?.username || 'You',
      canManage: folder.ownerId === req.user.id,
      legacy: Boolean(folder.legacy),
      members: folder.members.map((id) => userFor(id)?.username).filter(Boolean),
      memberIds: folder.ownerId === req.user.id ? folder.members : undefined,
      fileCount: store.files.filter((file) => file.folderId === folder.id).length,
    }))
    .sort((a, b) => Number(a.legacy) - Number(b.legacy) || b.fileCount - a.fileCount || a.name.localeCompare(b.name));
  res.json(folders);
});

app.post('/api/folders', requireAuth, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
  const members = parseMembers(req.body?.members ?? [], req.user.id);
  if (!name) return res.status(400).json({ error: 'Give the folder a name.' });
  if (!members) return res.status(400).json({ error: 'One or more selected accounts could not be found.' });

  const folder = { id: randomId(), name, ownerId: req.user.id, members, createdAt: Date.now(), legacy: false };
  store.folders.push(folder);
  saveStore();
  res.status(201).json({ id: folder.id, name: folder.name });
});

app.patch('/api/folders/:id', requireAuth, (req, res) => {
  const folder = findFolder(req.params.id);
  if (!folder || folder.legacy) return res.status(404).json({ error: 'Folder not found.' });
  if (folder.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the folder owner can change access.' });

  if (req.body?.name !== undefined) {
    const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
    if (!name) return res.status(400).json({ error: 'Give the folder a name.' });
    folder.name = name;
  }
  if (req.body?.members !== undefined) {
    const members = parseMembers(req.body.members, req.user.id);
    if (!members) return res.status(400).json({ error: 'One or more selected accounts could not be found.' });
    folder.members = members;
  }
  saveStore();
  res.json({ ok: true });
});

app.delete('/api/folders/:id', requireAuth, (req, res) => {
  const folder = findFolder(req.params.id);
  if (!folder || folder.legacy) return res.status(404).json({ error: 'Folder not found.' });
  if (folder.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the folder owner can delete it.' });
  const folderFiles = store.files.filter((file) => file.folderId === folder.id);
  for (const file of folderFiles) {
    try { fs.unlinkSync(safe(file.name)); } catch (error) { if (error.code !== 'ENOENT') return res.status(500).json({ error: 'Could not remove folder files.' }); }
  }
  store.files = store.files.filter((file) => file.folderId !== folder.id);
  store.folders = store.folders.filter((item) => item.id !== folder.id);
  saveStore();
  res.json({ ok: true });
});

function requireFolderAccess(req, res, next) {
  const folder = findFolder(req.params.id);
  if (!folder || !canAccessFolder(folder, req.user.id)) return res.status(404).json({ error: 'Folder not found.' });
  req.folder = folder;
  next();
}

app.get('/api/folders/:id/files', requireAuth, requireFolderAccess, (req, res) => {
  const files = store.files
    .filter((file) => file.folderId === req.folder.id)
    .sort((a, b) => b.time - a.time)
    .map((file) => ({
      name: file.name,
      size: file.size,
      time: file.time,
      uploadedBy: userFor(file.uploadedBy)?.displayName || userFor(file.uploadedBy)?.username || 'Previous upload',
      canDelete: req.folder.ownerId === req.user.id || file.uploadedBy === req.user.id,
    }));
  res.json(files);
});

app.post('/api/folders/:id/files', requireAuth, requireFolderAccess, upload.array('files'), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'Choose at least one file.' });
  const files = req.files.map((file) => ({
    name: file.filename,
    folderId: req.folder.id,
    size: file.size,
    time: Date.now(),
    uploadedBy: req.user.id,
  }));
  store.files.push(...files);
  try {
    saveStore();
  } catch {
    store.files = store.files.filter((item) => !files.some((added) => added.name === item.name));
    for (const file of req.files) {
      try { fs.unlinkSync(file.path); } catch {}
    }
    return res.status(500).json({ error: 'Could not save file information.' });
  }
  res.json({ ok: true, count: files.length });
});

app.delete('/api/files/:name', requireAuth, (req, res) => {
  const name = req.params.name;
  const file = findFile(name);
  const folder = file && findFolder(file.folderId);
  if (!visibleName(name) || !file || !folder || !canAccessFolder(folder, req.user.id)) {
    return res.status(404).json({ error: 'File not found.' });
  }
  if (folder.ownerId !== req.user.id && file.uploadedBy !== req.user.id) {
    return res.status(403).json({ error: 'Only the uploader or folder owner can delete this file.' });
  }
  try { fs.unlinkSync(safe(name)); } catch (error) { if (error.code !== 'ENOENT') return res.status(500).json({ error: 'Could not delete file.' }); }
  store.files = store.files.filter((item) => item.name !== name);
  saveStore();
  res.json({ ok: true });
});

app.get('/files/:name', requireAuth, (req, res) => {
  const file = findFile(req.params.name);
  if (!file || !visibleName(file.name) || !fileCanBeRead(file, req.user.id)) return res.status(404).send('File not found.');
  streamFile(req, res, file.name, true);
});
app.get('/raw/:name', requireAuth, (req, res) => {
  const file = findFile(req.params.name);
  if (!file || !visibleName(file.name) || !fileCanBeRead(file, req.user.id)) return res.status(404).send('File not found.');
  streamFile(req, res, file.name, false);
});

if (fs.existsSync(DIST)) app.use(express.static(DIST));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'The request could not be completed.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('\nOpen LAN Share on any device connected to the same Wi-Fi:');
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) console.log(`  http://${info.address}:${PORT}`);
    }
  }
  console.log(`\nLocal account data: ${DB_FILE}`);
});
