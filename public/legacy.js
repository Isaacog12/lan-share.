(function () {
  var root = document.getElementById('root');
  var files = [];
  var devices = [];
  var identity;
  var deviceName = '';
  var visibility = 'all';
  var selectedRecipients = [];
  var status = '';
  var progress = null;
  var offline = false;

  function randomHex(length) {
    var bytes = new Uint8Array(length);
    var i;
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    var result = '';
    for (i = 0; i < bytes.length; i += 1) {
      result += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
    return result;
  }

  function readIdentity() {
    var id = '';
    var token = '';
    var name = '';
    try {
      id = localStorage.getItem('lan-share-device-id') || '';
      token = localStorage.getItem('lan-share-device-token') || '';
      name = localStorage.getItem('lan-share-device-name') || '';
    } catch (ignore) {}

    if (!id || !token) {
      id = 'device_' + randomHex(16);
      token = randomHex(32);
      name = 'My device';
      try {
        localStorage.setItem('lan-share-device-id', id);
        localStorage.setItem('lan-share-device-token', token);
        localStorage.setItem('lan-share-device-name', name);
      } catch (ignoreAgain) {}
    }
    return { id: id, token: token, name: name || 'My device' };
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function sizeText(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  function timeText(time) {
    var date = new Date(time);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }

  function isImage(name) {
    return /\.(png|jpe?g|gif|webp|bmp|heic|avif)$/i.test(name);
  }

  function isSelected(id) {
    var i;
    for (i = 0; i < selectedRecipients.length; i += 1) {
      if (selectedRecipients[i] === id) return true;
    }
    return false;
  }

  function render() {
    var online = 0;
    var total = 0;
    var i;
    var deviceMarkup = '';
    var choicesMarkup = '';
    var fileMarkup = '';
    var peers = [];

    for (i = 0; i < devices.length; i += 1) {
      if (devices[i].online && !devices[i].self) online += 1;
      if (!devices[i].self) peers.push(devices[i]);
      deviceMarkup += '<div class="legacy-device">' +
        '<span class="legacy-avatar">' + escapeHtml(devices[i].name.charAt(0).toUpperCase()) + '</span>' +
        '<span class="legacy-device-copy"><strong>' + escapeHtml(devices[i].name) +
        (devices[i].self ? ' (this device)' : '') + '</strong><small>' +
        (devices[i].online ? 'Online' : 'Offline') + '</small></span>' +
        '<span class="legacy-dot' + (devices[i].online ? ' online' : '') + '"></span></div>';
    }

    for (i = 0; i < peers.length; i += 1) {
      choicesMarkup += '<label class="legacy-choice"><input type="checkbox" class="recipient-check" value="' +
        escapeHtml(peers[i].id) + '"' + (isSelected(peers[i].id) ? ' checked="checked"' : '') + '>' +
        '<span class="legacy-avatar">' + escapeHtml(peers[i].name.charAt(0).toUpperCase()) + '</span>' +
        '<span class="legacy-device-copy"><strong>' + escapeHtml(peers[i].name) +
        '</strong><small>' + (peers[i].online ? 'Online now' : 'Offline') + '</small></span></label>';
    }

    for (i = 0; i < files.length; i += 1) {
      total += files[i].size;
      var owner = !files[i].ownerId || files[i].ownerId === identity.id;
      var audience = owner
        ? (files[i].recipients === null ? 'Everyone on this Wi-Fi' :
          (files[i].recipients.length ? 'You and ' + files[i].recipients.length + ' device(s)' : 'Only you'))
        : 'Shared with you';
      var url = encodeURIComponent(files[i].name);
      var extension = files[i].name.split('.').pop().slice(0, 4).toUpperCase();
      fileMarkup += '<li class="legacy-file">' +
        (isImage(files[i].name)
          ? '<img class="legacy-thumb" src="/raw/' + url + '" alt="">'
          : '<span class="legacy-file-icon">' + escapeHtml(extension || 'FILE') + '</span>') +
        '<span class="legacy-file-info"><a href="/files/' + url + '">' + escapeHtml(files[i].name) +
        '</a><small>' + sizeText(files[i].size) + ' &middot; ' + escapeHtml(timeText(files[i].time)) +
        '</small><small class="legacy-audience">' + audience + '</small></span>' +
        (owner ? '<button type="button" class="legacy-delete" data-name="' + escapeHtml(files[i].name) +
          '">Delete</button>' : '') + '</li>';
    }

    root.innerHTML = '<div id="legacy-app">' +
      '<header class="legacy-header"><strong>LAN Share</strong><span class="legacy-status' +
      (offline ? ' offline' : '') + '">' + (offline ? 'Reconnecting…' : online + ' device' +
      (online === 1 ? '' : 's') + ' nearby') + '</span></header>' +
      '<main class="legacy-main"><p class="legacy-eyebrow">YOUR PRIVATE LOCAL NETWORK</p>' +
      '<h1>Files, right where you need them.</h1>' +
      '<p class="legacy-intro">Share files between devices on the same Wi-Fi. Your files stay on this computer.</p>' +
      '<div class="legacy-layout"><section class="legacy-card">' +
      '<p class="legacy-eyebrow">SEND A FILE</p><h2>Choose who can see it</h2>' +
      '<label class="legacy-radio"><input type="radio" name="visibility" value="all"' +
      (visibility === 'all' ? ' checked="checked"' : '') + '> Everyone connected</label>' +
      '<label class="legacy-radio"><input type="radio" name="visibility" value="selected"' +
      (visibility === 'selected' ? ' checked="checked"' : '') + '> Choose devices</label>' +
      (visibility === 'selected'
        ? '<div class="legacy-choices">' + (choicesMarkup || '<p class="legacy-muted">Open this page on another device on the same Wi-Fi first.</p>') +
          '<p class="legacy-muted">' + (selectedRecipients.length
            ? 'Selected ' + selectedRecipients.length + ' device(s)'
            : 'No devices selected — only you will see this upload') + '</p></div>'
        : '') +
      '<div class="legacy-upload"><label for="legacy-files"><strong>Choose files to share</strong>' +
      '<small>Tap to select one or more files</small></label><input id="legacy-files" type="file" multiple></div>' +
      (progress !== null || status
        ? '<p class="legacy-feedback">' + escapeHtml(status) + (progress !== null ? ' ' + Math.round(progress) + '%' : '') + '</p>' +
          (progress !== null ? '<div class="legacy-progress"><span style="width:' + progress + '%"></span></div>' : '')
        : '') +
      '</section><section class="legacy-card"><p class="legacy-eyebrow">YOUR DEVICES</p><h2>Connected nearby</h2>' +
      '<form id="legacy-name-form"><label for="legacy-name">This device</label><div class="legacy-name-row">' +
      '<input id="legacy-name" maxlength="40" value="' + escapeHtml(deviceName) + '">' +
      '<button type="submit">Save</button></div></form>' +
      '<div class="legacy-devices">' + (deviceMarkup || '<p class="legacy-muted">Looking for devices…</p>') + '</div>' +
      '<p class="legacy-muted">Open LAN Share on another device using the address shown when the server starts.</p>' +
      '</section></div><section class="legacy-card legacy-files"><p class="legacy-eyebrow">SHARED ON THIS DEVICE</p>' +
      '<h2>Your files (' + files.length + ')</h2><p class="legacy-muted">' + sizeText(total) + ' stored on this computer</p>' +
      (fileMarkup ? '<ul>' + fileMarkup + '</ul>' : '<p class="legacy-empty">No shared files yet.</p>') +
      '</section></main></div>';

    bindEvents();
  }

  function request(method, url, body, callback, json) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    if (json) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) callback(xhr.status, xhr.responseText, xhr);
    };
    xhr.send(body || null);
    return xhr;
  }

  function loadData() {
    request('GET', '/api/files', null, function (fileStatus, fileText) {
      if (fileStatus !== 200) {
        offline = true;
        render();
        return;
      }
      request('GET', '/api/devices', null, function (deviceStatus, deviceText) {
        if (deviceStatus !== 200) {
          offline = true;
          render();
          return;
        }
        try {
          files = JSON.parse(fileText);
          devices = JSON.parse(deviceText);
          offline = false;
          render();
        } catch (ignore) {
          offline = true;
          render();
        }
      });
    });
  }

  function register() {
    request('POST', '/api/devices/register', JSON.stringify(identity), function (statusCode) {
      if (statusCode >= 200 && statusCode < 300) loadData();
      else {
        offline = true;
        render();
      }
    }, true);
  }

  function upload(input) {
    var selectedFiles = input.files;
    var data;
    var xhr;
    var i;
    var completed = false;
    if (!selectedFiles || !selectedFiles.length) return;
    data = new FormData();
    data.append('visibility', visibility);
    data.append('recipients', JSON.stringify(selectedRecipients));
    for (i = 0; i < selectedFiles.length; i += 1) data.append('files', selectedFiles[i]);

    status = 'Uploading ' + selectedFiles.length + ' file(s)…';
    progress = 0;
    render();
    xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);
    if (xhr.upload) {
      xhr.upload.onprogress = function (event) {
        if (event.lengthComputable) {
          progress = event.loaded / event.total * 100;
          render();
        }
      };
    }
    function finishUpload(failed) {
      if (completed) return;
      completed = true;
      progress = null;
      status = !failed && xhr.status === 200 ? 'Upload complete' : 'Upload failed';
      loadData();
      window.setTimeout(function () { status = ''; render(); }, 2500);
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) finishUpload(false);
    };
    xhr.onerror = function () { finishUpload(true); };
    xhr.send(data);
  }

  function bindEvents() {
    var fileInput = document.getElementById('legacy-files');
    var nameInput = document.getElementById('legacy-name');
    var nameForm = document.getElementById('legacy-name-form');

    if (fileInput) fileInput.onchange = function () { upload(fileInput); };
    if (nameInput) nameInput.onkeyup = function () { deviceName = nameInput.value; };
    if (nameForm) nameForm.onsubmit = function (event) {
      event.preventDefault();
      deviceName = nameInput.value.replace(/^\s+|\s+$/g, '').slice(0, 40) || 'My device';
      identity.name = deviceName;
      try { localStorage.setItem('lan-share-device-name', deviceName); } catch (ignore) {}
      register();
    };

    root.onchange = function (event) {
      var target = event.target || event.srcElement;
      var checks;
      var i;
      if (target.name === 'visibility') {
        visibility = target.value;
        render();
      } else if (target.className === 'recipient-check') {
        checks = root.getElementsByClassName('recipient-check');
        selectedRecipients = [];
        for (i = 0; i < checks.length; i += 1) {
          if (checks[i].checked) selectedRecipients.push(checks[i].value);
        }
        render();
      }
    };

    root.onclick = function (event) {
      var target = event.target || event.srcElement;
      while (target && target !== root) {
        if (target.className === 'legacy-delete') {
          var name = target.getAttribute('data-name');
          if (window.confirm('Delete "' + name + '"?')) {
            request('DELETE', '/api/files/' + encodeURIComponent(name), null, function (statusCode) {
              if (statusCode === 200) loadData();
              else {
                status = 'Could not delete this file';
                render();
              }
            });
          }
          return;
        }
        target = target.parentNode;
      }
    };
  }

  identity = readIdentity();
  deviceName = identity.name;
  render();
  register();
  window.setInterval(function () {
    request('POST', '/api/devices/heartbeat', null, function (statusCode) {
      if (statusCode >= 200 && statusCode < 300) loadData();
      else {
        offline = true;
        render();
      }
    });
  }, 7000);
}());
