import { useCallback, useEffect, useRef, useState } from 'react';

type FileItem = {
  name: string;
  size: number;
  time: number;
  ownerId: string | null;
  recipients: string[] | null;
};
type Device = { id: string; name: string; online: boolean; self: boolean };
type Identity = { id: string; token: string; name: string };

const IMG = /\.(png|jpe?g|gif|webp|bmp|heic|avif)$/i;
const AUDIO = /\.(mp3|m4a|wav|ogg|aac|flac)$/i;
const VIDEO = /\.(mp4|mov|webm|m4v)$/i;

const makeRandomHex = (length: number) => {
  const bytes = new Uint8Array(length);
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const getIdentity = (): Identity => {
  try {
    const id = localStorage.getItem('lan-share-device-id');
    const token = localStorage.getItem('lan-share-device-token');
    const name = localStorage.getItem('lan-share-device-name');
    if (id && token) return { id, token, name: name || 'My device' };
  } catch {
    // Continue with a session-only identity if browser storage is unavailable.
  }

  const identity = { id: `device_${makeRandomHex(16)}`, token: makeRandomHex(32), name: 'My device' };
  try {
    localStorage.setItem('lan-share-device-id', identity.id);
    localStorage.setItem('lan-share-device-token', identity.token);
    localStorage.setItem('lan-share-device-name', identity.name);
  } catch {
    // The in-memory identity still works until this page is closed.
  }
  return identity;
};

const fmtSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const fmtTime = (t: number) =>
  new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function App() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'selected'>('all');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [over, setOver] = useState(false);
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [ready, setReady] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIdentity(getIdentity());
  }, []);

  useEffect(() => {
    setDeviceName(identity?.name ?? '');
  }, [identity?.name]);

  useEffect(() => {
    if (!identity) return;

    let active = true;
    let connected = false;
    let refreshing = false;

    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const [fileResponse, deviceResponse] = await Promise.all([
          fetch('/api/files'),
          fetch('/api/devices'),
        ]);
        if (!fileResponse.ok || !deviceResponse.ok) throw new Error('Unable to load shared devices');
        const [nextFiles, nextDevices] = await Promise.all([fileResponse.json(), deviceResponse.json()]);
        if (active) {
          setFiles(nextFiles);
          setDevices(nextDevices);
          setOffline(false);
          setReady(true);
        }
      } catch {
        if (active) {
          setOffline(true);
          setReady(true);
        }
      } finally {
        refreshing = false;
      }
    };

    const register = async () => {
      try {
        const response = await fetch('/api/devices/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(identity),
        });
        if (!response.ok) throw new Error('Unable to connect this device');
        if (!active) return;
        connected = true;
        await refresh();
      } catch {
        if (active) {
          setOffline(true);
          setReady(true);
        }
      }
    };

    register();
    const interval = window.setInterval(async () => {
      if (!connected) return;
      try {
        const response = await fetch('/api/devices/heartbeat', { method: 'POST' });
        if (!response.ok) throw new Error('Device disconnected');
        await refresh();
      } catch {
        if (active) setOffline(true);
      }
    }, 7000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [identity]);

  const upload = (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (!arr.length || !identity) return;
    const fd = new FormData();
    fd.append('visibility', visibility);
    fd.append('recipients', JSON.stringify(selectedRecipients));
    arr.forEach((f) => fd.append('files', f));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    setStatus(`Uploading ${arr.length} file${arr.length > 1 ? 's' : ''}...`);
    setProgress(0);
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress((e.loaded / e.total) * 100);
    xhr.onload = () => {
      setProgress(null);
      setStatus(xhr.status === 200 ? `Uploaded ${arr.length} file${arr.length === 1 ? '' : 's'}` : 'Upload failed');
      if (input.current) input.current.value = '';
      if (xhr.status === 200) {
        fetch('/api/files')
          .then((response) => response.json())
          .then((nextFiles) => setFiles(nextFiles))
          .catch(() => setOffline(true));
      }
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
    const response = await fetch(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (response.ok) {
      setFiles((current) => current.filter((file) => file.name !== name));
      setStatus('File deleted');
      setTimeout(() => setStatus(''), 2000);
    } else {
      setStatus('Could not delete this file');
    }
  };

  const saveDeviceName = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identity) return;
    const name = deviceName.trim().slice(0, 40) || 'My device';
    const updated = { ...identity, name };
    try {
      localStorage.setItem('lan-share-device-name', name);
    } catch {
      // The updated name still applies to this page.
    }
    setIdentity(updated);
    setDeviceName(name);
  };

  const toggleRecipient = (id: string) => {
    setSelectedRecipients((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const enc = encodeURIComponent;
  const total = files.reduce((s, f) => s + f.size, 0);
  const peersOnline = devices.filter((device) => !device.self && device.online).length;
  const filteredFiles = files.filter((file) => file.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="LAN Share home">
          <span className="brand-mark" aria-hidden="true">↗</span>
          <span>LAN Share</span>
        </a>
        <div className={`connection-pill ${offline ? 'is-offline' : ''}`}>
          <span className="connection-dot" />
          {offline ? 'Reconnecting…' : ready ? `${peersOnline} ${peersOnline === 1 ? 'device' : 'devices'} nearby` : 'Connecting…'}
        </div>
      </header>

      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">YOUR PRIVATE LOCAL NETWORK</p>
            <h1>Files, right where you need them.</h1>
            <p className="intro-copy">Send files between devices on the same Wi-Fi. No accounts, no cloud, no waiting.</p>
          </div>
          <div className="network-card">
            <span className="network-icon" aria-hidden="true">⌁</span>
            <div>
              <strong>{offline ? 'Server unavailable' : 'Local sharing is on'}</strong>
              <span>{offline ? 'Check that your computer is running LAN Share.' : 'Only devices on this network can connect.'}</span>
            </div>
          </div>
        </section>

        <section className="workspace">
          <div className="main-column">
            <section className="panel upload-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">SEND A FILE</p>
                  <h2>Choose who can see it</h2>
                </div>
                <span className="step-number">01</span>
              </div>

              <div className="audience-options" role="radiogroup" aria-label="Who can see your uploads?">
                <label className={`audience-option ${visibility === 'all' ? 'is-selected' : ''}`}>
                  <input type="radio" name="visibility" value="all" checked={visibility === 'all'} onChange={() => setVisibility('all')} />
                  <span className="radio-mark" />
                  <span className="audience-text">
                    <strong>Everyone connected</strong>
                    <small>Any device on this Wi-Fi can see the upload</small>
                  </span>
                </label>
                <label className={`audience-option ${visibility === 'selected' ? 'is-selected' : ''}`}>
                  <input type="radio" name="visibility" value="selected" checked={visibility === 'selected'} onChange={() => setVisibility('selected')} />
                  <span className="radio-mark" />
                  <span className="audience-text">
                    <strong>Choose devices</strong>
                    <small>Only you and the devices you select</small>
                  </span>
                </label>
              </div>

              {visibility === 'selected' && (
                <div className="device-picker">
                  {devices.filter((device) => !device.self).length === 0 ? (
                    <p className="empty-devices">No other devices yet. Open this page on another device using the same Wi-Fi.</p>
                  ) : (
                    devices.filter((device) => !device.self).map((device) => (
                      <label className="device-choice" key={device.id}>
                        <input
                          type="checkbox"
                          checked={selectedRecipients.includes(device.id)}
                          onChange={() => toggleRecipient(device.id)}
                        />
                        <span className="device-avatar" aria-hidden="true">{device.name.slice(0, 1).toUpperCase()}</span>
                        <span className="device-choice-name">
                          <strong>{device.name}</strong>
                          <small className={device.online ? 'device-online' : ''}>{device.online ? 'Online now' : 'Offline'}</small>
                        </span>
                        <span className="checkbox-mark" />
                      </label>
                    ))
                  )}
                  <p className="selection-note">
                    {selectedRecipients.length
                      ? `Selected ${selectedRecipients.length} device${selectedRecipients.length === 1 ? '' : 's'}`
                      : 'No devices selected — only you will see this upload'}
                  </p>
                </div>
              )}

              <div
                className={`dropzone ${over ? 'is-over' : ''}`}
                onDragOver={(event) => { event.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(event) => { event.preventDefault(); setOver(false); upload(event.dataTransfer.files); }}
              >
                <input
                  ref={input}
                  className="file-input"
                  type="file"
                  multiple
                  onChange={(event) => event.target.files && upload(event.target.files)}
                />
                <span className="upload-icon" aria-hidden="true">↑</span>
                <strong>Drop files here to share</strong>
                <span>or</span>
                <button className="primary-button" type="button" onClick={() => input.current?.click()} disabled={!identity}>
                  Browse files
                </button>
                <small>Files stay on this computer and your local network</small>
              </div>

              {(progress !== null || status) && (
                <div className="upload-feedback" role="status">
                  {progress !== null && (
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                  )}
                  <span>{status}{progress !== null && ` ${Math.round(progress)}%`}</span>
                </div>
              )}
            </section>

            <section className="panel files-panel">
              <div className="files-heading">
                <div>
                  <p className="eyebrow">SHARED ON THIS DEVICE</p>
                  <h2>Your files <span className="file-count">{files.length}</span></h2>
                </div>
                <label className="search-box">
                  <span aria-hidden="true">⌕</span>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a file" aria-label="Find a file" />
                </label>
              </div>
              <div className="storage-summary">{fmtSize(total)} stored on this computer</div>
              {files.length === 0 ? (
                <div className="empty-files">
                  <span aria-hidden="true">▧</span>
                  <strong>No shared files yet</strong>
                  <p>Choose a file above and it will appear here.</p>
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="empty-files compact-empty">No files match “{query}”.</div>
              ) : (
                <ul className="file-list">
                  {filteredFiles.map((file) => {
                    const isImage = IMG.test(file.name);
                    const isAudio = AUDIO.test(file.name);
                    const isVideo = VIDEO.test(file.name);
                    const expanded = open === file.name;
                    const isOwner = !file.ownerId || file.ownerId === identity?.id;
                    const audience = !isOwner
                      ? 'Shared with you'
                      : file.recipients === null
                        ? 'Everyone on this Wi-Fi'
                        : file.recipients.length
                          ? `You + ${file.recipients.length} device${file.recipients.length === 1 ? '' : 's'}`
                          : 'Only you';
                    const extension = file.name.split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE';

                    return (
                      <li className="file-item" key={file.name}>
                        <div className="file-row">
                          {isImage ? (
                            <img src={`/raw/${enc(file.name)}`} alt="" className="file-thumbnail" />
                          ) : (
                            <span className="file-icon">{extension}</span>
                          )}
                          <div className="file-info">
                            <a className="file-name" href={`/files/${enc(file.name)}`}>{file.name}</a>
                            <span className="file-meta">{fmtSize(file.size)} <span>·</span> {fmtTime(file.time)}</span>
                            <span className="file-audience">{audience}</span>
                          </div>
                          <div className="file-actions">
                            {(isAudio || isVideo) && (
                              <button className="quiet-button" type="button" onClick={() => setOpen(expanded ? null : file.name)}>
                                {expanded ? 'Close' : 'Play'}
                              </button>
                            )}
                            {isOwner && (
                              <button className="delete-button" type="button" onClick={() => remove(file.name)} aria-label={`Delete ${file.name}`}>
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                        {expanded && isAudio && <audio className="media-preview" controls src={`/raw/${enc(file.name)}`} />}
                        {expanded && isVideo && <video className="media-preview" controls playsInline src={`/raw/${enc(file.name)}`} />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <aside className="side-column">
            <section className="panel device-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">YOUR DEVICES</p>
                  <h2>Connected nearby</h2>
                </div>
                <span className="step-number">02</span>
              </div>
              <form className="device-name-form" onSubmit={saveDeviceName}>
                <label htmlFor="device-name">This device</label>
                <div className="device-name-control">
                  <input
                    id="device-name"
                    value={deviceName}
                    onChange={(event) => setDeviceName(event.target.value)}
                    maxLength={40}
                    placeholder="Name this device"
                    disabled={!identity}
                  />
                  <button type="submit" disabled={!identity || deviceName.trim() === identity.name}>Save</button>
                </div>
              </form>
              <div className="connected-list">
                {devices.map((device) => (
                  <div className="connected-device" key={device.id}>
                    <span className={`device-avatar ${device.self ? 'current-avatar' : ''}`} aria-hidden="true">
                      {device.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="device-choice-name">
                      <strong>{device.name}{device.self ? ' (this device)' : ''}</strong>
                      <small className={device.online ? 'device-online' : ''}>{device.online ? 'Online' : 'Offline'}</small>
                    </span>
                    <span className={`online-indicator ${device.online ? 'is-online' : ''}`} />
                  </div>
                ))}
                {devices.length === 0 && (
                  <p className="empty-devices">{ready ? 'No devices registered yet.' : 'Looking for devices…'}</p>
                )}
              </div>
              <p className="device-hint">Open LAN Share on another phone, tablet, or computer using the address shown when you start the server.</p>
            </section>

            <section className="tip-card">
              <span className="tip-icon" aria-hidden="true">✳</span>
              <div>
                <strong>Keep it in the family</strong>
                <p>Uploads stay on your computer. Choose specific devices whenever a file should be private.</p>
              </div>
            </section>
          </aside>
        </section>
      </main>
      <footer className="footer-note">LAN Share <span>·</span> A simple, local way to move files</footer>
    </div>
  );
}
