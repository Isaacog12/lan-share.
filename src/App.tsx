import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

type User = { id: string; username: string; displayName: string };
type Folder = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  canManage: boolean;
  legacy: boolean;
  members: string[];
  memberIds?: string[];
  fileCount: number;
};
type Person = User;
type FileItem = { name: string; size: number; time: number; uploadedBy: string; canDelete: boolean };

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

const formatDate = (time: number) =>
  new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderMembers, setFolderMembers] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const filteredFiles = useMemo(
    () => files.filter((file) => file.name.toLowerCase().includes(search.trim().toLowerCase())),
    [files, search],
  );

  useEffect(() => {
    let active = true;
    api<{ user: User | null }>('/api/auth/session')
      .then(({ user: currentUser }) => { if (active) setUser(currentUser); })
      .catch(() => { if (active) setAuthError('Could not reach the local server.'); })
      .finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, []);

  const refreshOverview = useCallback(async () => {
    try {
      const [nextFolders, nextPeople] = await Promise.all([
        api<Folder[]>('/api/folders'),
        api<Person[]>('/api/users'),
      ]);
      setFolders(nextFolders);
      setPeople(nextPeople);
      setSelectedFolderId((current) =>
        current && nextFolders.some((folder) => folder.id === current)
          ? current
          : nextFolders[0]?.id ?? null,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load folders.');
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setFolders([]);
      setPeople([]);
      setFiles([]);
      setSelectedFolderId(null);
      return;
    }
    refreshOverview();
    const interval = window.setInterval(refreshOverview, 10000);
    return () => window.clearInterval(interval);
  }, [user, refreshOverview]);

  const refreshFiles = useCallback(async (folderId: string) => {
    try {
      const nextFiles = await api<FileItem[]>(`/api/folders/${encodeURIComponent(folderId)}/files`);
      setFiles(nextFiles);
    } catch (error) {
      setFiles([]);
      setNotice(error instanceof Error ? error.message : 'Could not load files.');
    }
  }, []);

  useEffect(() => {
    if (!user || !selectedFolderId) {
      setFiles([]);
      return;
    }
    refreshFiles(selectedFolderId);
    const interval = window.setInterval(() => refreshFiles(selectedFolderId), 7000);
    return () => window.clearInterval(interval);
  }, [user, selectedFolderId, refreshFiles]);

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    try {
      const body = authMode === 'register'
        ? { username, password, displayName: displayName.trim() }
        : { username, password };
      const result = await api<{ user: User }>(`/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setUser(result.user);
      setPassword('');
      setNotice('');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    setUser(null);
    setAuthMode('login');
  };

  const openCreateFolder = () => {
    setEditingFolder(null);
    setFolderName('');
    setFolderMembers([]);
    setModalOpen(true);
  };

  const openFolderSettings = (folder: Folder) => {
    setEditingFolder(folder);
    setFolderName(folder.name);
    setFolderMembers(folder.memberIds ?? []);
    setModalOpen(true);
  };

  const toggleMember = (id: string) => {
    setFolderMembers((current) =>
      current.includes(id) ? current.filter((member) => member !== id) : [...current, id],
    );
  };

  const saveFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    try {
      if (editingFolder) {
        await api(`/api/folders/${encodeURIComponent(editingFolder.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: folderName, members: folderMembers }),
        });
      } else {
        const created = await api<{ id: string }>('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: folderName, members: folderMembers }),
        });
        setSelectedFolderId(created.id);
      }
      setModalOpen(false);
      await refreshOverview();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save folder.');
    }
  };

  const deleteFolder = async () => {
    if (!selectedFolder || !confirm(`Delete “${selectedFolder.name}” and all its files?`)) return;
    try {
      await api(`/api/folders/${encodeURIComponent(selectedFolder.id)}`, { method: 'DELETE' });
      setSelectedFolderId(null);
      setNotice('Folder deleted.');
      await refreshOverview();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not delete folder.');
    }
  };

  const upload = (fileList: FileList | File[]) => {
    const selectedFiles = Array.from(fileList);
    if (!selectedFiles.length || !selectedFolderId) return;
    const data = new FormData();
    selectedFiles.forEach((file) => data.append('files', file));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/folders/${encodeURIComponent(selectedFolderId)}/files`);
    setNotice(`Uploading ${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'}…`);
    setUploading(0);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setUploading((event.loaded / event.total) * 100);
    };
    xhr.onload = () => {
      setUploading(null);
      if (fileInput.current) fileInput.current.value = '';
      if (xhr.status >= 200 && xhr.status < 300) {
        setNotice(`${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} added to ${selectedFolder?.name}.`);
        refreshFiles(selectedFolderId);
        refreshOverview();
      } else {
        try { setNotice(JSON.parse(xhr.responseText).error || 'Upload failed.'); }
        catch { setNotice('Upload failed.'); }
      }
      window.setTimeout(() => setNotice(''), 3500);
    };
    xhr.onerror = () => {
      setUploading(null);
      setNotice('Upload failed. Check that the laptop is still online.');
    };
    xhr.send(data);
  };

  const deleteFile = async (file: FileItem) => {
    if (!confirm(`Delete “${file.name}”?`)) return;
    try {
      await api(`/api/files/${encodeURIComponent(file.name)}`, { method: 'DELETE' });
      setFiles((current) => current.filter((item) => item.name !== file.name));
      refreshOverview();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not delete file.');
    }
  };

  if (checkingSession) {
    return <div className="loading-screen"><span className="loader-orb" /><p>Opening your local space…</p></div>;
  }

  if (!user) {
    return (
      <div className="auth-screen">
        <div className="auth-glow glow-a" />
        <div className="auth-glow glow-b" />
        <header className="brand auth-brand"><span className="brand-symbol">l</span><span>lan<span className="brand-light">share</span></span></header>
        <main className="auth-layout">
          <section className="auth-story">
            <span className="eyebrow-pill"><i /> PRIVATE BY DESIGN</span>
            <h1>Your files.<br /><span>Your people.</span></h1>
            <p>A quiet, private little space on your laptop. Make a folder, invite the people you choose, and share over your own Wi-Fi.</p>
            <div className="story-points">
              <span><i>✦</i> Stays on your laptop</span>
              <span><i>⌘</i> Invite by account</span>
              <span><i>↗</i> Works across your devices</span>
            </div>
            <div className="floating-orbit orbit-one" />
            <div className="floating-orbit orbit-two" />
          </section>

          <section className="auth-card glass-card">
            <div className="auth-card-top">
              <span className="eyebrow">WELCOME TO LAN SHARE</span>
              <span className="privacy-badge"><span /> LOCAL ONLY</span>
            </div>
            <h2>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
            <p className="auth-subtitle">{authMode === 'login' ? 'Sign in to open your shared folders.' : 'Your account stays in a file on this laptop.'}</p>
            <div className="auth-tabs" role="tablist" aria-label="Account">
              <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setAuthError(''); }}>Sign in</button>
              <button type="button" className={authMode === 'register' ? 'active' : ''} onClick={() => { setAuthMode('register'); setAuthError(''); }}>Create account</button>
            </div>
            <form className="auth-form" onSubmit={submitAuth}>
              {authMode === 'register' && (
                <label className="field-label">
                  <span>Your name <small>optional</small></span>
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} autoComplete="name" placeholder="How others will see you" />
                </label>
              )}
              <label className="field-label">
                <span>Username</span>
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={32} placeholder="e.g. alex" />
              </label>
              <label className="field-label">
                <span>Password</span>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required minLength={authMode === 'register' ? 8 : undefined} maxLength={256} placeholder={authMode === 'register' ? 'At least 8 characters' : 'Your password'} />
              </label>
              {authError && <p className="form-error" role="alert">{authError}</p>}
              <button className="button-primary auth-submit" type="submit" disabled={authBusy}>
                {authBusy ? 'One moment…' : authMode === 'login' ? 'Sign in to your space' : 'Create local account'} <span>↗</span>
              </button>
            </form>
            <p className="auth-footnote"><span>◈</span> Passwords are stored as salted hashes on this laptop.</p>
          </section>
        </main>
        <footer className="auth-footer">A little more private. A lot more personal.</footer>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-glow glow-a" />
      <div className="dashboard-glow glow-b" />
      <header className="topbar glass-topbar">
        <a className="brand" href="/" aria-label="LAN Share home">
          <span className="brand-symbol">l</span><span>lan<span className="brand-light">share</span></span>
        </a>
        <div className="topbar-right">
          <span className="local-badge"><span /> On this laptop</span>
          <span className="topbar-divider" />
          <span className="user-avatar">{(user.displayName || user.username).slice(0, 1).toUpperCase()}</span>
          <span className="signed-in-as"><strong>{user.displayName}</strong><small>@{user.username}</small></span>
          <button className="icon-button signout-button" type="button" onClick={signOut} aria-label="Sign out" title="Sign out">↗</button>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="welcome-row">
          <div>
            <span className="eyebrow-pill"><i /> YOUR PRIVATE SPACE</span>
            <h1>Good to see you, <span>{user.displayName || user.username}.</span></h1>
            <p>Your folders live here on this laptop. Share each one only with the people you trust.</p>
          </div>
          <button className="button-primary new-folder-top" type="button" onClick={openCreateFolder}><span>＋</span> New folder</button>
        </section>

        {notice && <div className="notice glass-card" role="status"><span>✦</span>{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}

        <div className="workspace">
          <aside className="sidebar glass-card">
            <div className="sidebar-heading">
              <div><span className="eyebrow">YOUR LIBRARY</span><h2>Folders <span>{folders.length}</span></h2></div>
              <button className="icon-button add-folder-button" type="button" onClick={openCreateFolder} aria-label="Create folder">＋</button>
            </div>
            <div className="folder-list">
              {folders.map((folder) => (
                <button
                  className={`folder-nav ${selectedFolderId === folder.id ? 'selected' : ''}`}
                  type="button"
                  key={folder.id}
                  onClick={() => { setSelectedFolderId(folder.id); setSearch(''); }}
                >
                  <span className={`folder-glyph ${folder.legacy ? 'archive-glyph' : ''}`}>{folder.legacy ? '◷' : '▱'}</span>
                  <span className="folder-nav-copy"><strong>{folder.name}</strong><small>{folder.canManage ? 'Owner' : `By ${folder.ownerName}`}</small></span>
                  <span className="folder-count">{folder.fileCount}</span>
                </button>
              ))}
              {folders.length === 0 && (
                <div className="sidebar-empty"><span>▱</span><p>Your first folder is waiting.</p><button type="button" onClick={openCreateFolder}>Create one</button></div>
              )}
            </div>
            <div className="sidebar-footer"><span className="lock-mark">⌑</span><span>Stored locally<br /><small>Files stay on this laptop</small></span></div>
          </aside>

          <section className="content-column">
            {selectedFolder ? (
              <>
                <div className="folder-heading glass-card">
                  <div className="folder-title-block">
                    <span className={`large-folder-glyph ${selectedFolder.legacy ? 'archive-glyph' : ''}`}>{selectedFolder.legacy ? '◷' : '▱'}</span>
                    <div>
                      <span className="eyebrow">{selectedFolder.legacy ? 'YOUR PREVIOUS FILES' : selectedFolder.canManage ? 'YOUR FOLDER' : 'SHARED WITH YOU'}</span>
                      <h2>{selectedFolder.name}</h2>
                      <p>{selectedFolder.fileCount} {selectedFolder.fileCount === 1 ? 'file' : 'files'} <span>·</span> {selectedFolder.canManage ? `${selectedFolder.members.length} invited` : 'Shared with you'}</p>
                    </div>
                  </div>
                  <div className="folder-actions">
                    {!selectedFolder.legacy && selectedFolder.canManage && (
                      <>
                        <button className="button-glass" type="button" onClick={() => openFolderSettings(selectedFolder)}>Manage access <span>⌄</span></button>
                        <button className="icon-button danger-icon" type="button" onClick={deleteFolder} aria-label="Delete folder" title="Delete folder">⌫</button>
                      </>
                    )}
                    <div className="member-stack" title={selectedFolder.members.join(', ')}>
                      {selectedFolder.members.slice(0, 4).map((member, index) => <span key={member} style={{ zIndex: 4 - index }}>{member.slice(0, 1).toUpperCase()}</span>)}
                      {selectedFolder.members.length > 4 && <span className="member-extra">+{selectedFolder.members.length - 4}</span>}
                      {selectedFolder.members.length === 0 && <span className="member-private">⌑</span>}
                    </div>
                  </div>
                </div>

                <div
                  className={`upload-card glass-card ${dragging ? 'is-dragging' : ''}`}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => { event.preventDefault(); setDragging(false); upload(event.dataTransfer.files); }}
                >
                  <input ref={fileInput} className="hidden-file-input" type="file" multiple onChange={(event) => event.target.files && upload(event.target.files)} />
                  <span className="upload-cloud">↑</span>
                  <div className="upload-copy"><strong>Drop something wonderful here</strong><span>Files are visible to everyone with access to this folder.</span></div>
                  <button className="button-primary browse-button" type="button" onClick={() => fileInput.current?.click()}>Choose files <span>↗</span></button>
                  <span className="upload-caption">PRIVATE TO THIS FOLDER</span>
                  {uploading !== null && <div className="upload-progress"><span style={{ width: `${uploading}%` }} /></div>}
                </div>

                <div className="files-heading">
                  <div><span className="eyebrow">INSIDE THIS FOLDER</span><h2>Your files <span>{files.length}</span></h2><p>{formatSize(totalSize)} in this folder</p></div>
                  <label className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files" aria-label="Search files" /></label>
                </div>
                {files.length === 0 ? (
                  <div className="empty-state glass-card"><span className="empty-icon">✧</span><strong>This folder is still a blank canvas.</strong><p>Drop in a file or invite someone to make it a shared space.</p></div>
                ) : filteredFiles.length === 0 ? (
                  <div className="empty-state glass-card"><strong>No files match “{search}”.</strong></div>
                ) : (
                  <ul className="file-grid">
                    {filteredFiles.map((file) => {
                      const extension = file.name.split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE';
                      const image = /\.(png|jpe?g|gif|webp|bmp|heic|avif)$/i.test(file.name);
                      return (
                        <li className="file-card glass-card" key={file.name}>
                          <div className="file-card-top">
                            {image ? <img className="file-preview" src={`/raw/${encodeURIComponent(file.name)}`} alt="" /> : <span className="file-type-icon">{extension}</span>}
                            <span className="file-menu">⌁</span>
                          </div>
                          <a className="file-title" href={`/files/${encodeURIComponent(file.name)}`} title={file.name}>{file.name}</a>
                          <div className="file-detail">{formatSize(file.size)} <span>·</span> {formatDate(file.time)}</div>
                          <div className="file-card-footer"><span>Added by {file.uploadedBy}</span>{file.canDelete && <button type="button" onClick={() => deleteFile(file)} aria-label={`Delete ${file.name}`}>Delete</button>}</div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            ) : (
              <div className="first-folder glass-card">
                <span className="empty-icon">▱</span><span className="eyebrow">MAKE IT YOURS</span>
                <h2>A folder for every little thing.</h2>
                <p>Create a folder, pick the people who belong, and start sharing from your laptop.</p>
                <button className="button-primary" type="button" onClick={openCreateFolder}>Create your first folder <span>↗</span></button>
              </div>
            )}
          </section>
        </div>
      </main>

      {modalOpen && (
        <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}>
          <section className="folder-modal glass-card" role="dialog" aria-modal="true" aria-labelledby="folder-modal-title">
            <button className="modal-close icon-button" type="button" onClick={() => setModalOpen(false)} aria-label="Close">×</button>
            <span className="eyebrow">{editingFolder ? 'FOLDER SETTINGS' : 'MAKE A LITTLE SPACE'}</span>
            <h2 id="folder-modal-title">{editingFolder ? 'Manage your folder' : 'Create a folder'}</h2>
            <p className="modal-subtitle">Folders are private to you until you invite someone.</p>
            <form onSubmit={saveFolder}>
              <label className="field-label"><span>Folder name</span><input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} maxLength={60} required placeholder="e.g. Family photos" /></label>
              <div className="invite-heading"><span>INVITE PEOPLE</span><small>{folderMembers.length ? `${folderMembers.length} selected` : 'Private for now'}</small></div>
              <div className="invite-list">
                {people.map((person) => (
                  <label className="invite-person" key={person.id}>
                    <input type="checkbox" checked={folderMembers.includes(person.id)} onChange={() => toggleMember(person.id)} />
                    <span className="invite-avatar">{(person.displayName || person.username).slice(0, 1).toUpperCase()}</span>
                    <span><strong>{person.displayName}</strong><small>@{person.username}</small></span>
                    <i />
                  </label>
                ))}
                {people.length === 0 && <p className="no-people">No other accounts yet. They can create one from this same page.</p>}
              </div>
              <div className="modal-actions">
                {editingFolder && <button className="button-glass" type="button" onClick={deleteFolder}>Delete folder</button>}
                <button className="button-primary" type="submit">{editingFolder ? 'Save changes' : 'Create folder'} <span>↗</span></button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
