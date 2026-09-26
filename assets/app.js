/* ============================================================
   ORBIT v2.0 — Sarman Printing Job Tracking System
   Shared Application Logic — Supabase-backed edition
   ------------------------------------------------------------
   - All data persists to Supabase (Postgres) + a fast localStorage
     cache so every page keeps its original synchronous logic.
   - Login is real Supabase Auth (email + password). The first
     user to log in automatically becomes the IT Administrator.
   - NO dummy accounts, NO demo jobs, NO seed data. Fresh start.
   ============================================================ */

// 14 production stages
const ORBIT_STAGES = [
  {name:"Sales", group:"Order Intake"},
  {name:"Design", group:"Order Intake"},
  {name:"Planner", group:"Order Intake"},
  {name:"Cutter", group:"Production"},
  {name:"Printing", group:"Production"},
  {name:"Lamination", group:"Finishing"},
  {name:"Spot UV", group:"Finishing"},
  {name:"Stamping", group:"Finishing"},
  {name:"Emboss", group:"Finishing"},
  {name:"Deboss", group:"Finishing"},
  {name:"Die Cut", group:"Finishing"},
  {name:"Glue", group:"Finishing"},
  {name:"Final QC", group:"Delivery"},
  {name:"Delivery", group:"Delivery"}
];

// All page slugs for permission system
const ALL_PAGES = [
  "dashboard.html", "admin.html",
  "sales.html", "new-order.html",
  "designer.html", "submit-design.html",
  "planner.html",
  "production.html", "log-output.html",
  "delivery.html"
];

// Page labels for UI
const PAGE_LABELS = {
  "dashboard.html": "Dashboard (Boss)",
  "admin.html": "Admin Panel",
  "sales.html": "Sales Queue",
  "new-order.html": "Create New Order",
  "designer.html": "Design Queue",
  "submit-design.html": "Submit Design",
  "planner.html": "Planner / Job Sheet",
  "production.html": "Production Floor",
  "log-output.html": "Log Output",
  "delivery.html": "Delivery Management"
};

// FRESH START — no default employees. Accounts are created by the
// IT Administrator in the Admin panel (auth users live in Supabase).
const DEFAULT_EMPLOYEES = [];

// Navigation items
const ORBIT_NAV_ITEMS = [
  {slug:"dashboard.html", label:"Dashboard"},
  {slug:"admin.html", label:"Admin"},
  {slug:"sales.html", label:"Sales"},
  {slug:"designer.html", label:"Design"},
  {slug:"planner.html", label:"Planner"},
  {slug:"production.html", label:"Production"},
  {slug:"delivery.html", label:"Delivery"}
];

/* ============================================================
   SUPABASE SYNC LAYER
   localStorage is the fast synchronous cache; Supabase is the
   shared source of truth. Writes go to both. A background pull
   keeps every device in sync.
   ============================================================ */
function orbitSB(){ return (window.ORBIT_SB_ENABLED && window.sbClient) ? window.sbClient : null; }

function orbitSyncPushProfiles(){
  const sb = orbitSB(); if(!sb) return Promise.resolve();
  const emps = orbitGetEmployees();
  const rows = emps.map(e => ({
    emp_id:   typeof e.id === "number" ? e.id : parseInt(e.id, 10) || 0,
    user_uuid: e.uuid || null,
    email:    (e.email || "").toLowerCase(),
    name:     e.name || "",
    surname:  e.surname || "",
    initials: e.initials || orbitGenerateInitials(e.name || "?"),
    role:     e.role || "Staff",
    dept:     e.dept || "General",
    landing:  e.landing || "dashboard.html",
    pages:    e.pages || ["dashboard.html"],
    active:   e.active !== false
  }));
  const localIds = rows.map(r => r.emp_id);
  return sb.from("profiles").upsert(rows, {onConflict:"emp_id"}).then(({error}) => {
    if(error){ console.warn("[ORBIT] profiles push failed:", error.message); return; }
    // remove employees deleted in the admin panel from the remote table too
    if(localIds.length === 0) return sb.from("profiles").delete().gte("emp_id", 0);
    return sb.from("profiles").delete().not("emp_id", "in", "(" + localIds.join(",") + ")");
  }).then(() => {}).catch(err => console.warn("[ORBIT] profiles push error:", err));
}

function orbitSyncPushJobs(){
  const sb = orbitSB(); if(!sb) return Promise.resolve();
  const jobs = orbitGetJobs();
  const rows = jobs.map(j => ({
    job_id:     j.id,
    client:     j.client || null,
    stage:      typeof j.stage === "number" ? j.stage : 0,
    status:     j.status || "waiting",
    urgent:     j.urgent || "normal",
    created_at: j.createdAt || null,
    data:       j
  }));
  return sb.from("jobs").upsert(rows, {onConflict:"job_id"}).then(({error}) => {
    if(error) console.warn("[ORBIT] jobs push failed:", error.message);
  }).catch(err => console.warn("[ORBIT] jobs push error:", err));
}

function orbitSyncPushNotifications(){
  const sb = orbitSB(); if(!sb) return Promise.resolve();
  const notifs = orbitGetNotifications();
  const rows = notifs.slice(0, 500).map(n => ({ notif_id: String(n.id), data: n }));
  return sb.from("notifications").upsert(rows, {onConflict:"notif_id"}).then(({error}) => {
    if(error) console.warn("[ORBIT] notifications push failed:", error.message);
  }).catch(err => console.warn("[ORBIT] notifications push error:", err));
}

// Pull latest from Supabase and merge into local cache.
// Returns a promise. On first-ever load (cache empty, remote has data)
// it reloads the page once so everything renders with real data.
let orbitSyncPullRunning = false;
function orbitSyncPull(){
  const sb = orbitSB();
  if(!sb || orbitSyncPullRunning) return Promise.resolve();
  orbitSyncPullRunning = true;
  const localEmpty = !localStorage.getItem("orbit_jobs") && !localStorage.getItem("orbit_employees");
  return Promise.all([
    sb.from("profiles").select("*").order("emp_id", {ascending:true}),
    sb.from("jobs").select("*").order("created_at", {ascending:false}),
    sb.from("notifications").select("*").order("id", {ascending:false}).limit(500)
  ]).then(([pRes, jRes, nRes]) => {
    // profiles -> employees
    if(pRes.data){
      const remoteEmps = (pRes.data || []).map(r => ({
        id: r.emp_id, uuid: r.user_uuid || null,
        email: r.email, name: r.name, surname: r.surname,
        initials: r.initials, role: r.role, dept: r.dept,
        landing: r.landing, pages: r.pages || ["dashboard.html"],
        active: r.active !== false
      }));
      // merge: remote as base, local unsynced edits win (never wipe a just-added employee)
      const byId = {};
      remoteEmps.forEach(e => { byId[e.id] = e; });
      try { orbitGetEmployees().forEach(e => { byId[e.id] = e; }); } catch(e){}
      const emps = Object.values(byId).sort((a,b) => (a.id||0) - (b.id||0));
      localStorage.setItem("orbit_employees", JSON.stringify(emps));
    }
    // jobs
    if(jRes.data){
      const remoteJobs = (jRes.data || []).map(r => Object.assign({}, r.data, { id: r.job_id }));
      // merge: remote as base, local unsynced jobs/updates win (never wipe a just-created order)
      const byId = {};
      remoteJobs.forEach(j => { byId[j.id] = j; });
      try { orbitGetJobs().forEach(j => { byId[j.id] = j; }); } catch(e){}
      const jobs = Object.values(byId).sort((a,b) => String(a.id).localeCompare(String(b.id)));
      localStorage.setItem("orbit_jobs", JSON.stringify(jobs));
    }
    // notifications (merge, dedupe by id)
    if(nRes.data){
      const remote = (nRes.data || []).map(r => r.data).filter(Boolean);
      const local = orbitGetNotifications();
      const seen = {}; const merged = [];
      [].concat(local, remote).forEach(n => { if(n && n.id && !seen[n.id]){ seen[n.id]=true; merged.push(n); } });
      merged.sort((a,b) => (b.id||0) - (a.id||0));
      localStorage.setItem("orbit_notifications", JSON.stringify(merged.slice(0, 500)));
    }
    orbitRefreshUsers();
    const remoteHasData = (jRes.data && jRes.data.length) || (pRes.data && pRes.data.length);
    if(localEmpty && remoteHasData && !sessionStorage.getItem("orbit_reloaded")){
      sessionStorage.setItem("orbit_reloaded", "1");
      location.reload();
    }
  }).catch(err => console.warn("[ORBIT] sync pull error:", err))
    .then(() => { orbitSyncPullRunning = false; });
}
function orbitPullOnce(){ return orbitSyncPull(); }

/* ============================================================
   LOCAL STORAGE CACHE — Employee & Data Persistence
   ============================================================ */
function orbitGetEmployees(){
  const stored = localStorage.getItem("orbit_employees");
  if(stored){
    try { return JSON.parse(stored); } catch(e){}
  }
  localStorage.setItem("orbit_employees", JSON.stringify(DEFAULT_EMPLOYEES));
  return [...DEFAULT_EMPLOYEES];
}
function orbitSaveEmployees(emps){
  localStorage.setItem("orbit_employees", JSON.stringify(emps));
  orbitSyncPushProfiles();
}
function orbitGetEmployeeByEmail(email){
  return orbitGetEmployees().find(e => (e.email||"").toLowerCase() === (email||"").toLowerCase());
}
function orbitGetEmployeeById(id){
  return orbitGetEmployees().find(e => e.id === parseInt(id));
}
function orbitAddEmployee(emp){
  const emps = orbitGetEmployees();
  emp.id = emps.length > 0 ? Math.max(...emps.map(e => e.id)) + 1 : 0;
  emp.active = true;
  if(!emp.initials) emp.initials = orbitGenerateInitials(emp.name || "?");
  emps.push(emp);
  orbitSaveEmployees(emps);
  return emp;
}
function orbitUpdateEmployee(id, updates){
  const emps = orbitGetEmployees();
  const idx = emps.findIndex(e => e.id === parseInt(id));
  if(idx !== -1){
    emps[idx] = {...emps[idx], ...updates};
    orbitSaveEmployees(emps);
    return emps[idx];
  }
  return null;
}
function orbitDeleteEmployee(id){
  const emps = orbitGetEmployees();
  const filtered = emps.filter(e => e.id !== parseInt(id));
  orbitSaveEmployees(filtered);
}
function orbitGenerateInitials(name){
  if(!name) return "??";
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').substring(0,2).toUpperCase() || "??";
}

// Also expose users array for backward compatibility
let ORBIT_USERS = orbitGetEmployees();
function orbitRefreshUsers(){ ORBIT_USERS = orbitGetEmployees(); }

/* ============================================================
   NOTIFICATION SYSTEM
   ============================================================ */
function orbitGetNotifications(){
  const stored = localStorage.getItem("orbit_notifications");
  if(stored){
    try { return JSON.parse(stored); } catch(e){}
  }
  return [];
}
function orbitSaveNotifications(notifs){
  localStorage.setItem("orbit_notifications", JSON.stringify(notifs));
  orbitSyncPushNotifications();
}
function orbitAddNotification(notification){
  const notifs = orbitGetNotifications();
  notifs.unshift({
    id: Date.now(),
    timestamp: orbitNow(),
    read: false,
    ...notification
  });
  orbitSaveNotifications(notifs);
  return notifs[0];
}
function orbitMarkNotificationRead(id){
  const notifs = orbitGetNotifications();
  const n = notifs.find(x => x.id === parseInt(id));
  if(n){ n.read = true; orbitSaveNotifications(notifs); }
}
function orbitMarkAllRead(){
  const notifs = orbitGetNotifications();
  notifs.forEach(n => n.read = true);
  orbitSaveNotifications(notifs);
}
function orbitGetUnreadCount(){
  return orbitGetNotifications().filter(n => !n.read).length;
}
// Notify relevant departments about a new order / stage change
function orbitNotifyDepartments(jobId, client, stage, message, targetPages){
  const notif = orbitAddNotification({
    type: stage <= 2 ? "new-order" : "stage-update",
    jobId, client, stage, stageName: ORBIT_STAGES[stage]?.name || "",
    message, targetPages
  });
  return notif;
}

/* ============================================================
   QR CODE GENERATION
   ============================================================ */
function orbitGenerateQRUrl(jobId, size){
  const baseUrl = location.origin + location.pathname.replace(/[^\/]*$/, '') + 'qr-view.html';
  const data = baseUrl + '?job=' + encodeURIComponent(jobId);
  return 'https://api.qrserver.com/v1/create-qr-code/?size=' + (size || 200) + 'x' + (size || 200) + '&data=' + encodeURIComponent(data);
}
function orbitQRImageTag(jobId, size, className){
  return '<img src="' + orbitGenerateQRUrl(jobId, size) + '" ' +
    'alt="QR Code for ' + jobId + '" ' +
    'class="' + (className || 'qr-code') + '" ' +
    'loading="lazy">';
}

/* ============================================================
   JOB DATA STORAGE — FRESH START (no demo jobs)
   ============================================================ */
function orbitGetJobs(){
  const stored = localStorage.getItem("orbit_jobs");
  if(stored){
    try { return JSON.parse(stored); } catch(e){}
  }
  const empty = [];
  localStorage.setItem("orbit_jobs", JSON.stringify(empty));
  return empty;
}
function orbitSaveJobs(jobs){
  localStorage.setItem("orbit_jobs", JSON.stringify(jobs));
  orbitSyncPushJobs();
}
function orbitGetJob(jobId){
  return orbitGetJobs().find(j => j.id === jobId);
}
function orbitUpdateJob(jobId, updates){
  const jobs = orbitGetJobs();
  const idx = jobs.findIndex(j => j.id === jobId);
  if(idx !== -1){
    jobs[idx] = {...jobs[idx], ...updates};
    orbitSaveJobs(jobs);
    return jobs[idx];
  }
  return null;
}
function orbitAddJob(job){
  const jobs = orbitGetJobs();
  if(!job.id){
    const seq = jobs.length > 0 ? Math.max(...jobs.map(j => parseInt((j.id||"").split('-')[1]) || 0)) + 1 : 1;
    job.id = "JOB-" + String(seq).padStart(4, '0');
  }
  job.stage = job.stage || 0;
  job.stageName = ORBIT_STAGES[job.stage]?.name || "Sales";
  job.status = job.status || "waiting";
  job.createdAt = orbitNow();
  job.productionHistory = job.productionHistory || [];
  job.deliveryData = job.deliveryData || {};
  jobs.unshift(job);
  orbitSaveJobs(jobs);
  return job;
}

/* ============================================================
   PRODUCTION ROUTE — auto-derived from order finishing specs
   ============================================================ */
const ORBIT_FIRST_PROD = 3, ORBIT_LAST_PROD = 12, ORBIT_DELIVERY = 13;
const ORBIT_ROUTE_RULES = [
  {stage:5,  re:/lamination/i},
  {stage:6,  re:/\buv\b|spot\s*uv/i},
  {stage:7,  re:/stamping/i},
  {stage:8,  re:/emboss/i},
  {stage:9,  re:/deboss/i},
  {stage:10, re:/die\s*cut/i},
  {stage:11, re:/glue|double\s*side\s*tape/i}
];
function orbitDefaultRoute(job){
  const sd = (job && job.salesData) || {};
  const specs = [].concat(sd.finishing || [], sd.cutting || []).map(String);
  const route = [3, 4, 12]; // Cutter, Printing, Final QC default for every order
  ORBIT_ROUTE_RULES.forEach(r => {
    if(specs.some(t => r.re.test(t)) && route.indexOf(r.stage) === -1) route.push(r.stage);
  });
  return route.sort((a, b) => a - b);
}
function orbitGetRoute(job){ return orbitDefaultRoute(job); }
function orbitNextStageIdx(job){
  const cur = job.stage || 0;
  if(cur < 2) return cur + 1;
  if(cur >= ORBIT_DELIVERY) return ORBIT_DELIVERY;
  const nxt = orbitGetRoute(job).find(i => i > cur);
  return nxt !== undefined ? nxt : ORBIT_DELIVERY;
}
function orbitFirstProdStageIdx(job){
  const r = orbitGetRoute(job);
  return r.length ? r[0] : ORBIT_FIRST_PROD;
}
function orbitJobStageList(job){
  const set = {};
  orbitGetRoute(job).forEach(i => set[i] = true);
  (job.productionHistory || []).forEach(h => {
    if(typeof h.stage === "number" && h.stage >= ORBIT_FIRST_PROD && h.stage <= ORBIT_LAST_PROD) set[h.stage] = true;
  });
  if(job.stage >= ORBIT_FIRST_PROD && job.stage <= ORBIT_LAST_PROD) set[job.stage] = true;
  return Object.keys(set).map(Number).sort((a, b) => a - b);
}
function orbitAdvanceStage(jobId, qty, operator, notes, photoData){
  const job = orbitGetJob(jobId);
  if(!job) return null;
  const nextStage = orbitNextStageIdx(job);
  const historyEntry = {
    stage: job.stage,
    stageName: job.stageName,
    qty: qty || job.quantity,
    operator: operator || "Unknown",
    timestamp: orbitNow(),
    notes: notes || "",
    photo: photoData || null
  };
  job.productionHistory.push(historyEntry);
  job.stage = nextStage;
  job.stageName = ORBIT_STAGES[nextStage].name;
  if(nextStage >= ORBIT_STAGES.length - 1){ job.status = "complete"; }
  orbitUpdateJob(jobId, job);
  const targetPages = {
    0: ["sales.html","new-order.html"],
    1: ["designer.html","submit-design.html"],
    2: ["planner.html"],
    3: ["production.html","log-output.html"],
    4: ["production.html","log-output.html"],
    5: ["production.html","log-output.html"],
    6: ["production.html","log-output.html"],
    7: ["production.html","log-output.html"],
    8: ["production.html","log-output.html"],
    9: ["production.html","log-output.html"],
    10: ["production.html","log-output.html"],
    11: ["production.html","log-output.html"],
    12: ["production.html","log-output.html"],
    13: ["delivery.html"]
  };
  orbitNotifyDepartments(
    jobId, job.client, nextStage,
    jobId + " moved to " + ORBIT_STAGES[nextStage].name + " by " + operator,
    targetPages[nextStage] || []
  );
  return job;
}

/* ============================================================
   EXCEL / CSV EXPORT
   ============================================================ */
function orbitExportToCSV(filename, headers, rows){
  let csv = headers.join(',') + '\n';
  rows.forEach(row => {
    csv += row.map(cell => {
      const str = String(cell || '');
      if(str.includes(',') || str.includes('"') || str.includes('\n')){
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }).join(',') + '\n';
  });
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================================================
   CAMERA / PHOTO CAPTURE
   ============================================================ */
let orbitCameraStream = null;
async function orbitStartCamera(videoElement){
  try{
    orbitCameraStream = await navigator.mediaDevices.getUserMedia({
      video: {facingMode: "environment", width: {ideal: 1280}, height: {ideal: 720}},
      audio: false
    });
    videoElement.srcObject = orbitCameraStream;
    await videoElement.play();
    return true;
  } catch(err){
    console.error("Camera error:", err);
    return false;
  }
}
function orbitStopCamera(){
  if(orbitCameraStream){
    orbitCameraStream.getTracks().forEach(track => track.stop());
    orbitCameraStream = null;
  }
}
function orbitCapturePhoto(videoElement, canvasElement){
  const ctx = canvasElement.getContext('2d');
  canvasElement.width = videoElement.videoWidth || 640;
  canvasElement.height = videoElement.videoHeight || 480;
  ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
  return canvasElement.toDataURL('image/jpeg', 0.8);
}
function orbitHandleFileUpload(fileInput){
  return new Promise((resolve) => {
    const file = fileInput.files[0];
    if(!file){ resolve(null); return; }
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

/* ============================================================
   PRINT FUNCTIONALITY
   ============================================================ */
function orbitPrintElement(elementId, title){
  const printWindow = window.open('', '_blank');
  const element = document.getElementById(elementId);
  if(!element || !printWindow) return;
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title || 'ORBIT Printout'}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:20px;color:#000;}
        h1{color:#C0272B;border-bottom:2px solid #000;padding-bottom:8px;}
        h2{color:#333;margin-top:20px;}
        table{width:100%;border-collapse:collapse;margin:10px 0;}
        th,td{border:1px solid #999;padding:8px;text-align:left;font-size:13px;}
        th{background:#f0f0f0;}
        .mono{font-family:Courier,monospace;}
        .header-info{display:flex;justify-content:space-between;border-bottom:1px solid #ccc;padding-bottom:10px;margin-bottom:15px;}
        .qr-section{text-align:center;margin:20px 0;}
        .qr-section img{width:150px;height:150px;}
        .checkbox{display:inline-block;width:14px;height:14px;border:1.5px solid #333;margin-right:6px;vertical-align:middle;}
        .checked{background:#333;}
        .footer{margin-top:30px;padding-top:15px;border-top:1px solid #ccc;font-size:11px;color:#666;display:flex;justify-content:space-between;}
        .sign-line{margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:40px;}
        .sign-line div{border-top:1px solid #000;padding-top:5px;text-align:center;font-size:12px;}
        @media print{body{padding:0;}}
      </style>
    </head>
    <body>
      <div class="header-info">
        <div>
          <h1 style="margin:0;border:none;padding:0;">SARMAN PRINTING</h1>
          <div style="font-size:12px;color:#666;">"Order Harini, Siap Semalam?" &middot; 1225205-P</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px;color:#666;">Printed: ${orbitNow()}</div>
          <div style="font-size:11px;color:#666;">${title || ''}</div>
        </div>
      </div>
      ${element.innerHTML}
    </body>
    </html>
  `);
  printWindow.document.close();
  setTimeout(() => { printWindow.print(); }, 500);
}

/* ============================================================
   BRANDING & ICONS
   ============================================================ */
function orbitBrandSVG(){
  return '<img src="assets/logo.png" alt="Sarman Printing" class="brand-logo-img" style="height:48px;width:auto;" aria-hidden="true">';
}
function orbitIconSVG(name, size){
  size = size || 20;
  const paths = {
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h6"/>',
    factory: '<path d="M3 21V10l5 3V10l5 3V10l5 3v8H3Z"/><path d="M3 21h18"/><path d="M8 21v-3"/><path d="M13 21v-3"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-4.5"/>',
    truck: '<path d="M14 18V7a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 7v9.5a1 1 0 0 0 1 1H5"/><path d="M14 17.5H9"/><path d="M17.5 17.5H19a1 1 0 0 0 1-1v-3.4a1 1 0 0 0-.22-.62l-2.9-3.6a1 1 0 0 0-.78-.38H14"/><circle cx="16" cy="18.5" r="1.75"/><circle cx="6.5" cy="18.5" r="1.75"/>',
    alert: '<path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a1.9 1.9 0 0 0 1.63 2.85h17.1A1.9 1.9 0 0 0 22.18 18L13.71 3.86a1.9 1.9 0 0 0-3.42 0Z"/>'
  };
  const d = paths[name] || "";
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
}

/* ============================================================
   AUTHENTICATION — real Supabase session (read synchronously
   from localStorage so page logic stays synchronous).
   ============================================================ */
function orbitGetSessionUser(){
  // Supabase v2 stores the session under a key like sb-<ref>-auth-token
  try{
    const keys = Object.keys(localStorage);
    for(let i = 0; i < keys.length; i++){
      if(/^sb-.*-auth-token$/.test(keys[i])){
        const parsed = JSON.parse(localStorage.getItem(keys[i]));
        const s = parsed && (parsed.currentSession || parsed.session || parsed);
        const u = s && (s.user || (s.user_metadata && s));
        if(u && (u.id || u.email)){
          return { id: u.id, email: (u.email || (u.user_metadata && u.user_metadata.email) || "").toLowerCase() };
        }
      }
    }
  }catch(e){}
  return null;
}
function orbitGetUid(){
  const sess = orbitGetSessionUser();
  if(!sess) return null;
  orbitRefreshUsers();
  const idx = ORBIT_USERS.findIndex(e => (e.email||"").toLowerCase() === sess.email);
  return idx >= 0 ? idx : null;
}
function orbitWithUid(slug /*, uid */){
  // Session-based auth: no uid in URL needed.
  return slug;
}
function orbitRequireAuth(pageSlug){
  const uid = orbitGetUid();
  if(uid === null){
    location.href = "staff-login.html?redirect=" + encodeURIComponent(pageSlug);
    return null;
  }
  const user = ORBIT_USERS[uid];
  if(!user || !user.pages || user.pages.indexOf(pageSlug) === -1){
    const landing = (user && user.landing) || "dashboard.html";
    location.href = landing;
    return null;
  }
  return uid;
}
function orbitSignOut(){
  const sb = orbitSB();
  const done = () => { location.href = "staff-login.html"; };
  if(sb){
    try{ sb.auth.signOut().then(done).catch(done); return; }catch(e){}
  }
  done();
}
// Called from the login page after a successful Supabase sign-in.
// First-ever user => IT Administrator (full access). Otherwise if no
// profile exists yet for this email => default restricted staff profile.
async function orbitEnsureProfileForUser(user){
  const sb = orbitSB();
  const email = (user.email || "").toLowerCase();
  if(sb){
    const {data: profiles} = await sb.from("profiles").select("email, emp_id");
    const list = profiles || [];
    if(list.length === 0){
      const name = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      await sb.from("profiles").insert([{
        email, user_uuid: user.id, name, surname: "",
        initials: orbitGenerateInitials(name),
        role: "IT Administrator", dept: "IT",
        landing: "admin.html", pages: ALL_PAGES.slice(), active: true
      }]);
    } else if(!list.find(p => (p.email||"").toLowerCase() === email)){
      const name = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      await sb.from("profiles").insert([{
        email, user_uuid: user.id, name, surname: "",
        initials: orbitGenerateInitials(name),
        role: "Staff (pending role assignment)", dept: "Unassigned",
        landing: "dashboard.html", pages: ["dashboard.html"], active: true
      }]);
    } else {
      // ensure user_uuid is linked
      await sb.from("profiles").update({user_uuid: user.id}).eq("email", email);
    }
    await orbitSyncPull();
  }
  orbitRefreshUsers();
  return orbitGetEmployeeByEmail(email);
}

/* ============================================================
   TOP BAR RENDERING
   ============================================================ */
function orbitRenderTopbar(activeSlug, crumb, uid){
  orbitRefreshUsers();
  const user = ORBIT_USERS[uid];
  if(!user){ return; }
  const brand = document.getElementById("orbit-brand");
  if(brand){
    brand.innerHTML =
      '<div class="topbar-brand">' + orbitBrandSVG() +
      '<div><div class="topbar-brand-text">ORBIT</div>' +
      '<div class="topbar-brand-sub">Sarman Printing &middot; "Order Harini, Siap Semalam?"</div></div></div>';
  }
  const nav = document.getElementById("orbit-nav");
  if(nav){
    nav.innerHTML = "";
    ORBIT_NAV_ITEMS.forEach(item => {
      if(!user.pages || user.pages.indexOf(item.slug) === -1) return;
      const b = document.createElement("button");
      b.textContent = item.label;
      if(item.slug === activeSlug) b.classList.add("active");
      b.onclick = () => { location.href = item.slug; };
      nav.appendChild(b);
    });
  }
  const search = document.getElementById("orbit-search");
  if(search){
    const unread = orbitGetUnreadCount();
    search.innerHTML =
      '<div class="nav-search">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2.2" style="flex-shrink:0;">' +
          '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' +
        '</svg>' +
        '<input id="orbit-nav-search" type="text" placeholder="Search job ID or client..." ' +
        'oninput="orbitSetSearch(this.value)" onkeydown="if(event.key===\'Enter\') orbitRunNavSearch()">' +
        '<button onclick="orbitRunNavSearch()" title="Search" style="padding:6px 9px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>' +
      '</div>' +
      '<div class="notif-bell" onclick="orbitToggleNotifications()" title="Notifications">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
          '<path d="M13.73 21a2 2 0 0 1-3.46 0"/>' +
        '</svg>' +
        (unread > 0 ? '<span class="notif-badge">' + unread + '</span>' : '') +
      '</div>' +
      '<div class="important-toggle" onclick="orbitToggleImportantOnly()" title="Show only urgent jobs">' +
        '<span class="switch" id="orbit-important-switch"><span class="knob"></span></span>' +
        '<span>Urgent</span>' +
      '</div>';
  }
  const crumbEl = document.getElementById("orbit-crumb");
  if(crumbEl) crumbEl.textContent = crumb;
  const chip = document.getElementById("orbit-user-chip");
  if(chip){
    chip.innerHTML =
      '<div class="user-chip-btn" onclick="orbitToggleUserMenu()" title="Account menu">' +
        '<div class="avatar">' + (user.initials || "??") + '</div>' +
        '<div class="user-chip-text">' +
          '<div class="u-name">' + (user.name || "User") + '</div>' +
          '<div class="u-role">' + (user.role || "") + '</div>' +
        '</div>' +
        '<svg class="u-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
      '</div>';
  }
}

/* ============================================================
   NOTIFICATION DROPDOWN
   ============================================================ */
function orbitToggleNotifications(){
  let panel = document.getElementById("orbit-notif-panel");
  if(panel){ panel.remove(); return; }
  const notifs = orbitGetNotifications().slice(0, 15);
  const unread = orbitGetUnreadCount();
  panel = document.createElement("div");
  panel.id = "orbit-notif-panel";
  panel.className = "notif-panel";
  let html = '<div class="notif-panel-header">' +
    '<strong>Notifications</strong>' +
    (unread > 0 ? '<button class="notif-mark-all" onclick="orbitMarkAllRead();this.closest(\'.notif-panel\').remove();orbitRenderTopbar(document.body.dataset.activeSlug, \'\', orbitGetUid());">Mark all read</button>' : '') +
    '</div><div class="notif-list">';
  if(notifs.length === 0){
    html += '<div class="notif-empty">No notifications yet</div>';
  } else {
    html += notifs.map(n =>
      '<div class="notif-item' + (n.read ? '' : ' unread') + '" onclick="orbitMarkNotificationRead(' + n.id + ');this.classList.remove(\'unread\');">' +
        '<div class="notif-title">' + (n.jobId ? '<span class="mono">' + n.jobId + '</span> ' : '') + (n.message || "") + '</div>' +
        '<div class="notif-time">' + (n.timestamp || "") + '</div>' +
      '</div>'
    ).join('');
  }
  html += '</div>';
  panel.innerHTML = html;
  document.body.appendChild(panel);
  setTimeout(() => {
    const bell = document.querySelector(".notif-bell");
    if(bell){
      const rect = bell.getBoundingClientRect();
      panel.style.top = (rect.bottom + window.scrollY + 8) + "px";
      panel.style.right = (window.innerWidth - rect.right - window.scrollX) + "px";
    }
  }, 10);
  setTimeout(() => {
    document.addEventListener("click", function closeNotif(e){
      if(!panel.contains(e.target) && !e.target.closest(".notif-bell")){
        panel.remove();
        document.removeEventListener("click", closeNotif);
      }
    });
  }, 50);
}


/* ============================================================
   USER ACCOUNT DROPDOWN
   ============================================================ */
function orbitToggleUserMenu(){
  let panel = document.getElementById("orbit-user-menu");
  if(panel){ panel.remove(); return; }
  const uid = orbitGetUid();
  const user = (uid !== null && ORBIT_USERS[uid]) ? ORBIT_USERS[uid] : null;
  if(!user) return;
  panel = document.createElement("div");
  panel.id = "orbit-user-menu";
  panel.className = "user-menu-panel";
  panel.innerHTML =
    '<div class="user-menu-head">' +
      '<div class="avatar">' + (user.initials || "??") + '</div>' +
      '<div style="min-width:0;">' +
        '<div class="um-name">' + (user.name || "User") + (user.surname ? " " + user.surname : "") + '</div>' +
        '<div class="um-email">' + (user.email || "") + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="um-role-row">' +
      '<span class="um-role">' + (user.role || "Staff") + '</span>' +
      '<span class="um-dept">' + (user.dept || "") + '</span>' +
    '</div>' +
    '<button class="um-signout" onclick="orbitSignOut()">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
      ' Sign out' +
    '</button>';
  document.body.appendChild(panel);
  setTimeout(() => {
    const chip = document.getElementById("orbit-user-chip");
    if(chip){
      const rect = chip.getBoundingClientRect();
      panel.style.top = (rect.bottom + window.scrollY + 8) + "px";
      panel.style.right = (window.innerWidth - rect.right - window.scrollX) + "px";
    }
  }, 10);
  setTimeout(() => {
    document.addEventListener("click", function closeMenu(e){
      if(!panel.contains(e.target) && !e.target.closest(".user-chip-btn")){
        panel.remove();
        document.removeEventListener("click", closeMenu);
      }
    });
  }, 50);
}

/* ============================================================
   GLOBAL FILTERING
   ============================================================ */
const orbitFilters = { q: "", importantOnly: false };
function orbitApplyFilters(){
  const q = orbitFilters.q.trim().toUpperCase();
  document.querySelectorAll(".orbit-filterable").forEach(el => {
    const job = (el.dataset.job || "").toUpperCase();
    const client = (el.dataset.client || "").toUpperCase();
    const important = el.dataset.important === "true" || el.dataset.urgent === "true";
    const matchesText = !q || job.indexOf(q) !== -1 || client.indexOf(q) !== -1;
    const matchesImportant = !orbitFilters.importantOnly || important;
    el.classList.toggle("filtered-out", !(matchesText && matchesImportant));
  });
}
function orbitSetSearch(v){
  orbitFilters.q = v;
  orbitApplyFilters();
}
function orbitToggleImportantOnly(){
  orbitFilters.importantOnly = !orbitFilters.importantOnly;
  const sw = document.getElementById("orbit-important-switch");
  if(sw) sw.classList.toggle("on", orbitFilters.importantOnly);
  orbitApplyFilters();
}
function orbitRunNavSearch(){
  const el = document.getElementById("orbit-nav-search");
  const val = el ? el.value.trim() : "";
  orbitSetSearch(val);
  if(!val) return;
  if(typeof window.orbitDashboardSearch === "function"){
    window.orbitDashboardSearch(val);
  }
}

/* ============================================================
   SHELL INIT
   ============================================================ */
function orbitRenderShell(activeSlug, crumb){
  const uid = orbitRequireAuth(activeSlug);
  if(uid === null) return null;
  document.body.dataset.activeSlug = activeSlug;
  orbitRenderTopbar(activeSlug, crumb, uid);
  return uid;
}

/* ============================================================
   STAGE PROGRESS STRIP
   ============================================================ */
function orbitStageStrip(currentIndex){
  const w = 1000, h = 52, n = ORBIT_STAGES.length;
  const padX = 24;
  const step = (w - padX * 2) / (n - 1);
  let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">';
  svg += '<line x1="' + padX + '" y1="24" x2="' + (w - padX) + '" y2="24" stroke="#E5E1D8" stroke-width="2.5" stroke-linecap="round"/>';
  if(currentIndex > 0){
    const endX = padX + step * Math.min(currentIndex, n - 1);
    svg += '<line x1="' + padX + '" y1="24" x2="' + endX + '" y2="24" stroke="#1B7A3E" stroke-width="2.5" stroke-linecap="round"/>';
  }
  ORBIT_STAGES.forEach((s, i) => {
    const cx = padX + step * i;
    let fill = "#FFFFFF", stroke = "#D4CFc4", strokeW = 2, textColor = "#A3A09A", textWeight = "400";
    if(i < currentIndex){ fill = "#1B7A3E"; stroke = "#1B7A3E"; textColor = "#1B7A3E"; textWeight = "600"; }
    else if(i === currentIndex){ fill = "#C0272B"; stroke = "#C0272B"; strokeW = 2.5; textColor = "#C0272B"; textWeight = "700"; }
    svg += '<circle cx="' + cx + '" cy="24" r="7" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>';
    if(i < currentIndex){
      svg += '<path d="M' + (cx - 3) + ' 24 L' + (cx - 1) + ' 26 L' + (cx + 3) + ' 22" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    if(i === currentIndex){
      svg += '<circle cx="' + cx + '" cy="24" r="12" fill="none" stroke="#C0272B" stroke-width="1.5" opacity="0.3">' +
        '<animate attributeName="r" values="9;14;9" dur="2s" repeatCount="indefinite"/>' +
        '<animate attributeName="opacity" values="0.4;0.05;0.4" dur="2s" repeatCount="indefinite"/>' +
        '</circle>';
    }
    svg += '<text x="' + cx + '" y="46" font-size="9.5" font-family="Inter, sans-serif" text-anchor="middle" ' +
      'fill="' + textColor + '" font-weight="' + textWeight + '">' + s.name + '</text>';
  });
  svg += '</svg>';
  return svg;
}

/* ============================================================
   TOAST / URGENCY / TIMESTAMP / FORMAT HELPERS
   ============================================================ */
function orbitToast(msg, type){
  let t = document.getElementById("orbit-toast");
  if(!t){
    t = document.createElement("div");
    t.id = "orbit-toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.className = "toast" + (type ? " " + type : "");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(window._orbitToastTimer);
  window._orbitToastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}
function orbitImportantBanner(text, level){
  const urgencyClass = level === "super-urgent" ? " super-urgent" : "";
  const defaultText = level === "super-urgent"
    ? 'This job is SUPER URGENT — prioritize immediately.'
    : 'This job is marked Urgent — confirm timing before handing off.';
  return '<div class="important-banner' + urgencyClass + '">' +
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' +
      '<path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a1.9 1.9 0 0 0 1.63 2.85h17.1A1.9 1.9 0 0 0 22.18 18L13.71 3.86a1.9 1.9 0 0 0-3.42 0Z"/>' +
    '</svg>' + (text || defaultText) + '</div>';
}
function orbitUrgencyTag(level){
  if(level === "super-urgent") return '<span class="tag tag-super-urgent">Super Urgent +30%</span>';
  if(level === "urgent") return '<span class="tag tag-urgent">Urgent +15%</span>';
  return '';
}
function orbitIsUrgent(level){
  return level === "urgent" || level === "super-urgent";
}
function orbitNow(){
  const d = new Date();
  const date = d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
  const time = d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
  return date + ", " + time;
}
function orbitLogAction(msg){
  const uid = orbitGetUid();
  const who = (uid !== null && ORBIT_USERS[uid]) ? ORBIT_USERS[uid].name : "Unknown user";
  orbitToast(msg + " — " + who, "success");
}
function orbitFormatRM(amount){
  return "RM " + Number(amount).toLocaleString('en-MY', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

/* ============================================================
   DASHBOARD ANALYTICS HELPERS
   ============================================================ */
function orbitParseDate(str){
  if(!str) return null;
  const datePart = str.split(',')[0].trim();
  const parts = datePart.split(' ');
  if(parts.length < 3) return null;
  const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  const day = parseInt(parts[0], 10);
  const month = months[(parts[1] || "").slice(0, 3)];
  const year = parseInt(parts[2], 10);
  if(isNaN(day) || month === undefined || isNaN(year)) return null;
  return new Date(year, month, day);
}
function orbitDaysUntil(str){
  const d = orbitParseDate(str);
  if(!d) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((d - today) / 86400000);
}
function orbitDeadlineStatus(str){
  const days = orbitDaysUntil(str);
  if(days === null) return "";
  if(days < 0) return "overdue";
  if(days <= 2) return "due-soon";
  return "";
}
function orbitSparkline(values, color, w, h){
  w = w || 100; h = h || 30;
  if(!values || values.length < 2 || values.every(v => v === 0)){
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"></svg>';
  }
  const max = Math.max.apply(null, values.concat([1]));
  const min = Math.min.apply(null, values.concat([0]));
  const range = (max - min) || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  const areaPts = 'M0,' + h + ' L' + pts.join(' L') + ' L' + w + ',' + h + ' Z';
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    '<path d="' + areaPts + '" fill="' + color + '" opacity="0.14"/>' +
    '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';
}
function orbitDailyTrend(jobs, days, dateField, valueFn){
  dateField = dateField || "createdAt";
  const today = new Date(); today.setHours(0,0,0,0);
  const buckets = [];
  for(let i = days - 1; i >= 0; i--){
    const d = new Date(today); d.setDate(d.getDate() - i);
    buckets.push({date: d, total: 0});
  }
  (jobs || []).forEach(j => {
    const jd = orbitParseDate(j[dateField]);
    if(!jd) return;
    const b = buckets.find(x => x.date.getTime() === jd.getTime());
    if(b) b.total += (valueFn ? valueFn(j) : 1);
  });
  return buckets.map(b => b.total);
}

/* ============================================================
   DELIVERY ORDER NUMBER / COURIER OPTIONS
   ============================================================ */
function orbitGenerateDONumber(jobId){
  const seq = Math.floor(Math.random() * 9000) + 1000;
  return "DO-" + jobId.replace("JOB-", "") + "-" + seq;
}
const ORBIT_COURIERS = ["J&T Express", "Pos Laju", "GDex", "Skynet", "DHL", "Self Pickup", "Lalamove"];

/* ============================================================
   AUTO-SYNC: pull from Supabase on load + every 60s.
   ============================================================ */
try { orbitSyncPull(); } catch(e){ console.warn("[ORBIT] initial pull failed:", e); }
try { setInterval(orbitSyncPull, 60000); } catch(e){}
