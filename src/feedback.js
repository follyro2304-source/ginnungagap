
// ============================================================================
//  Feedback form and admin inbox (backed by /api/feedback and /api/admin)
// ============================================================================
(() => {
  const el = (id) => document.getElementById(id);

  // Small dialog helper: Escape and backdrop close, focus returns to the opener, Tab stays inside.
  function dialog(wrap, onOpen) {
    let opener = null;
    const close = () => { wrap.hidden = true; if (opener && opener.focus) opener.focus(); };
    wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const f = [...wrap.querySelectorAll('button,input,textarea,a[href]')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    return { open() { opener = document.activeElement; wrap.hidden = false; onOpen(); }, close };
  }

  function setStatus(node, text, kind) { node.textContent = text; if (kind) node.dataset.kind = kind; else delete node.dataset.kind; }

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status });
    return data;
  }

  // ---------- Feedback form ----------
  const fbText = el('feedbackText'), fbStatus = el('feedbackStatus'), fbSend = el('feedbackSend'), fbCount = el('feedbackCount');
  const fb = dialog(el('feedbackDlg'), () => { setStatus(fbStatus, ''); fbText.focus(); });
  el('openFeedback').addEventListener('click', fb.open);
  fbText.addEventListener('input', () => { fbCount.textContent = `${fbText.value.length} / 2000`; });
  el('feedbackForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = fbText.value.trim();
    if (!message) { setStatus(fbStatus, 'Please write something first.', 'err'); fbText.focus(); return; }
    fbSend.disabled = true;
    setStatus(fbStatus, 'Sending…');
    try {
      await post('/api/feedback', { message, page: location.hash || '#/' });
      fbText.value = '';
      fbCount.textContent = '0 / 2000';
      setStatus(fbStatus, 'Thank you! Your feedback was sent.', 'ok');
      setTimeout(() => { if (fbStatus.dataset.kind === 'ok') fb.close(); }, 1600);
    } catch (err) {
      setStatus(fbStatus, err.message, 'err');
    } finally {
      fbSend.disabled = false;
    }
  });

  // ---------- Admin inbox ----------
  // The password is kept only in memory for this page view and checked by the server on every request.
  let adminPass = '';
  const admForm = el('adminForm'), admPass = el('adminPass'), admStatus = el('adminStatus'), admList = el('adminList');
  const admFoot = el('adminFoot'), admCount = el('adminCount');
  const adm = dialog(el('adminDlg'), () => { (adminPass ? el('adminRefresh') : admPass).focus(); });
  el('adminLink').addEventListener('click', (e) => { e.preventDefault(); adm.open(); });

  function showLoggedIn(on) {
    admForm.hidden = on;
    admList.hidden = !on;
    admFoot.hidden = !on;
  }

  function render(items) {
    admList.replaceChildren(...items.map((it) => {
      const li = document.createElement('li');
      li.className = 'adm-item';
      const meta = document.createElement('div');
      meta.className = 'adm-meta';
      const when = document.createElement('span');
      when.textContent = new Date(it.at).toLocaleString() + (it.page ? ` · ${it.page}` : '');
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'adm-del';
      del.textContent = 'Delete';
      del.addEventListener('click', () => load({ remove: it.id }));
      meta.append(when, del);
      const msg = document.createElement('p');
      msg.className = 'adm-msg';
      msg.textContent = it.message;
      li.append(meta, msg);
      return li;
    }));
    admCount.textContent = items.length === 1 ? '1 message' : `${items.length} messages`;
    setStatus(admStatus, items.length ? '' : 'No feedback yet.');
  }

  async function load(extra = {}) {
    setStatus(admStatus, 'Loading…');
    try {
      const { items } = await post('/api/admin', { password: adminPass, ...extra });
      showLoggedIn(true);
      render(items);
    } catch (err) {
      if (err.status === 401) { adminPass = ''; showLoggedIn(false); admPass.focus(); }
      setStatus(admStatus, err.message, 'err');
    }
  }

  admForm.addEventListener('submit', (e) => {
    e.preventDefault();
    adminPass = admPass.value;
    admPass.value = '';
    load();
  });
  el('adminRefresh').addEventListener('click', () => load());
  el('adminLogout').addEventListener('click', () => {
    adminPass = '';
    admList.replaceChildren();
    showLoggedIn(false);
    setStatus(admStatus, '');
    admPass.focus();
  });
})();
