import { useCallback, useEffect, useRef, useState } from 'react';

type FileItem = { name: string; size: number; time: number };

const IMG = /\.(png|jpe?g|gif|webp|bmp|heic|avif)$/i;
const AUDIO = /\.(mp3|m4a|wav|ogg|aac|flac)$/i;
const VIDEO = /\.(mp4|mov|webm|m4v)$/i;

const fmtSize = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.ceil(b / 1e3))} KB`;

const fmtTime = (t: number) =>
  new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function App() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [over, setOver] = useState(false);
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/files');
      setFiles(await r.json());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  const upload = (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (!arr.length) return;
    const fd = new FormData();
    arr.forEach((f) => fd.append('files', f));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    setStatus(`Uploading ${arr.length} file${arr.length > 1 ? 's' : ''}...`);
    setProgress(0);
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress((e.loaded / e.total) * 100);
    xhr.onload = () => {
      setProgress(null);
      setStatus(xhr.status === 200 ? 'Done' : 'Upload failed');
      if (input.current) input.current.value = '';
      load();
      setTimeout(() => setStatus(''), 2500);
    };
    xhr.onerror = () => {
      setProgress(null);
      setStatus('Upload failed: server unreachable');
    };
    xhr.send(fd);
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    await fetch(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' });
    load();
  };

  const enc = encodeURIComponent;
  const total = files.reduce((s, f) => s + f.size, 0);

  return (
    <div className="mx-auto max-w-3xl p-3 pb-[env(safe-area-inset-bottom)] font-sans text-sm text-neutral-900">
      <header className="flex items-baseline justify-between border-b border-neutral-300 pb-2">
        <h1 className="text-base font-semibold">LAN Share</h1>
        <span className={offline ? 'text-red-600' : 'text-neutral-500'}>
          {offline ? 'server unreachable' : `${files.length} files · ${fmtSize(total)}`}
        </span>
      </header>

      <div
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
        className={`mt-3 cursor-pointer border border-dashed px-4 py-6 text-center ${over ? 'border-neutral-900 bg-neutral-100' : 'border-neutral-400'}`}
      >
        Tap to choose files, or drop them here
        <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>

      {(progress !== null || status) && (
        <div className="mt-2">
          {progress !== null && (
            <div className="h-1.5 w-full bg-neutral-200">
              <div className="h-full bg-neutral-900 transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          )}
          <div className="mt-1 text-neutral-600">
            {status}{progress !== null && ` ${Math.round(progress)}%`}
          </div>
        </div>
      )}

      <ul className="mt-3 divide-y divide-neutral-200 border-y border-neutral-200">
        {files.length === 0 && <li className="py-6 text-center text-neutral-500">No files yet</li>}
        {files.map((f) => {
          const isImg = IMG.test(f.name), isAudio = AUDIO.test(f.name), isVideo = VIDEO.test(f.name);
          const expanded = open === f.name;
          return (
            <li key={f.name} className="py-2">
              <div className="flex items-center gap-2">
                {isImg ? (
                  <img src={`/raw/${enc(f.name)}`} loading="lazy" alt="" className="h-10 w-10 shrink-0 object-cover" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-neutral-100 text-[10px] uppercase text-neutral-500">
                    {f.name.split('.').pop()?.slice(0, 4)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <a href={`/files/${enc(f.name)}`} className="block truncate underline-offset-2 hover:underline">{f.name}</a>
                  <div className="text-xs text-neutral-500">{fmtSize(f.size)} · {fmtTime(f.time)}</div>
                </div>
                {(isAudio || isVideo) && (
                  <button className="border border-neutral-300 px-2 py-1" onClick={() => setOpen(expanded ? null : f.name)}>
                    {expanded ? 'Close' : 'Play'}
                  </button>
                )}
                <button className="border border-neutral-300 px-2 py-1 text-red-700" onClick={() => remove(f.name)}>Delete</button>
              </div>
              {expanded && isAudio && <audio className="mt-2 w-full" controls autoPlay src={`/raw/${enc(f.name)}`} />}
              {expanded && isVideo && <video className="mt-2 w-full" controls autoPlay playsInline src={`/raw/${enc(f.name)}`} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
