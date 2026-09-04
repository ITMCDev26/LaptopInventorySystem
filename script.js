// =====================================================================
// CONFIG — paste your deployed Apps Script Web App URL here.
// (Deploy → New deployment → Web app → copy the URL it gives you.)
// =====================================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbwv_SpnxA4aOPMzYxtHJYm0DwqTcFAmLHVa16Cm69x8KcONCXdQUAXd2RAxKzh3G4WaqA/exec';

(function(){

  // ---------------- CONFIG CHECK ----------------
  if(!API_URL || API_URL.indexOf('PASTE_YOUR') === 0){
    document.getElementById('configWarning').style.display = 'block';
  }

  // ---------------- UTIL ----------------
  function $(id){ return document.getElementById(id); }

  async function apiCall(action, payload){
    const res = await fetch(API_URL, {
      method: 'POST',
      // Deliberately NOT setting Content-Type to application/json:
      // Apps Script web apps don't handle CORS preflight (OPTIONS) requests,
      // so we keep this a "simple request" (text/plain) to avoid the browser
      // sending a preflight. e.postData.contents on the server still parses fine.
      body: JSON.stringify({ action: action, payload: payload || {} })
    });
    const json = await res.json();
    if(!json.ok){
      throw new Error(json.error || 'Request failed');
    }
    return json.data;
  }

  function processedBy(){
    return $('processedByName') ? $('processedByName').value.trim() : '';
  }

  function fmtDate(d){
    if(!d) return '—';
    const dt = (d instanceof Date) ? d : new Date(d);
    if(isNaN(dt)) return String(d);
    return dt.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
  }
  function fmtDateTime(d){
    if(!d) return '—';
    const dt = (d instanceof Date) ? d : new Date(d);
    if(isNaN(dt)) return String(d);
    return dt.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}) + ' · ' +
           dt.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  }
  function toast(msg, type){
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (type || '');
    setTimeout(()=>{ t.classList.remove('show'); }, 3200);
  }
  function statusClass(status){
    return 'status-' + String(status).replace(/\s+/g,'');
  }
  function setBtnLoading(btn, loading, label){
    if(loading){
      btn.dataset.label = btn.innerHTML;
      btn.innerHTML = '<span class="loader"></span> ' + (label || 'Working…');
      btn.disabled = true;
    } else {
      btn.innerHTML = btn.dataset.label || label || 'Submit';
      btn.disabled = false;
    }
  }
  function showAlert(el, msg){
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(()=>{ el.style.display = 'none'; }, 5000);
  }
  function handleError(err, alertEl){
    const msg = err && err.message ? err.message : String(err);
    if(alertEl){ showAlert(alertEl, msg); } else { toast('Error: ' + msg, 'error'); }
  }

  // ---------------- APP INIT (no login — straight to dashboard) ----------------
  document.getElementById('appScreen').style.display = 'block';
  loadDashboard();

  // remember "processed by" name across visits, for convenience
  (function restoreProcessedBy(){
    const saved = localStorage.getItem('laptopMgr_processedBy');
    if(saved && $('processedByName')) $('processedByName').value = saved;
  })();
  if($('processedByName')){
    $('processedByName').addEventListener('change', function(){
      localStorage.setItem('laptopMgr_processedBy', this.value.trim());
    });
  }

  // ---------------- NAV ----------------
  document.querySelectorAll('.nav-item').forEach(function(item){
    item.addEventListener('click', function(){
      document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      item.classList.add('active');
      const view = item.dataset.view;
      $('view-' + view).classList.add('active');
      if(view === 'dashboard') loadDashboard();
      if(view === 'inventory') loadInventory();
    });
  });

  // ---------------- DASHBOARD ----------------
  async function loadDashboard(){
    try{
      const stats = await apiCall('getDashboardStats', {});
      $('statTotal').textContent = stats.total;
      $('statActive').textContent = stats.active;
      $('statPending').textContent = stats.pending;
      $('statAging').textContent = stats.agingSoon;

      const box = $('recentTransfers');
      if(!stats.recentTransfers.length){
        box.innerHTML = '<div class="empty-state"><div class="ic">▤</div>No activity yet.</div>';
      } else {
        box.innerHTML = stats.recentTransfers.map(function(r){
          const icon = r.reason === 'Resigned' ? '⏏' : (r.reason === 'New Registration' ? '＋' : '⇄');
          const title = r.reason === 'New Registration'
            ? 'Registered → ' + (r.toEmployee || '—')
            : (r.reason === 'Resigned'
                ? (r.fromEmployee || '—') + ' resigned — laptop returned'
                : (r.fromEmployee || '—') + ' → ' + (r.toEmployee || '—'));
          return '<div class="timeline-item">' +
            '<div class="t-icon">'+icon+'</div>' +
            '<div class="t-main"><div class="t-title">'+title+'</div>' +
            '<div class="t-sub">'+r.serialNo+' · '+r.reason+'</div></div>' +
            '<div class="t-time">'+fmtDate(r.timestamp)+'</div></div>';
        }).join('');
      }

      const chart = $('brandChart');
      const entries = Object.entries(stats.brandCounts).sort((a,b)=>b[1]-a[1]);
      if(!entries.length){
        chart.innerHTML = '<div class="empty-state"><div class="ic">◆</div>No laptops registered yet.</div>';
      } else {
        const max = Math.max.apply(null, entries.map(e=>e[1]));
        chart.innerHTML = entries.map(function(e){
          const pct = Math.round((e[1]/max)*100);
          return '<div class="bar-row"><div class="bar-label">'+e[0]+'</div>' +
            '<div class="bar-track"><div class="bar-fill" style="width:'+pct+'%"></div></div>' +
            '<div class="bar-value">'+e[1]+'</div></div>';
        }).join('');
      }
    } catch(err){ handleError(err); }
  }

  // ---------------- REGISTER ----------------
  $('registerForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const btn = $('registerBtn');
    const d = {
      accountableEmployee: $('reg_accountableEmployee').value.trim(),
      employeeNo: $('reg_employeeNo').value.trim(),
      townshipUnit: $('reg_townshipUnit').value.trim(),
      brand: $('reg_brand').value.trim(),
      serialNo: $('reg_serialNo').value.trim(),
      poNumber: $('reg_poNumber').value.trim(),
      datePurchased: $('reg_datePurchased').value,
      controlNumber: $('reg_controlNumber').value.trim(),
      remarks: $('reg_remarks').value.trim(),
      processedBy: processedBy()
    };
    setBtnLoading(btn, true, 'Saving…');
    try{
      await apiCall('registerLaptop', d);
      setBtnLoading(btn, false, 'Register Laptop');
      showAlert($('registerSuccess'), 'Laptop registered successfully.');
      $('registerForm').reset();
      toast('Laptop registered', 'success');
    } catch(err){
      setBtnLoading(btn, false, 'Register Laptop');
      handleError(err, $('registerError'));
    }
  });

  // ---------------- TRANSFER ----------------
  $('transferLookupBtn').addEventListener('click', doTransferLookup);
  $('transferLookup').addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); doTransferLookup(); } });

  async function doTransferLookup(){
    const q = $('transferLookup').value.trim();
    if(!q) return;
    try{
      const res = await apiCall('searchBySerial', { query: q });
      if(!res.laptop){
        toast('No laptop found with that serial/control number.', 'error');
        $('transferFormCard').style.display = 'none';
        return;
      }
      $('transferCurrentOwner').textContent = res.laptop.accountableEmployee || '(unassigned)';
      $('transferCurrentStatus').textContent = res.laptop.status;
      $('transferCurrentStatus').className = 'status-pill ' + statusClass(res.laptop.status);
      $('tr_serialNo').value = res.laptop.serialNo;
      $('tr_townshipUnit').value = res.laptop.townshipUnit || '';
      $('transferFormCard').style.display = 'block';
    } catch(err){ handleError(err); }
  }

  $('tr_reason').addEventListener('change', function(){
    const isResign = this.value === 'Resigned';
    $('tr_toEmployeeField').style.display = isResign ? 'none' : 'block';
    $('tr_toEmployeeNoField').style.display = isResign ? 'none' : 'block';
    $('tr_toEmployee').required = !isResign;
    $('tr_toEmployeeNo').required = !isResign;
  });

  $('transferForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const btn = $('transferBtn');
    const d = {
      serialNo: $('tr_serialNo').value,
      reason: $('tr_reason').value,
      toEmployee: $('tr_toEmployee').value.trim(),
      toEmployeeNo: $('tr_toEmployeeNo').value.trim(),
      townshipUnit: $('tr_townshipUnit').value.trim(),
      remarks: $('tr_remarks').value.trim(),
      processedBy: processedBy()
    };
    setBtnLoading(btn, true, 'Processing…');
    try{
      const res = await apiCall('transferLaptop', d);
      setBtnLoading(btn, false, 'Process Transfer');
      showAlert($('transferSuccess'), 'Transfer recorded successfully.');
      toast('Transfer processed', 'success');
      $('transferForm').reset();
      $('transferFormCard').style.display = 'none';
      $('transferLookup').value = '';
      if(res.clearance){ openClearanceModal(res.clearance); }
    } catch(err){
      setBtnLoading(btn, false, 'Process Transfer');
      handleError(err, $('transferError'));
    }
  });

  function openClearanceModal(c){
    function row(label, val){ return '<tr><td class="cs-label">'+label+'</td><td>'+(val||'—')+'</td></tr>'; }
    $('clearanceSlipContent').innerHTML =
      '<h4>Laptop Return &amp; Exit Clearance</h4>' +
      '<div class="cs-sub">Generated ' + fmtDateTime(new Date()) + '</div>' +
      '<table style="width:100%;">' +
        row('Employee', c.employee) +
        row('Employee No.', c.employeeNo) +
        row('Brand / Model', (c.brand||'')+' '+(c.model||'')) +
        row('Serial No.', c.serialNo) +
        row('Control No.', c.controlNumber) +
        row('Processed By', c.processedBy) +
      '</table>' +
      '<div class="sig-line">Employee / Authorized Signature</div>' +
      '<div class="sig-line" style="margin-top:22px;">IT / Property Custodian Signature</div>';
    $('clearanceModal').classList.add('show');
  }
  $('closeClearanceModal').addEventListener('click', function(){
    $('clearanceModal').classList.remove('show');
    loadDashboard();
  });

  // ---------------- SEARCH ----------------
  $('searchBtn').addEventListener('click', doSearch);
  $('searchQuery').addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); doSearch(); } });

  async function doSearch(){
    const type = $('searchType').value;
    const q = $('searchQuery').value.trim();
    const box = $('searchResults');
    if(!q) return;
    box.innerHTML = '<div class="empty-state"><span class="loader" style="border-top-color:var(--blue-400);border-color:rgba(47,126,240,.3);"></span></div>';

    try{
      if(type === 'serial'){
        const res = await apiCall('searchBySerial', { query: q });
        renderSerialResult(res);
      } else {
        const res = await apiCall('searchByEmployee', { query: q });
        renderEmployeeResult(res, q);
      }
    } catch(err){
      box.innerHTML = '';
      handleError(err);
    }
  }

  function renderSerialResult(res){
    const box = $('searchResults');
    function kv(k,v){ return '<div class="kv"><div class="k">'+k+'</div><div class="v">'+(v||'—')+'</div></div>'; }
    if(!res.laptop){
      box.innerHTML = '<div class="card"><div class="empty-state"><div class="ic">⌕</div>No laptop found for that serial / control number.</div></div>';
      return;
    }
    const l = res.laptop;
    let html = '<div class="card" style="margin-bottom:16px;">' +
      '<div class="result-header">' +
        '<h3 style="margin:0;">'+l.brand+' '+(l.model||'')+'</h3>' +
        '<span class="status-pill '+statusClass(l.status)+'">'+l.status+'</span>' +
      '</div>' +
      '<div class="kv-grid">' +
        kv('Serial No.', l.serialNo) + kv('Control No.', l.controlNumber) + kv('PO Number', l.poNumber) +
        kv('Accountable Employee', l.accountableEmployee || '(unassigned)') + kv('Employee No.', l.employeeNo) + kv('Township/Unit', l.townshipUnit) +
        kv('Date Purchased', fmtDate(l.datePurchased)) + kv('Date Registered', fmtDate(l.dateRegistered)) + kv('Remarks', l.remarks || '—') +
      '</div></div>';

    html += '<div class="card"><h3><span class="ic">▤</span> Ownership History</h3>';
    if(!res.history.length){
      html += '<div class="empty-state">No history recorded yet.</div>';
    } else {
      html += res.history.map(function(h){
        const title = h.reason === 'New Registration'
          ? 'Registered to ' + (h.toEmployee || '—')
          : (h.reason === 'Resigned'
              ? (h.fromEmployee || '—') + ' resigned — returned to custody'
              : (h.fromEmployee || '(unassigned)') + ' → ' + (h.toEmployee || '—'));
        return '<div class="timeline-item">' +
          '<div class="t-icon">'+(h.reason === 'Resigned' ? '⏏' : (h.reason === 'New Registration' ? '＋' : '⇄'))+'</div>' +
          '<div class="t-main"><div class="t-title">'+title+'</div>' +
          '<div class="t-sub">'+h.reason+(h.remarks ? ' · '+h.remarks : '')+(h.processedBy ? ' · by '+h.processedBy : '')+'</div></div>' +
          '<div class="t-time">'+fmtDateTime(h.timestamp)+'</div></div>';
      }).join('');
    }
    html += '</div>';
    box.innerHTML = html;
  }

  function renderEmployeeResult(list, empNo){
    const box = $('searchResults');
    if(!list.length){
      box.innerHTML = '<div class="card"><div class="empty-state"><div class="ic">⌕</div>No laptops found for employee no. "'+empNo+'".</div></div>';
      return;
    }
    let html = '<div class="card"><h3><span class="ic">▤</span> Laptops accountable to '+empNo+' ('+list.length+')</h3>' +
      '<div class="table-wrap"><table><thead><tr>' +
      '<th>Control No.</th><th>Serial No.</th><th>Brand/Model</th><th>Unit</th><th>Purchased</th><th>Status</th>' +
      '</tr></thead><tbody>';
    html += list.map(function(l){
      return '<tr><td class="mono-cell">'+l.controlNumber+'</td><td class="mono-cell">'+l.serialNo+'</td>' +
        '<td class="strong">'+l.brand+' '+(l.model||'')+'</td><td>'+(l.townshipUnit||'—')+'</td>' +
        '<td>'+fmtDate(l.datePurchased)+'</td><td><span class="status-pill '+statusClass(l.status)+'">'+l.status+'</span></td></tr>';
    }).join('');
    html += '</tbody></table></div></div>';
    box.innerHTML = html;
  }

  // ---------------- INVENTORY ----------------
  $('refreshInventoryBtn').addEventListener('click', loadInventory);

  async function loadInventory(){
    $('inventoryBody').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;">Loading…</td></tr>';
    try{
      const list = await apiCall('getAllLaptops', {});
      if(!list.length){
        $('inventoryBody').innerHTML = '<tr><td colspan="8"><div class="empty-state">No laptops registered yet.</div></td></tr>';
        return;
      }
      $('inventoryBody').innerHTML = list.map(function(l){
        return '<tr>' +
          '<td class="mono-cell">'+l.controlNumber+'</td>' +
          '<td class="mono-cell">'+l.serialNo+'</td>' +
          '<td class="strong">'+l.brand+' '+(l.model||'')+'</td>' +
          '<td>'+(l.accountableEmployee || '(unassigned)')+'</td>' +
          '<td>'+(l.employeeNo||'—')+'</td>' +
          '<td>'+(l.townshipUnit||'—')+'</td>' +
          '<td>'+fmtDate(l.datePurchased)+'</td>' +
          '<td><span class="status-pill '+statusClass(l.status)+'">'+l.status+'</span></td>' +
          '</tr>';
      }).join('');
    } catch(err){ handleError(err); }
  }

})();
