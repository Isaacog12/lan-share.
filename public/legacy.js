(function () {
  var root = document.getElementById('root');
  var user = null;
  var folders = [];
  var people = [];
  var files = [];
  var selectedFolderId = '';
  var authMode = 'login';
  var authError = '';
  var notice = '';
  var folderMode = '';
  var folderName = '';
  var folderMembers = [];
  var searchText = '';
  var uploadPercent = null;

  function esc(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function req(method, url, body, callback, json) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    if (json) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) callback(xhr.status, xhr.responseText, xhr);
    };
    xhr.send(body || null);
    return xhr;
  }
  function read(text) {
    try { return JSON.parse(text); } catch (ignore) { return null; }
  }
  function sizeText(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }
  function dateText(time) {
    var date = new Date(time);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }
  function currentFolder() {
    var i;
    for (i = 0; i < folders.length; i += 1) if (folders[i].id === selectedFolderId) return folders[i];
    return null;
  }
  function isMember(id) {
    var i;
    for (i = 0; i < folderMembers.length; i += 1) if (folderMembers[i] === id) return true;
    return false;
  }
  function memberOptions() {
    var html = '';
    var i;
    for (i = 0; i < people.length; i += 1) {
      html += '<label class="legacy-person"><input class="legacy-member-check" type="checkbox" value="' +
        esc(people[i].id) + '"' + (isMember(people[i].id) ? ' checked="checked"' : '') + '>' +
        '<span class="legacy-person-avatar">' + esc((people[i].displayName || people[i].username).charAt(0).toUpperCase()) +
        '</span><span><strong>' + esc(people[i].displayName) + '</strong><small>@' +
        esc(people[i].username) + '</small></span></label>';
    }
    return html || '<p class="legacy-muted">No other accounts yet. They can sign up on this page.</p>';
  }

  function renderAuth() {
    root.innerHTML = '<div class="legacy-shell legacy-auth">' +
      '<header class="legacy-top"><strong>lan<span>share</span></strong><span class="legacy-local">LOCAL ONLY</span></header>' +
      '<main class="legacy-auth-content"><p class="legacy-kicker">YOUR PRIVATE SPACE</p>' +
      '<h1>Your files.<br><em>Your people.</em></h1>' +
      '<p class="legacy-intro">Create a local account, make a folder, and invite the people you choose.</p>' +
      '<section class="legacy-card legacy-login"><p class="legacy-kicker">WELCOME TO LAN SHARE</p>' +
      '<h2>' + (authMode === 'login' ? 'Welcome back' : 'Create your account') + '</h2>' +
      '<div class="legacy-tabs"><button type="button" data-action="login-tab"' +
      (authMode === 'login' ? ' class="active"' : '') + '>Sign in</button>' +
      '<button type="button" data-action="register-tab"' + (authMode === 'register' ? ' class="active"' : '') +
      '>Create account</button></div><form id="legacy-auth-form">' +
      (authMode === 'register' ? '<label>Your name (optional)<input id="legacy-display" maxlength="40" placeholder="How others will see you"></label>' : '') +
      '<label>Username<input id="legacy-username" maxlength="32" autocapitalize="none" required></label>' +
      '<label>Password<input id="legacy-password" type="password" minlength="' +
      (authMode === 'register' ? '8' : '1') + '" maxlength="256" required></label>' +
      (authError ? '<p class="legacy-error">' + esc(authError) + '</p>' : '') +
      '<button class="legacy-primary" type="submit">' +
      (authMode === 'login' ? 'Sign in' : 'Create local account') + '</button></form>' +
      '<p class="legacy-muted">Your account and password hash are stored on this laptop.</p></section>' +
      '</main><footer class="legacy-footer">A little more private. A lot more personal.</footer></div>';
    bind();
  }

  function renderWorkspace() {
    var folder = currentFolder();
    var folderMarkup = '';
    var fileMarkup = '';
    var createForm = '';
    var total = 0;
    var i;
    var shown = 0;

    for (i = 0; i < folders.length; i += 1) {
      folderMarkup += '<button type="button" class="legacy-folder' +
        (folders[i].id === selectedFolderId ? ' selected' : '') + '" data-folder="' + esc(folders[i].id) + '">' +
        '<span class="legacy-folder-mark">▱</span><span class="legacy-folder-copy"><strong>' +
        esc(folders[i].name) + '</strong><small>' + folders[i].fileCount + ' files</small></span></button>';
    }
    for (i = 0; i < files.length; i += 1) {
      total += files[i].size;
      if (searchText && files[i].name.toLowerCase().indexOf(searchText.toLowerCase()) < 0) continue;
      shown += 1;
      fileMarkup += '<li class="legacy-file"><span class="legacy-file-mark">' +
        esc((files[i].name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()) + '</span>' +
        '<span class="legacy-file-copy"><a href="/files/' + encodeURIComponent(files[i].name) + '">' +
        esc(files[i].name) + '</a><small>' + sizeText(files[i].size) + ' · ' + esc(dateText(files[i].time)) +
        ' · ' + esc(files[i].uploadedBy) + '</small></span>' +
        (files[i].canDelete ? '<button class="legacy-delete" type="button" data-delete="' +
          esc(files[i].name) + '">Delete</button>' : '') + '</li>';
    }

    if (folderMode) {
      createForm = '<section class="legacy-card legacy-folder-form"><p class="legacy-kicker">' +
        (folderMode === 'edit' ? 'FOLDER ACCESS' : 'MAKE A LITTLE SPACE') + '</p><h2>' +
        (folderMode === 'edit' ? 'Manage folder' : 'Create a folder') + '</h2>' +
        '<form id="legacy-folder-form"><label>Folder name<input id="legacy-folder-name" maxlength="60" required value="' +
        esc(folderName) + '"></label><p class="legacy-kicker">INVITE PEOPLE · ' +
        (folderMembers.length ? folderMembers.length + ' selected' : 'private for now') + '</p>' +
        '<div class="legacy-people">' + memberOptions() + '</div>' +
        '<div class="legacy-form-actions">' + (folderMode === 'edit' ? '<button type="button" data-action="delete-folder">Delete folder</button>' : '') +
        '<button class="legacy-primary" type="submit">' + (folderMode === 'edit' ? 'Save access' : 'Create folder') + '</button>' +
        '<button type="button" data-action="cancel-folder">Cancel</button></div></form></section>';
    }

    root.innerHTML = '<div class="legacy-shell"><header class="legacy-top"><strong>lan<span>share</span></strong>' +
      '<div class="legacy-account"><span>' + esc(user.displayName) + ' · @' + esc(user.username) +
      '</span><button type="button" data-action="logout">Sign out</button></div></header>' +
      '<main class="legacy-workspace"><div class="legacy-welcome"><div><p class="legacy-kicker">YOUR PRIVATE SPACE</p>' +
      '<h1>Good to see you, ' + esc(user.displayName) + '.</h1><p>Folders stay on this laptop. You decide who gets in.</p></div>' +
      '<button class="legacy-primary" type="button" data-action="create-folder">＋ New folder</button></div>' +
      (notice ? '<p class="legacy-notice">' + esc(notice) + '</p>' : '') +
      '<div class="legacy-columns"><aside class="legacy-card legacy-sidebar"><p class="legacy-kicker">YOUR LIBRARY</p>' +
      '<h2>Folders (' + folders.length + ')</h2>' + folderMarkup +
      (!folders.length ? '<p class="legacy-muted">Create a folder to get started.</p>' : '') +
      '</aside><section class="legacy-main-column">' + createForm +
      (folder ? '<section class="legacy-card legacy-folder-head"><p class="legacy-kicker">' +
        (folder.canManage ? 'YOUR FOLDER' : 'SHARED WITH YOU') + '</p><h2>' + esc(folder.name) + '</h2>' +
        '<p>' + folder.fileCount + ' files · ' + (folder.canManage ? folder.members.length + ' invited' : 'Owner: ' + esc(folder.ownerName)) + '</p>' +
        (folder.canManage && !folder.legacy ? '<button type="button" data-action="manage-folder">Manage access</button>' : '') +
        '</section><section class="legacy-card legacy-upload"><h2>Add files</h2>' +
        '<p>Only accounts with folder access can see these files.</p><input type="file" id="legacy-file-input" multiple>' +
        (uploadPercent !== null ? '<p class="legacy-progress">' + Math.round(uploadPercent) + '% uploaded</p>' : '') +
        '</section><section class="legacy-card legacy-file-list"><div class="legacy-list-heading"><div><p class="legacy-kicker">INSIDE THIS FOLDER</p>' +
        '<h2>Files (' + files.length + ')</h2><small>' + sizeText(total) + ' in this folder</small></div>' +
        '<input id="legacy-search" placeholder="Search files" value="' + esc(searchText) + '"></div>' +
        (shown ? '<ul>' + fileMarkup + '</ul>' : '<p class="legacy-muted">' +
          (files.length ? 'No files match your search.' : 'This folder is waiting for its first file.') + '</p>') +
        '</section>' : '<section class="legacy-card legacy-first-folder"><h2>A folder for every little thing.</h2>' +
        '<p>Create a folder, choose who belongs, and share from this laptop.</p><button type="button" class="legacy-primary" data-action="create-folder">Create your first folder</button></section>') +
      '</section></div></main></div>';
    bind();
  }

  function render() {
    if (user) renderWorkspace();
    else renderAuth();
  }

  function loadFiles() {
    var folder = currentFolder();
    if (!folder) { files = []; render(); return; }
    req('GET', '/api/folders/' + encodeURIComponent(folder.id) + '/files', null, function (status, text) {
      if (status === 200) {
        files = read(text) || [];
        render();
      } else {
        files = [];
        render();
      }
    });
  }

  function loadWorkspace() {
    req('GET', '/api/folders', null, function (folderStatus, folderText) {
      if (folderStatus !== 200) { user = null; render(); return; }
      folders = read(folderText) || [];
      req('GET', '/api/users', null, function (peopleStatus, peopleText) {
        people = peopleStatus === 200 ? (read(peopleText) || []) : [];
        if (!currentFolder() && folders.length) selectedFolderId = folders[0].id;
        loadFiles();
      });
    });
  }

  function checkSession() {
    req('GET', '/api/auth/session', null, function (status, text) {
      var result = read(text);
      user = status === 200 && result ? result.user : null;
      render();
      if (user) loadWorkspace();
    });
  }

  function submitAuth(form) {
    var usernameInput = document.getElementById('legacy-username');
    var passwordInput = document.getElementById('legacy-password');
    var displayInput = document.getElementById('legacy-display');
    var payload = { username: usernameInput.value, password: passwordInput.value };
    if (authMode === 'register' && displayInput) payload.displayName = displayInput.value;
    req('POST', '/api/auth/' + authMode, JSON.stringify(payload), function (status, text) {
      var result = read(text);
      if (status >= 200 && status < 300 && result && result.user) {
        user = result.user;
        authError = '';
        notice = '';
        loadWorkspace();
      } else {
        authError = result && result.error ? result.error : 'Could not sign in.';
        render();
      }
    }, true);
  }

  function saveFolder() {
    var url = folderMode === 'edit' ? '/api/folders/' + encodeURIComponent(selectedFolderId) : '/api/folders';
    var method = folderMode === 'edit' ? 'PATCH' : 'POST';
    var nameInput = document.getElementById('legacy-folder-name');
    if (nameInput) folderName = nameInput.value;
    req(method, url, JSON.stringify({ name: folderName, members: folderMembers }), function (status, text) {
      var result = read(text);
      if (status >= 200 && status < 300) {
        if (folderMode !== 'edit' && result && result.id) selectedFolderId = result.id;
        folderMode = '';
        notice = 'Folder saved.';
        loadWorkspace();
      } else {
        notice = result && result.error ? result.error : 'Could not save folder.';
        render();
      }
    }, true);
  }

  function upload(input) {
    var selected = input.files;
    var data;
    var xhr;
    var i;
    if (!selected || !selected.length || !selectedFolderId) return;
    data = new FormData();
    for (i = 0; i < selected.length; i += 1) data.append('files', selected[i]);
    xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/folders/' + encodeURIComponent(selectedFolderId) + '/files', true);
    uploadPercent = 0;
    render();
    if (xhr.upload) xhr.upload.onprogress = function (event) {
      if (event.lengthComputable) { uploadPercent = event.loaded / event.total * 100; render(); }
    };
    var completed = false;
    function finish(failed) {
      if (completed) return;
      completed = true;
      uploadPercent = null;
      notice = failed || xhr.status < 200 || xhr.status >= 300 ? 'Upload failed.' : 'Files added to the folder.';
      loadWorkspace();
    }
    xhr.onreadystatechange = function () { if (xhr.readyState === 4) finish(false); };
    xhr.onerror = function () { finish(true); };
    xhr.send(data);
  }

  function bind() {
    root.onsubmit = function (event) {
      var form = event.target || event.srcElement;
      event.preventDefault();
      if (form.id === 'legacy-auth-form') submitAuth(form);
      if (form.id === 'legacy-folder-form') saveFolder();
    };
    root.oninput = function (event) {
      var target = event.target || event.srcElement;
      if (target.id === 'legacy-folder-name') folderName = target.value;
      if (target.id === 'legacy-search') {
        searchText = target.value;
        var cards = root.getElementsByClassName('legacy-file');
        var i;
        for (i = 0; i < cards.length; i += 1) {
          var link = cards[i].getElementsByTagName('a')[0];
          cards[i].style.display = link && link.innerHTML.toLowerCase().indexOf(searchText.toLowerCase()) >= 0 ? '' : 'none';
        }
      }
    };
    root.onchange = function (event) {
      var target = event.target || event.srcElement;
      if (target.className === 'legacy-member-check') {
        var checks = root.getElementsByClassName('legacy-member-check');
        var i;
        folderMembers = [];
        for (i = 0; i < checks.length; i += 1) if (checks[i].checked) folderMembers.push(checks[i].value);
        if (folderMode) render();
      }
      if (target.id === 'legacy-file-input') upload(target);
    };
    root.onclick = function (event) {
      var target = event.target || event.srcElement;
      while (target && target !== root) {
        var action = target.getAttribute && target.getAttribute('data-action');
        if (action === 'login-tab' || action === 'register-tab') {
          authMode = action === 'login-tab' ? 'login' : 'register';
          authError = '';
          render();
          return;
        }
        if (action === 'logout') {
          req('POST', '/api/auth/logout', null, function () {
            user = null; folders = []; files = []; authMode = 'login'; render();
          });
          return;
        }
        if (action === 'create-folder') {
          folderMode = 'create'; folderName = ''; folderMembers = []; render(); return;
        }
        if (action === 'manage-folder') {
          folderMode = 'edit'; folderName = currentFolder().name;
          folderMembers = currentFolder().memberIds || []; render(); return;
        }
        if (action === 'cancel-folder') { folderMode = ''; render(); return; }
        if (action === 'delete-folder') {
          var folder = currentFolder();
          if (folder && window.confirm('Delete "' + folder.name + '" and its files?')) {
            req('DELETE', '/api/folders/' + encodeURIComponent(folder.id), null, function (status) {
              if (status === 200) { selectedFolderId = ''; notice = 'Folder deleted.'; loadWorkspace(); }
              else { notice = 'Could not delete the folder.'; render(); }
            });
          }
          return;
        }
        var folderId = target.getAttribute && target.getAttribute('data-folder');
        if (folderId) { selectedFolderId = folderId; searchText = ''; loadFiles(); return; }
        var fileName = target.getAttribute && target.getAttribute('data-delete');
        if (fileName && window.confirm('Delete "' + fileName + '"?')) {
          req('DELETE', '/api/files/' + encodeURIComponent(fileName), null, function (status) {
            if (status === 200) loadWorkspace();
            else { notice = 'Could not delete the file.'; render(); }
          });
          return;
        }
        target = target.parentNode;
      }
    };
  }

  renderAuth();
  checkSession();
  window.setInterval(function () { if (user) loadWorkspace(); }, 10000);
}());
