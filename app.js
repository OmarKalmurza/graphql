const API_URL = 'https://01yessenov.yu.edu.kz/api/graphql-engine/v1/graphql';
const AUTH_URL = 'https://01yessenov.yu.edu.kz/api/auth/signin';
let JWT = null;

async function doLogin() {
  const user = document.getElementById('login-input').value.trim();
  const pass = document.getElementById('pass-input').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  errEl.classList.remove('show');
  if (!user || !pass) { showError('Please enter credentials.'); return; }

  btn.classList.add('loading');
  btn.textContent = 'CONNECTING...';

  try {
    const creds = btoa(`${user}:${pass}`);
    const res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}` }
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `HTTP ${res.status}`);
    }

    const data = await res.json();
    JWT = typeof data === 'string' ? data : data.token || data.jwt || data;

    if (!JWT || typeof JWT !== 'string') throw new Error('Invalid token received');

    sessionStorage.setItem('jwt', JWT);
    showProfile();

  } catch (e) {
    showError('Invalid credentials or server error. Please try again.');
    btn.classList.remove('loading');
    btn.textContent = 'AUTHENTICATE';
  }
}

function showError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.add('show');
}

document.getElementById('pass-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

function doLogout() {
  JWT = null;
  sessionStorage.removeItem('jwt');
  document.getElementById('profile-page').style.display = 'none';
  document.getElementById('login-page').style.display = 'flex';
}

async function gql(query, variables = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${JWT}`
    },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

async function showProfile() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('profile-page').style.display = 'block';
  document.getElementById('loader').classList.add('show');

  try {

    const userData = await gql(`{ user { id login } }`);
    const user = userData.user[0];
    if (!user) throw new Error('No user found');

    document.getElementById('user-login').textContent = user.login.toUpperCase();
    document.getElementById('user-id').textContent = `ID: ${user.id}`;
    document.getElementById('avatar-initials').textContent = user.login.substring(0,2).toUpperCase();
    document.getElementById('header-login').textContent = user.login.toUpperCase();

    const xpData = await gql(`
      query($uid: Int!) {
        transaction(
          where: { userId: { _eq: $uid }, type: { _eq: "xp" } }
          order_by: { createdAt: asc }
        ) {
          id amount createdAt path
          object { name }
        }
      }
    `, { uid: user.id });

    const txns = xpData.transaction || [];
    const totalXP = txns.reduce((s, t) => s + t.amount, 0);
 
    animateCounter('xp-total', totalXP, formatXP);
    setTimeout(() => {
      document.getElementById('xp-bar').style.width = '100%';
    }, 300);


    let auditUp = 0, auditDown = 0;
    try {
      const auditData = await gql(`
        query($uid: Int!) {
          up: transaction_aggregate(where: { userId: { _eq: $uid }, type: { _eq: "up" } }) {
            aggregate { sum { amount } }
          }
          down: transaction_aggregate(where: { userId: { _eq: $uid }, type: { _eq: "down" } }) {
            aggregate { sum { amount } }
          }
        }
      `, { uid: user.id });
      auditUp = auditData.up?.aggregate?.sum?.amount || 0;
      auditDown = auditData.down?.aggregate?.sum?.amount || 0;
    } catch(e) {
     
    }

    animateCounter('audit-up', auditUp, v => Math.round(v / 1000) + 'k');
    animateCounter('audit-down', auditDown, v => Math.round(v / 1000) + 'k');
    const ratio = auditDown > 0 ? (auditUp / auditDown).toFixed(1) : '∞';
    document.getElementById('ratio-val').textContent = ratio;
    const ratioBarPct = auditDown > 0 ? Math.min(100, (auditUp / auditDown) * 50) : 80;
    setTimeout(() => {
      document.getElementById('ratio-bar').style.width = ratioBarPct + '%';
    }, 400);
 
    const resultData = await gql(`
      query($uid: Int!) {
        result(
          where: { userId: { _eq: $uid } }
          order_by: { createdAt: desc }
          limit: 200
        ) {
          id grade createdAt path
          object { name type }
        }
      }
    `, { uid: user.id });

    const results = resultData.result || [];
    const projects = results.filter(r => r.object?.type === 'project' || r.path?.includes('div-'));
    const passed = projects.filter(r => r.grade >= 1).length;
    const failed = projects.filter(r => r.grade < 1).length;
    const total = projects.length || results.length;
    const passedAll = results.filter(r => r.grade >= 1).length;
    const failedAll = results.filter(r => r.grade < 1).length;
    const totalAll = results.length;

    document.getElementById('stat-total').textContent = totalAll;
    document.getElementById('stat-pass').textContent = passedAll;
    document.getElementById('stat-fail').textContent = failedAll;
    const passRate = totalAll > 0 ? Math.round((passedAll/totalAll)*100) : 0;
    document.getElementById('stat-rate').textContent = passRate + '%';

  
    drawXPOverTime(txns);
    drawDonut(passedAll, failedAll, passRate);
    drawTopProjectsBars(txns);
    renderRecentTransactions(txns);

  } catch(e) {
    console.error(e);
    document.getElementById('user-login').textContent = 'ERROR';
    document.getElementById('user-id').textContent = e.message;
  } finally {
    document.getElementById('loader').classList.remove('show');
  }
}


function drawXPOverTime(txns) {
  const svg = document.getElementById('svg-xp');
  svg.innerHTML = '';
  if (!txns.length) return;

  const W = svg.clientWidth || 400;
  const H = 220;
  const PAD = { top:10, right:20, bottom:35, left:60 };
  const W2 = W - PAD.left - PAD.right;
  const H2 = H - PAD.top - PAD.bottom;


  let cum = 0;
  const pts = txns.map(t => {
    cum += t.amount;
    return { date: new Date(t.createdAt), xp: cum };
  });

  const minD = pts[0].date, maxD = pts[pts.length-1].date;
  const maxXP = pts[pts.length-1].xp;

  function xScale(d) {
    return PAD.left + ((d - minD) / (maxD - minD || 1)) * W2;
  }
  function yScale(v) {
    return PAD.top + H2 - (v / maxXP) * H2;
  }


  const defs = makeSVGEl('defs');
  const grad = makeSVGEl('linearGradient', { id:'areaGrad', x1:'0',y1:'0',x2:'0',y2:'1' });
  grad.innerHTML = `
    <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.3"/>
    <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
  `;
  defs.appendChild(grad);
  svg.appendChild(defs);

 
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (H2 / 4) * i;
    const xpVal = Math.round(maxXP - (maxXP / 4) * i);
    svg.appendChild(makeSVGEl('line', { x1:PAD.left, y1:y, x2:PAD.left+W2, y2:y, class:'grid-line' }));
    svg.appendChild(makeSVGEl('text', {
      x: PAD.left - 6, y: y + 4, class:'axis-label', 'text-anchor':'end'
    }, formatXP(xpVal)));
  }

 
  const step = Math.max(1, Math.floor(pts.length / 5));
  let last = ""; 

  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    const x = xScale(p.date);
    const text = p.date.toLocaleDateString('en-US', { month:'short', year:'2-digit' });

    if (text === last) continue; 
    last = text; 

    svg.appendChild(makeSVGEl('text', {
      x, y: H - 5, class:'axis-label', 'text-anchor':'middle'
    }, text));
  }

 
  let areaD = `M ${xScale(pts[0].date)} ${PAD.top + H2}`;
  pts.forEach(p => areaD += ` L ${xScale(p.date)} ${yScale(p.xp)}`);
  areaD += ` L ${xScale(pts[pts.length-1].date)} ${PAD.top+H2} Z`;
  svg.appendChild(makeSVGEl('path', { d: areaD, class:'chart-area' }));


  let lineD = `M ${xScale(pts[0].date)} ${yScale(pts[0].xp)}`;
  pts.forEach((p, i) => { if(i > 0) lineD += ` L ${xScale(p.date)} ${yScale(p.xp)}`; });
  const path = makeSVGEl('path', { d: lineD, class:'chart-line' });
  const pathLen = (pts.length * 5);
  path.style.strokeDasharray = pathLen;
  path.style.strokeDashoffset = pathLen;
  path.style.animation = `drawLine 2s ease forwards`;
  svg.appendChild(path);


  const dotStep = Math.max(1, Math.floor(pts.length / 12));
  pts.forEach((p, i) => {
    if (i % dotStep !== 0 && i !== pts.length - 1) return;
    const cx = xScale(p.date), cy = yScale(p.xp);
    const dot = makeSVGEl('circle', { cx, cy, r:3, class:'data-dot' });
    dot.style.animationDelay = `${1.5 + i/pts.length * 0.5}s`;

  
    dot.addEventListener('mouseenter', (e) => {
      showTooltip(e, `${p.date.toLocaleDateString()} — ${formatXP(p.xp)} XP`);
    });
    dot.addEventListener('mouseleave', hideTooltip);
    svg.appendChild(dot);
  });
}


function drawDonut(passed, failed, pct) {
  const circ = 2 * Math.PI * 50; 
  document.getElementById('donut-pass-n').textContent = passed;
  document.getElementById('donut-fail-n').textContent = failed;
  document.getElementById('donut-pct').textContent = pct + '%';

  const total = passed + failed || 1;
  const passDash = (passed / total) * circ;
  const failDash = (failed / total) * circ;
  const passOffset = 0;
  const failOffset = -passDash;

  setTimeout(() => {
    const passEl = document.getElementById('donut-pass');
    const failEl = document.getElementById('donut-fail');
    passEl.style.strokeDasharray = `${passDash} ${circ - passDash}`;
    passEl.style.strokeDashoffset = `${passOffset}`;
    failEl.style.strokeDasharray = `${failDash} ${circ - failDash}`;
    failEl.style.strokeDashoffset = `${failOffset}`;
  }, 300);
}


function drawTopProjectsBars(txns) {
  const svg = document.getElementById('svg-bars');
  svg.innerHTML = '';
  if (!txns.length) return;

 
  const map = {};
  txns.forEach(t => {
    const name = t.object?.name || t.path?.split('/').pop() || 'unknown';
    map[name] = (map[name] || 0) + t.amount;
  });

  const sorted = Object.entries(map)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 8);

  const W = svg.clientWidth || 600;
  const H = 200;
  const barH = 18;
  const gap = 6;
  const labelW = 160;
  const PAD_L = labelW + 10;
  const PAD_R = 60;
  const maxXP = sorted[0][1];
  const availW = W - PAD_L - PAD_R;

  sorted.forEach(([name, xp], i) => {
    const y = i * (barH + gap) + 10;
    const barW = (xp / maxXP) * availW;

   
    const lbl = makeSVGEl('text', {
      x: labelW, y: y + barH * 0.75,
      class: 'skill-label', 'text-anchor': 'end'
    }, name.length > 22 ? name.substring(0,22)+'…' : name);
    svg.appendChild(lbl);

    
    svg.appendChild(makeSVGEl('rect', {
      x: PAD_L, y, width: availW, height: barH, class: 'skill-bar-bg', rx: 1
    }));

   
    const fill = makeSVGEl('rect', {
      x: PAD_L, y, width: 0, height: barH, rx: 1,
      fill: i % 2 === 0 ? 'var(--accent)' : 'var(--accent2)',
      opacity: 0.85
    });
    fill.style.filter = `drop-shadow(0 0 4px ${i%2===0?'var(--accent)':'var(--accent2)'})`;
    svg.appendChild(fill);

    setTimeout(() => {
      fill.setAttribute('width', barW);
      fill.style.transition = 'width 0.8s ease';
    }, 100 + i * 80);

    
    const val = makeSVGEl('text', {
      x: PAD_L + availW + 6, y: y + barH * 0.75,
      class: 'skill-val'
    }, formatXP(xp));
    svg.appendChild(val);
  });


  svg.setAttribute('height', sorted.length * (barH + gap) + 20);
}


function renderRecentTransactions(txns) {
  const el = document.getElementById('projects-list');
  const recent = [...txns].reverse().slice(0, 10);

  if (!recent.length) {
    el.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem">No data</div>';
    return;
  }

  el.innerHTML = recent.map(t => {
    const name = t.object?.name || t.path?.split('/').pop() || '—';
    const date = new Date(t.createdAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    return `
      <div class="project-item">
        <span class="project-name">${escHtml(name)}</span>
        <span class="project-date">${date}</span>
        <span class="project-xp">+${formatXP(t.amount)} XP</span>
      </div>
    `;
  }).join('');
}


function makeSVGEl(tag, attrs = {}, text = null) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  if (text !== null) el.textContent = text;
  return el;
}

function formatXP(v) {
  if (v >= 1000000) return (v/1000000).toFixed(1) + 'M';
  if (v >= 1000) return (v/1000).toFixed(1) + 'k';
  return Math.round(v).toString();
}

function animateCounter(id, target, fmt = v => Math.round(v)) {
  const el = document.getElementById(id);
  const dur = 1200;
  const start = Date.now();
  function tick() {
    const t = Math.min(1, (Date.now() - start) / dur);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(target * ease);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = fmt(target);
  }
  tick();
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showTooltip(e, text) {
  const t = document.getElementById('tooltip');
  t.textContent = text;
  t.style.display = 'block';
  t.style.left = (e.clientX + 12) + 'px';
  t.style.top = (e.clientY - 30) + 'px';
}
function hideTooltip() {
  document.getElementById('tooltip').style.display = 'none';
}
document.addEventListener('mousemove', e => {
  const t = document.getElementById('tooltip');
  if (t.style.display === 'block') {
    t.style.left = (e.clientX + 12) + 'px';
    t.style.top = (e.clientY - 30) + 'px';
  }
});


window.addEventListener('load', () => {
  const stored = sessionStorage.getItem('jwt');
  if (stored) {
    JWT = stored;
    showProfile();
  }
});
