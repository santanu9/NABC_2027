/* NABC 2027 Program Planner — frontend (GitHub Pages + Firebase) */
import { DAYS, D, api, configured, requestLink, completeLinkIfPresent, logout, onUser, loadAccess, subscribe, unsubscribeAll } from './data.js';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STATUS = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
const CATS = ['AV', 'Tent', 'Venue', 'Expo', 'Registration', 'Program', 'Food', 'Security', 'Volunteers', 'Transport', 'Other'];
let S = null;            // view state: D + days + me
let view = 'plan', day = 'all', layout = 'list';

function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3500); }
const isAdmin = () => S.me.role === 'admin';
const canEdit = (t) => isAdmin() || (t.leadEmail || '').toLowerCase() === S.me.email;
async function refresh() { if (S) render(); }   // Firestore snapshots push updates automatically

function lock(html) {
  S = null; unsubscribeAll();
  document.body.classList.add('locked'); $('#login').hidden = false; $('#who').innerHTML = '';
  const f = $('#loginForm'); f.innerHTML = html; f.onsubmit = (e) => e.preventDefault(); return f;
}
function showLogin(msg = '') {
  const f = lock(`<h2>Sign in</h2><p>Access is limited to NABC 2027 admins and task leads. Enter your email and we'll send a one-time sign-in link.</p>${configured ? '' : '<p class="lmsg">Firebase is not configured yet — see README.</p>'}<label>Email</label><input id="lemail" type="email" required autocomplete="email"><p><button class="btn gold" type="submit">Email me a sign-in link</button></p><p id="lmsg" class="lmsg">${esc(msg)}</p>`);
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await requestLink($('#lemail').value); f.innerHTML = '<h2>Check your inbox</h2><p>If this email is authorised, you will get a sign-in link. Open it in this same browser. The link works once.</p>'; }
    catch (er) { $('#lmsg').textContent = 'Could not send the link. Try again shortly.'; }
  };
}
function showDenied(email) {
  const f = lock(`<h2>Not authorised</h2><p>${esc(email)} is not on the NABC 2027 access list. Ask an admin to add you as an admin or as a task lead.</p><p><button class="btn" id="bk">Sign out</button></p>`);
  $('#bk').onclick = () => logout();
}
async function start(user) {
  if (!user) return showLogin();
  let me;
  try { me = await loadAccess(user); }
  catch (e) { return e.code === 'uninit' ? (lock(`<h2>Not set up yet</h2><p>${esc(e.message)}</p><p><button class="btn" id="bk">Sign out</button></p>`), $('#bk').onclick = () => logout()) : showDenied(user.email); }
  S = { days: DAYS, me, venues: [], milestones: [], tasks: [], settings: D.settings };
  document.body.classList.remove('locked'); $('#login').hidden = true;
  $('#who').innerHTML = `${esc(me.email)} <small>${me.role}</small> <button class="btn sm" id="logout">Log out</button>`;
  $('#logout').onclick = () => logout();
  $('#addTaskTop').hidden = !isAdmin();
  document.querySelector('[data-view="settings"]').hidden = !isAdmin();
  if (!isAdmin() && view === 'settings') view = 'plan';
  subscribe((d) => { if (!S) return; Object.assign(S, { venues: d.venues, milestones: d.milestones, tasks: d.tasks, settings: d.settings }); if (!$('#dlg').open) render(); },
    () => showDenied(me.email));
}

const venueName = (id) => (S.venues.find((v) => v.id === id) || { name: id }).name;
const dayOf = (k) => S.days.find((d) => d.key === k);
const etaMs = (t) => new Date(t.eta + '-07:00').getTime();
const fmtTime = (hhmm) => { if (!hhmm) return '—'; const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const fmtDT = (d, t) => d ? new Date(d + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + fmtTime(t) : '—';
const startKey = (t) => `${t.startDate || ''}T${t.startTime || ''}`;
const fmtEta = (eta) => eta ? fmtTime(eta.slice(11, 16)) + ' · ' + new Date(eta.slice(0, 10) + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No ETA';
function dueChip(t) {
  if (t.status === 'done' || !t.eta) return '';
  const diff = etaMs(t) - Date.now();
  if (diff < 0) return '<span class="chip late">Overdue</span>';
  if (diff < 48 * 3600e3) return `<span class="chip soon">Due in ${diff < 3600e3 * 2 ? Math.max(1, Math.round(diff / 60e3)) + ' min' : Math.round(diff / 3600e3) + ' h'}</span>`;
  return '';
}

/* ---------- navigation ---------- */
document.querySelectorAll('#mainnav button').forEach((b) => b.onclick = () => { view = b.dataset.view; render(); });
$('#addTaskTop').onclick = () => taskDialog();
['q', 'fStatus', 'fVenue'].forEach((id) => $('#' + id).addEventListener('input', renderTasks));
$('#hideDone').onchange = (e) => { hideDone = e.target.checked; renderTasks(); };
$('#grp').onchange = (e) => { group = e.target.value; renderTasks(); };
$('#vList').onclick = () => { layout = 'list'; render(); };
$('#vBoard').onclick = () => { layout = 'board'; render(); };

function render() {
  document.querySelectorAll('#mainnav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.hidden = v.id !== 'v-' + view);
  $('#vList').classList.toggle('on', layout === 'list'); $('#vBoard').classList.toggle('on', layout === 'board');
  ({ plan: renderPlan, schedule: renderSchedule, venues: renderVenues, people: renderPeople, settings: renderSettings })[view]();
}

/* ---------- countdown ---------- */
function tick() {
  const ms = new Date('2027-07-02T08:00:00-07:00') - Date.now();
  if (ms <= 0) { $('#countdown').innerHTML = '<div><b>Live</b><span>NABC 2027</span></div>'; return; }
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
  $('#countdown').innerHTML = `<div><b>${d}</b><span>Days</span></div><div><b>${h}</b><span>Hours</span></div><div><b>${m}</b><span>Min</span></div>`;
}
tick(); setInterval(tick, 30000);

/* ---------- plan ---------- */
let dept = '', group = 'day', hideDone = false, open = new Set();
const DEPT_COLOR = { AV: '#5b3fa0', Tent: '#b5651d', Venue: '#272974', Expo: '#1c7c86', Registration: '#2f7d4f', Program: '#A3241B', Food: '#c27a00', Security: '#444', Volunteers: '#2a6fb0', Transport: '#7a5c3a', Other: '#777' };
const deptColor = (d) => DEPT_COLOR[d] || '#777';
const isOverdue = (t) => t.status !== 'done' && t.eta && etaMs(t) < Date.now();

function renderPlan() {
  // Date tabs (compact pills)
  const tabs = [{ key: 'all', label: 'All days', short: 'Jul 1–5' }, ...S.days];
  $('#daytabs').innerHTML = tabs.map((d) => {
    const ts = S.tasks.filter((t) => d.key === 'all' || t.day === d.key);
    const done = ts.filter((t) => t.status === 'done').length;
    const sub = d.kind === 'setup' ? 'Setup' : d.kind === 'teardown' ? 'Tear down' : d.kind === 'event' ? 'Event' : 'Overview';
    return `<button class="daytab ${day === d.key ? 'on' : ''}" data-d="${d.key}"><small>${sub} · ${esc(d.short)}</small><b>${done}/${ts.length} done</b></button>`;
  }).join('');
  document.querySelectorAll('.daytab').forEach((b) => b.onclick = () => { day = b.dataset.d; renderPlan(); });

  // Department chips
  const inDay = S.tasks.filter((t) => day === 'all' || t.day === day);
  const depts = [...new Set([...CATS, ...S.tasks.map((t) => t.category)])].filter((c) => inDay.some((t) => t.category === c));
  $('#deptChips').innerHTML = `<button class="dchip ${!dept ? 'on' : ''}" data-dp="">All departments <i>${inDay.length}</i></button>` +
    depts.map((c) => `<button class="dchip ${dept === c ? 'on' : ''}" data-dp="${esc(c)}"><span class="dot" style="background:${deptColor(c)}"></span>${esc(c)} <i>${inDay.filter((t) => t.category === c).length}</i></button>`).join('');
  document.querySelectorAll('.dchip').forEach((b) => b.onclick = () => { dept = b.dataset.dp; renderPlan(); });

  const vSel = $('#fVenue'), vv = vSel.value;
  vSel.innerHTML = '<option value="">All venues</option>' + S.venues.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
  vSel.value = vv;
  $('#hideDone').checked = hideDone; $('#grp').value = group;

  const c = (s) => inDay.filter((t) => t.status === s).length, od = inDay.filter(isOverdue).length;
  $('#stats').innerHTML = `<span><b>${inDay.length}</b> tasks</span><span class="s1">${c('todo')} to do</span><span class="s2">${c('in_progress')} in progress</span><span class="s3">${c('blocked')} blocked</span><span class="s4">${c('done')} done</span>${od ? `<span class="s5">${od} overdue</span>` : ''}`;

  const ms = S.milestones.filter((m) => day === 'all' || m.day === day).sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
  $('#dayKeys').innerHTML = ms.length ? `<details class="keys"><summary>Key start times <small>(${ms.length})</small></summary><div class="keylist">${ms.map((m) =>
    `<div class="key"><b>${fmtTime(m.time)}</b>${esc(m.label)}<em>${day === 'all' ? esc(dayOf(m.day).short) + ' · ' : ''}${esc(venueName(m.venue))}</em></div>`).join('')}</div></details>` : '';
  renderTasks();
}

function filtered() {
  const q = $('#q').value.toLowerCase(), fs = $('#fStatus').value, fv = $('#fVenue').value;
  return S.tasks.filter((t) => (day === 'all' || t.day === day) && (!dept || t.category === dept) && (!fv || t.venue === fv) &&
    (!fs || (fs === 'overdue' ? isOverdue(t) : t.status === fs)) && !(hideDone && t.status === 'done') &&
    (!q || [t.title, t.leadName, t.leadEmail, t.category, venueName(t.venue), t.description, ...(t.team || []).map((p) => p.name + p.email)].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => startKey(a).localeCompare(startKey(b)) || (a.eta || '').localeCompare(b.eta || ''));
}

function row(t) {
  const isOpen = open.has(t.id);
  const lead = t.leadName || t.leadEmail || t.leadPhone
    ? `${esc(t.leadName || '—')}` : '<span class="none">Unassigned</span>';
  const detail = isOpen ? `<div class="detail">
      ${t.description ? `<p>${esc(t.description)}</p>` : ''}
      <div class="dgrid">
        <div><label>Lead POC</label>${t.leadName || t.leadEmail || t.leadPhone ? `<div>${esc(t.leadName)}</div>${t.leadEmail ? `<div><a href="mailto:${esc(t.leadEmail)}">${esc(t.leadEmail)}</a></div>` : ''}${t.leadPhone ? `<div><a href="tel:${esc(t.leadPhone)}">${esc(t.leadPhone)}</a></div>` : ''}` : '<div class="none">No lead assigned</div>'}</div>
        <div><label>Team</label>${(t.team || []).length ? t.team.map((p) => `<div>${esc(p.name || p.email)}${p.email ? ` · <a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}${p.phone ? ' · ' + esc(p.phone) : ''}</div>`).join('') : '<div class="none">None</div>'}</div>
        <div><label>When</label><div>Start ${esc(fmtDT(t.startDate, t.startTime))}</div><div>End ${esc(fmtDT(t.eta.slice(0, 10), t.eta.slice(11, 16)))}</div><div>${esc(venueName(t.venue))}</div></div>
      </div>
      ${t.notes ? `<p class="note">${esc(t.notes)}</p>` : ''}
      <div class="dact">${canEdit(t) ? `<button class="btn sm" data-edit="${t.id}">${isAdmin() ? 'Edit' : 'Update status / notes'}</button><button class="btn sm" data-remind="${t.id}">✉ Send reminder now</button>` : ''}</div></div>` : '';
  return `<div class="row s-${t.status} ${isOpen ? 'open' : ''}" data-id="${t.id}" ${canEdit(t) ? 'draggable="true"' : ''}>
    <div class="rmain" data-toggle="${t.id}">
      <span class="rtime">${esc(fmtDT(t.startDate, t.startTime))}</span>
      <span class="rtitle">${esc(t.title)} ${t.priority === 'high' ? '<span class="flag" title="High priority">●</span>' : ''}</span>
      <span class="rdept"><span class="dot" style="background:${deptColor(t.category)}"></span>${esc(t.category)}</span>
      <span class="rven">${esc(venueName(t.venue))}</span>
      <span class="rlead">${lead}</span>
      <span class="reta">${esc(fmtDT(t.eta.slice(0, 10), t.eta.slice(11, 16)))}${isOverdue(t) ? ' <b class="late">Overdue</b>' : ''}</span>
      <select class="stsel st-${t.status}" data-id="${t.id}" ${canEdit(t) ? '' : 'disabled'}>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>${detail}</div>`;
}

function renderTasks() {
  const list = filtered(), box = $('#tasks');
  if (!list.length) { box.innerHTML = '<div class="empty">No tasks match these filters.</div>'; return; }
  const head = '<div class="rhead"><span>Start</span><span>Task</span><span>Dept</span><span>Venue</span><span>Lead</span><span>End / ETA</span><span>Status</span></div>';
  if (layout === 'board') {
    box.innerHTML = '<div class="board">' + Object.entries(STATUS).map(([k, v]) => {
      const ts = list.filter((t) => t.status === k);
      return `<div class="col" data-col="${k}"><h3>${v}<span>${ts.length}</span></h3>${ts.map(row).join('')}</div>`;
    }).join('') + '</div>';
  } else {
    let groups;
    if (group === 'none') groups = [['', list]];
    else {
      const keyOf = group === 'day' ? (t) => t.day : group === 'dept' ? (t) => t.category : (t) => t.venue;
      const m = new Map(); list.forEach((t) => { const k = keyOf(t); (m.get(k) || m.set(k, []).get(k)).push(t); });
      let keys = [...m.keys()];
      if (group === 'day') keys.sort((a, b) => S.days.findIndex((d) => d.key === a) - S.days.findIndex((d) => d.key === b));
      groups = keys.map((k) => [group === 'day' ? `${dayOf(k).label} — ${dayOf(k).short}` : group === 'venue' ? venueName(k) : k, m.get(k)]);
    }
    box.innerHTML = head + groups.map(([label, ts]) => `${label ? `<div class="ghead">${esc(label)} <small>${ts.length}</small></div>` : ''}${ts.map(row).join('')}`).join('');
  }
  box.querySelectorAll('.stsel').forEach((s) => { s.onclick = (e) => e.stopPropagation(); s.onchange = async () => { await api('PUT', '/api/tasks/' + s.dataset.id, { status: s.value }); toast('Status updated'); refresh(); }; });
  box.querySelectorAll('[data-toggle]').forEach((r) => r.onclick = () => { const id = r.dataset.toggle; open.has(id) ? open.delete(id) : open.add(id); renderTasks(); });
  box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => taskDialog(S.tasks.find((t) => t.id === b.dataset.edit)));
  box.querySelectorAll('[data-remind]').forEach((b) => b.onclick = async () => {
    try { const r = await api('POST', `/api/tasks/${b.dataset.remind}/remind`); toast('Reminder queued — it is emailed within about 10 minutes'); }
    catch (e) { toast('Failed: ' + e.message); }
  });
  box.querySelectorAll('.row[draggable]').forEach((c) => c.ondragstart = (e) => e.dataTransfer.setData('id', c.dataset.id));
  box.querySelectorAll('.col').forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = async (e) => { e.preventDefault(); await api('PUT', '/api/tasks/' + e.dataTransfer.getData('id'), { status: col.dataset.col }); refresh(); };
  });
}

/* ---------- dialog ---------- */
function openDialog(title, body, onSave, extra = '') {
  const f = $('#form');
  f.innerHTML = `<div class="dh"><h2>${esc(title)}</h2><button type="button" id="x">×</button></div><div class="db">${body}</div>
    <div class="df">${extra}<button type="button" class="btn" id="cancel">Cancel</button><button type="submit" class="btn primary">Save</button></div>`;
  f.onsubmit = async (e) => { e.preventDefault(); try { await onSave(new FormData(f), f); $('#dlg').close(); refresh(); } catch (er) { toast(er.message); } };
  $('#x').onclick = $('#cancel').onclick = () => $('#dlg').close();
  $('#dlg').showModal();
}
const opts = (arr, sel) => arr.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');

function taskDialog(t) {
  const isNew = !t;
  t = t || { title: '', day: day === 'all' ? 'setup' : day, startDate: dayOf(day === 'all' ? 'setup' : day).date, startTime: '09:00', eta: '', venue: 'all', category: 'Other', priority: 'medium', status: 'todo', leadName: '', leadEmail: '', leadPhone: '', team: [], description: '', notes: '', reminderHours: [] };
  const startDate = t.startDate || dayOf(t.day).date, etaDate = t.eta ? t.eta.slice(0, 10) : startDate, etaTime = t.eta ? t.eta.slice(11, 16) : '12:00';
  const body = `<div class="fg">
    <div class="full"><label>Task title *</label><input name="title" required value="${esc(t.title)}"></div>
    <div class="full"><label>Description</label><textarea name="description" rows="2">${esc(t.description)}</textarea></div>
    <div><label>Venue / area</label><select name="venue">${opts(S.venues.map((v) => [v.id, v.name]), t.venue)}</select></div>
    <div><label>Department</label><select name="category">${opts([...new Set([...CATS, t.category])].map((c) => [c, c]), t.category)}</select></div>
    <div><label>Priority</label><select name="priority">${opts([['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], t.priority)}</select></div>
    <div class="full"><label>Status</label><select name="status">${opts(Object.entries(STATUS), t.status)}</select></div>
    <div class="sect">Schedule (Pacific time)</div>
    <div><label>Start date</label><input type="date" name="startDate" required min="2027-07-01" max="2027-07-05" value="${startDate}"></div>
    <div><label>Start time</label><input type="time" name="startTime" required value="${esc(t.startTime)}"></div>
    <div><label>End date (ETA)</label><input type="date" name="etaDate" required min="2027-07-01" max="2027-07-05" value="${etaDate}"></div>
    <div><label>End time (ETA)</label><input type="time" name="etaTime" required value="${etaTime}"></div>
    <div class="sect">Lead point of contact</div>
    <div><label>Name</label><input name="leadName" value="${esc(t.leadName)}"></div>
    <div><label>Phone</label><input name="leadPhone" type="tel" value="${esc(t.leadPhone)}" placeholder="+1 408 555 0100"></div>
    <div class="full"><label>Email (receives reminders)</label><input name="leadEmail" type="email" value="${esc(t.leadEmail)}"></div>
    <div class="sect">Team members on this task</div>
    <div class="full" id="team"></div>
    <div class="full"><button type="button" class="btn sm" id="addMem">+ Add person</button></div>
    <div class="sect">Reminders</div>
    <div class="full"><label>Email reminders — hours before ETA (comma separated; blank = global default ${S.settings.reminderHours.join(', ')})</label><input name="reminderHours" value="${esc((t.reminderHours || []).join(', '))}" placeholder="24, 2"></div>
    <div class="full"><label>Notes</label><textarea name="notes" rows="2">${esc(t.notes)}</textarea></div>
  </div>`;
  const del = isNew || !isAdmin() ? '' : '<button type="button" class="btn danger" id="del" style="margin-right:auto">Delete</button>';
  openDialog(isNew ? 'Add task' : 'Edit task', body, async (fd) => {
    const team = [...document.querySelectorAll('.mem')].map((r) => ({ name: r.children[0].value, email: r.children[1].value, phone: r.children[2].value })).filter((p) => p.name || p.email);
    const payload = Object.fromEntries(fd.entries());
    payload.eta = payload.etaDate && payload.etaTime ? `${payload.etaDate}T${payload.etaTime}` : '';
    payload.team = team;
    payload.reminderHours = (payload.reminderHours || '').split(',').map((x) => Number(x.trim())).filter((n) => n > 0);
    await api(isNew ? 'POST' : 'PUT', isNew ? '/api/tasks' : '/api/tasks/' + t.id, payload);
    toast(isNew ? 'Task added' : 'Task saved');
  }, del);
  if (!isAdmin()) {
    document.querySelectorAll('#form input,#form select,#form textarea').forEach((el) => { if (!['status', 'notes'].includes(el.name)) el.disabled = true; });
    $('#addMem').hidden = true; document.querySelectorAll('#team .mem button').forEach((b) => b.hidden = true);
  }
  const addMem = (p = {}) => {
    const r = document.createElement('div'); r.className = 'mem';
    r.innerHTML = `<input placeholder="Name" value="${esc(p.name)}"><input type="email" placeholder="Email" value="${esc(p.email)}"><input type="tel" placeholder="Phone" value="${esc(p.phone)}"><button type="button" class="btn sm danger">✕</button>`;
    r.lastChild.onclick = () => r.remove(); $('#team').appendChild(r);
  };
  (t.team || []).forEach(addMem); $('#addMem').onclick = () => addMem();
  if (!isNew && $('#del')) $('#del').onclick = async () => { if (confirm('Delete this task?')) { await api('DELETE', '/api/tasks/' + t.id); $('#dlg').close(); refresh(); } };
}

/* ---------- key times ---------- */
function renderSchedule() {
  $('#v-schedule').innerHTML = `<div class="panel"><h2>Key start times</h2><p class="hint">When venue setup, tents, AV and other crews start each day. Seeded times are placeholders — edit to match the contracts.</p>
    ${isAdmin() ? '<button class="btn gold" id="addMs">+ Add key time</button>' : ''}</div>` + S.days.map((d) => {
    const ms = S.milestones.filter((m) => m.day === d.key).sort((a, b) => a.time.localeCompare(b.time));
    return `<div class="panel"><h2 style="font-size:18px">${esc(d.label)} <small style="font-family:Inter;color:var(--mut);font-size:13px">· ${esc(d.short)}</small></h2>
      <table><tr><th>Time</th><th>What</th><th>Category</th><th>Venue</th><th></th></tr>${ms.map((m) => `<tr><td><b>${fmtTime(m.time)}</b></td><td>${esc(m.label)}</td><td><span class="chip cat">${esc(m.category)}</span></td><td>${esc(venueName(m.venue))}</td><td>${isAdmin() ? `<button class="btn sm" data-em="${m.id}">Edit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" style="color:var(--mut)">Nothing scheduled.</td></tr>'}</table></div>`;
  }).join('');
  if ($('#addMs')) $('#addMs').onclick = () => msDialog();
  document.querySelectorAll('[data-em]').forEach((b) => b.onclick = () => msDialog(S.milestones.find((m) => m.id === b.dataset.em)));
}
function msDialog(m) {
  const isNew = !m; m = m || { day: 'setup', time: '08:00', label: '', venue: 'all', category: 'Venue' };
  openDialog(isNew ? 'Add key time' : 'Edit key time', `<div class="fg">
    <div class="full"><label>What starts</label><input name="label" required value="${esc(m.label)}" placeholder="e.g. AV crew starts"></div>
    <div><label>Day</label><select name="day">${opts(S.days.map((d) => [d.key, `${d.label} — ${d.short}`]), m.day)}</select></div>
    <div><label>Time (PT)</label><input type="time" name="time" required value="${m.time}"></div>
    <div><label>Venue</label><select name="venue">${opts(S.venues.map((v) => [v.id, v.name]), m.venue)}</select></div>
    <div><label>Department</label><select name="category">${opts([...new Set([...CATS, m.category])].map((c) => [c, c]), m.category)}</select></div></div>`,
  async (fd) => { await api(isNew ? 'POST' : 'PUT', isNew ? '/api/milestones' : '/api/milestones/' + m.id, Object.fromEntries(fd.entries())); },
  isNew ? '' : '<button type="button" class="btn danger" id="delm" style="margin-right:auto">Delete</button>');
  if (!isNew) $('#delm').onclick = async () => { await api('DELETE', '/api/milestones/' + m.id); $('#dlg').close(); refresh(); };
}

/* ---------- venues ---------- */
function renderVenues() {
  $('#v-venues').innerHTML = `<div class="panel"><h2>Venue — Cow Palace</h2><p class="hint">2600 Geneva Avenue, Daly City, CA 94014 · Details from <a href="https://nabc2027.org/venue" target="_blank" rel="noopener">nabc2027.org/venue</a></p></div>
  <div class="grid2">${S.venues.map((v) => {
    const ts = S.tasks.filter((t) => t.venue === v.id), done = ts.filter((t) => t.status === 'done').length;
    return `<div class="venue"><h3>${esc(v.name)}</h3><p>${esc(v.notes)}</p><div class="cnt">${ts.length} tasks · ${done} done</div>
      <div style="margin-top:8px"><button class="btn sm" data-vf="${v.id}">View tasks</button> ${isAdmin() ? `<button class="btn sm" data-ve="${v.id}">Edit notes</button>` : ''}</div></div>`;
  }).join('')}</div>`;
  document.querySelectorAll('[data-vf]').forEach((b) => b.onclick = () => { view = 'plan'; day = 'all'; render(); $('#fVenue').value = b.dataset.vf; renderTasks(); });
  document.querySelectorAll('[data-ve]').forEach((b) => b.onclick = () => {
    const v = S.venues.find((x) => x.id === b.dataset.ve);
    openDialog('Notes — ' + v.name, `<textarea name="notes" rows="6">${esc(v.notes)}</textarea>`, (fd) => api('PUT', '/api/venues/' + v.id, { notes: fd.get('notes') }));
  });
}

/* ---------- people ---------- */
function renderPeople() {
  const m = new Map();
  const add = (p, task, role) => {
    const key = (p.email || p.name || '').toLowerCase(); if (!key) return;
    if (!m.has(key)) m.set(key, { name: p.name, email: p.email, phone: p.phone, tasks: [] });
    const e = m.get(key); e.name = e.name || p.name; e.phone = e.phone || p.phone; e.tasks.push({ task, role });
  };
  S.tasks.forEach((t) => { add({ name: t.leadName, email: t.leadEmail, phone: t.leadPhone }, t, 'Lead'); (t.team || []).forEach((p) => add(p, t, 'Team')); });
  const rows = [...m.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  $('#v-people').innerHTML = `<div class="panel"><h2>People</h2><p class="hint">Everyone assigned to a task. Add people by editing a task.</p>
    <table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Tasks</th><th>Open</th></tr>${rows.map((p) => `<tr><td><b>${esc(p.name || '—')}</b></td><td>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '—'}</td><td>${esc(p.phone || '—')}</td>
    <td>${p.tasks.map((x) => `<div>${x.role === 'Lead' ? '★ ' : ''}${esc(x.task.title)}</div>`).join('')}</td><td>${p.tasks.filter((x) => x.task.status !== 'done').length}</td></tr>`).join('') || '<tr><td colspan="5" style="color:var(--mut)">No one assigned yet.</td></tr>'}</table></div>`;
}

/* ---------- reminders / settings ---------- */
async function renderSettings() {
  const log = await api('GET', '/api/outbox');
  const up = S.tasks.filter((t) => t.status !== 'done' && t.eta && etaMs(t) > Date.now() && (t.leadEmail || (t.team || []).some((p) => p.email))).sort((a, b) => etaMs(a) - etaMs(b)).slice(0, 10);
  $('#v-settings').innerHTML = `<div class="panel"><h2>Email reminders</h2>
    <p><span class="pill ok">Sent by a scheduled GitHub Actions job (about every 10 minutes)</span></p>
    <p class="hint">The server checks every minute and emails the lead POC and team members as each task's ETA approaches, plus one overdue notice. Tasks marked <b>Done</b> never send. Reminders need the SMTP secrets set in the GitHub repo (see README).</p>
    <div class="fg"><div><label>Default reminders (hours before ETA)</label><input id="rh" value="${S.settings.reminderHours.join(', ')}"></div>
    <div><label>Overdue notice</label><select id="od"><option value="1" ${S.settings.overdueReminder ? 'selected' : ''}>On</option><option value="0" ${!S.settings.overdueReminder ? 'selected' : ''}>Off</option></select></div></div>
    <p><button class="btn primary" id="saveSet">Save settings</button></p></div>
    <div class="panel"><h2 style="font-size:18px">Next reminders to fire</h2><table><tr><th>Task</th><th>ETA</th><th>Recipients</th></tr>${up.map((t) => `<tr><td>${esc(t.title)}</td><td>${esc(fmtEta(t.eta))}</td><td>${[t.leadEmail, ...(t.team || []).map((p) => p.email)].filter(Boolean).map(esc).join(', ')}</td></tr>`).join('') || '<tr><td colspan="3" style="color:var(--mut)">No upcoming tasks with an email address yet.</td></tr>'}</table></div>
    <div class="panel"><h2 style="font-size:18px">Sent / logged</h2><pre class="log">${log.length ? esc(log.join('\n')) : 'Nothing yet.'}</pre></div>`;
  $('#saveSet').onclick = async () => {
    await api('PUT', '/api/settings', { reminderHours: $('#rh').value.split(',').map((x) => Number(x.trim())).filter((n) => n > 0), overdueReminder: $('#od').value === '1' });
    toast('Settings saved'); refresh();
  };
}

(async () => {
  try { await completeLinkIfPresent(); } catch (e) { showLogin('That sign-in link is invalid or expired. Request a new one.'); }
  onUser(start);
})();
