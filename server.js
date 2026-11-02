import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.join(__dirname, 'uploads');
const DIST = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 3000;
fs.mkdirSync(UPLOADS, { recursive: true });

const safe = (n) => path.join(UPLOADS, path.basename(n));

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

app.get('/api/files', (req, res) => {
  const files = fs.readdirSync(UPLOADS)
    .map((name) => {
      const s = fs.statSync(path.join(UPLOADS, name));
      return { name, size: s.size, time: s.mtimeMs };
    })
    .sort((a, b) => b.time - a.time);
  res.json(files);
});

app.post('/api/upload', upload.array('files'), (req, res) => {
  res.json({ ok: true, count: req.files.length });
});

app.delete('/api/files/:name', (req, res) => {
  fs.unlink(safe(req.params.name), (err) => res.status(err ? 404 : 200).json({ ok: !err }));
});

// force download
app.get('/files/:name', (req, res) => res.download(safe(req.params.name)));
// inline (thumbnails, audio/video playback with range support)
app.get('/raw/:name', (req, res) => res.sendFile(safe(req.params.name)));

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
