/* ============================================================
   Warehouse Operations — Admin Dashboard Logic
   仓库运营管理系统 — 管理后台核心逻辑
   ============================================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     Translation Maps
     ---------------------------------------------------------- */
  const GROUP_LABELS = {
    maintenance: '库维 / Maintenance',
    shelving: '上架 / Shelving',
    outbound: '出库 / Outbound',
  };

  const ACTION_LABELS = {
    checkin: '到岗 / Check In',
    'take-task': '领任务 / Take Task',
    'return-task': '还任务 / Return Task',
    break: '休息 / Break',
    lunch: '午餐 / Lunch',
    checkout: '下班 / Check Out',
    transfer: '借调 / Transfer',
  };

  const EQUIPMENT_LABELS = {
    forklift: '叉车 / Forklift',
    'rf-scanner': 'RF扫描枪 / RF Scanner',
    tablet: '平板 / Tablet',
    cart: '推车 / Cart',
    other: '其他 / Other',
  };

  const STATUS_LABELS = {
    active: '进行中 / Active',
    completed: '已完成 / Completed',
    cancelled: '已取消 / Cancelled',
    partial: '部分完成 / Partial',
  };

  const STATUS_BADGE_CLASS = {
    active: 'badge-active',
    completed: 'badge-completed',
    cancelled: 'badge-cancelled',
    partial: 'badge-partial',
  };

  /* ----------------------------------------------------------
     Application State
     ---------------------------------------------------------- */
  let authToken = localStorage.getItem('admin_token') || null;
  let employees = [];
  let allTasks = [];
  let clockinRecords = [];
  let currentTab = 'employees';
  let clockInterval = null;
  let qrRefreshTimeout = null;
  let currentPartialTask = null;
  let toastTimeout = null;

  /* ----------------------------------------------------------
     DOM References
     ---------------------------------------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    // Login
    loginOverlay: $('#login-overlay'),
    loginForm: $('#login-form'),
    loginPassword: $('#login-password'),
    loginBtn: $('#login-btn'),
    loginError: $('#login-error'),

    // App
    app: $('#app'),

    // Sidebar
    sidebar: $('#sidebar'),
    sidebarToggle: $('#sidebar-toggle'),
    sidebarBackdrop: $('#sidebar-backdrop'),
    qrContainer: $('#qr-container'),
    qrSpinner: $('#qr-spinner'),
    currentDate: $('#current-date'),
    currentTime: $('#current-time'),
    activeCount: $('#active-count'),
    totalEmployeeCount: $('#total-employee-count'),
    logoutBtn: $('#logout-btn'),

    // Tabs
    tabs: $('#tabs'),
    tabIndicator: $('#tab-indicator'),

    // Employees
    empNameCn: $('#emp-name-cn'),
    empNameEn: $('#emp-name-en'),
    empCode: $('#emp-code'),
    empGroup: $('#emp-group'),
    addEmployeeBtn: $('#add-employee-btn'),
    employeeTbody: $('#employee-tbody'),
    empCountBadge: $('#emp-count-badge'),
    empEmpty: $('#emp-empty'),

    // Tasks
    taskEmployee: $('#task-employee'),
    taskNo: $('#task-no'),
    taskQty: $('#task-qty'),
    taskEquipment: $('#task-equipment'),
    assignTaskBtn: $('#assign-task-btn'),
    taskFilterStatus: $('#task-filter-status'),
    refreshTasksBtn: $('#refresh-tasks-btn'),
    allTasksTbody: $('#all-tasks-tbody'),
    tasksEmpty: $('#tasks-empty'),

    // Completion
    activeTasksTbody: $('#active-tasks-tbody'),
    activeEmpty: $('#active-empty'),
    completedTasksTbody: $('#completed-tasks-tbody'),
    completedEmpty: $('#completed-empty'),

    // Records
    recordDate: $('#record-date'),
    refreshRecordsBtn: $('#refresh-records-btn'),
    recordsTbody: $('#records-tbody'),
    recordsEmpty: $('#records-empty'),

    // Modal
    modalOverlay: $('#modal-overlay'),
    partialTaskInfo: $('#partial-task-info'),
    partialQty: $('#partial-qty'),
    modalCancel: $('#modal-cancel'),
    modalConfirm: $('#modal-confirm'),

    // Toast
    toast: $('#toast'),
  };

  /* ----------------------------------------------------------
     Initialization
     ---------------------------------------------------------- */
  function init() {
    bindEvents();
    initDatePicker();

    if (authToken) {
      API.setToken(authToken);
      verifyAndShow();
    } else {
      showLogin();
    }
  }

  async function verifyAndShow() {
    try {
      await API.verifyToken();
      showApp();
    } catch {
      // Token expired or invalid — show login
      authToken = null;
      localStorage.removeItem('admin_token');
      showLogin();
    }
  }

  /* ----------------------------------------------------------
     Auth — Login / Logout
     ---------------------------------------------------------- */
  function showLogin() {
    dom.loginOverlay.style.display = '';
    dom.app.style.display = 'none';
    dom.loginPassword.value = '';
    dom.loginError.textContent = '';
    dom.loginPassword.focus();
    stopClock();
  }

  function showApp() {
    dom.loginOverlay.style.display = 'none';
    dom.app.style.display = '';
    startClock();
    initQRCode();
    loadDataForCurrentTab();
    positionTabIndicator();
  }

  async function login() {
    const password = dom.loginPassword.value.trim();
    if (!password) {
      dom.loginError.textContent = '请输入密码 / Please enter password';
      return;
    }

    dom.loginBtn.disabled = true;
    dom.loginBtn.textContent = '登录中... / Logging in...';
    dom.loginError.textContent = '';

    try {
      const data = await API.login(password);
      authToken = data.token;
      localStorage.setItem('admin_token', authToken);
      API.setToken(authToken);
      showApp();
      showToast('登录成功 / Login successful', 'success');
    } catch (err) {
      dom.loginError.textContent = err.message || '密码错误 / Invalid password';
    } finally {
      dom.loginBtn.disabled = false;
      dom.loginBtn.textContent = '登录 / Login';
    }
  }

  function logout() {
    authToken = null;
    localStorage.removeItem('admin_token');
    API.setToken(null);
    employees = [];
    allTasks = [];
    clockinRecords = [];
    showLogin();
  }

  /* ----------------------------------------------------------
     Clock
     ---------------------------------------------------------- */
  function startClock() {
    updateClock();
    clockInterval = setInterval(updateClock, 1000);
  }

  function stopClock() {
    if (clockInterval) {
      clearInterval(clockInterval);
      clockInterval = null;
    }
  }

  function updateClock() {
    const now = new Date();
    dom.currentDate.textContent = now.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    });
    dom.currentTime.textContent = now.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  /* ----------------------------------------------------------
     QR Code
     ---------------------------------------------------------- */
  async function initQRCode() {
    try {
      const data = await API.getQRToken();
      renderQRCode(data.token);
      scheduleQRRefresh();
    } catch (err) {
      dom.qrContainer.innerHTML = '<span style="color:#ef4444; font-size:11px; text-align:center;">QR加载失败<br>QR Load Failed</span>';
      console.error('QR Token error:', err);
    }
  }

  function renderQRCode(token) {
    const url = `${window.location.origin}/mobile.html?token=${encodeURIComponent(token)}`;

    // Use qrcode-generator library
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();

    // Render as image
    dom.qrContainer.innerHTML = qr.createImgTag(4, 0);

    // Style the generated img
    const img = dom.qrContainer.querySelector('img');
    if (img) {
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.imageRendering = 'pixelated';
      img.alt = 'Employee Clock-in QR Code';
    }
  }

  function scheduleQRRefresh() {
    if (qrRefreshTimeout) clearTimeout(qrRefreshTimeout);

    // Calculate ms until next midnight
    const now = new Date();
    const midnight = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    const msUntilMidnight = midnight - now;

    qrRefreshTimeout = setTimeout(() => {
      initQRCode();
    }, msUntilMidnight);
  }

  /* ----------------------------------------------------------
     Tabs
     ---------------------------------------------------------- */
  function switchTab(tabName) {
    if (tabName === currentTab) return;
    currentTab = tabName;

    // Update tab button states
    $$('.tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update content visibility with animation
    $$('.tab-content').forEach((panel) => {
      const isTarget = panel.id === `tab-${tabName}`;
      if (isTarget) {
        panel.classList.add('active');
        panel.style.animation = 'none';
        // Force reflow
        panel.offsetHeight;
        panel.style.animation = '';
      } else {
        panel.classList.remove('active');
      }
    });

    positionTabIndicator();
    loadDataForCurrentTab();
  }

  function positionTabIndicator() {
    const activeTab = $(`.tab[data-tab="${currentTab}"]`);
    if (!activeTab || !dom.tabIndicator) return;

    const tabsRect = dom.tabs.getBoundingClientRect();
    const activeRect = activeTab.getBoundingClientRect();

    dom.tabIndicator.style.left = `${activeRect.left - tabsRect.left}px`;
    dom.tabIndicator.style.width = `${activeRect.width}px`;
  }

  function loadDataForCurrentTab() {
    switch (currentTab) {
      case 'employees':
        loadEmployees();
        break;
      case 'tasks':
        loadAllTasks();
        break;
      case 'completion':
        loadActiveTasks();
        loadCompletedTasks();
        break;
      case 'records':
        loadRecords();
        break;
    }
  }

  /* ----------------------------------------------------------
     Employees
     ---------------------------------------------------------- */
  async function loadEmployees() {
    try {
      const data = await API.getEmployees();
      employees = data.employees || data || [];
      renderEmployeeTable();
      updateEmployeeDropdown();
      updateSidebarCounts();
    } catch (err) {
      showToast(`加载员工失败 / Failed to load employees: ${err.message}`, 'error');
    }
  }

  function renderEmployeeTable() {
    const tbody = dom.employeeTbody;

    if (!employees.length) {
      tbody.innerHTML = '';
      dom.empEmpty.style.display = '';
      dom.empCountBadge.textContent = '0';
      return;
    }

    dom.empEmpty.style.display = 'none';
    dom.empCountBadge.textContent = employees.length;

    tbody.innerHTML = employees
      .map(
        (emp) => `
      <tr>
        <td><strong>${escapeHtml(emp.nameCn || '')}</strong></td>
        <td>${escapeHtml(emp.name || '')}</td>
        <td><code style="color:var(--accent-amber)">${escapeHtml(emp.code || '')}</code></td>
        <td>${GROUP_LABELS[emp.group] || emp.group || '—'}</td>
        <td class="text-muted">${formatDateTime(emp.createdAt)}</td>
        <td>
          <button class="btn btn-danger btn-sm" data-action="delete-employee" data-id="${emp.id}">
            🗑️ 删除 / Delete
          </button>
        </td>
      </tr>
    `
      )
      .join('');
  }

  function updateEmployeeDropdown() {
    const select = dom.taskEmployee;
    const currentValue = select.value;

    // Clear all but the first placeholder option
    select.innerHTML = '<option value="">-- 选择 / Select --</option>';

    employees.forEach((emp) => {
      const opt = document.createElement('option');
      opt.value = emp.id;
      opt.textContent = `${emp.nameCn || ''} / ${emp.name || ''} (${emp.code || ''})`;
      select.appendChild(opt);
    });

    // Restore selection if still valid
    if (currentValue) select.value = currentValue;
  }

  async function addEmployee() {
    const nameCn = dom.empNameCn.value.trim();
    const nameEn = dom.empNameEn.value.trim();
    const code = dom.empCode.value.trim();
    const group = dom.empGroup.value;

    // Validation
    if (!nameCn) {
      showToast('请输入中文姓名 / Please enter Chinese name', 'error');
      dom.empNameCn.focus();
      return;
    }
    if (!nameEn) {
      showToast('请输入英文姓名 / Please enter English name', 'error');
      dom.empNameEn.focus();
      return;
    }
    if (!/^\d{4}$/.test(code)) {
      showToast('员工Code必须为4位数字 / Code must be 4 digits', 'error');
      dom.empCode.focus();
      return;
    }

    dom.addEmployeeBtn.disabled = true;

    try {
      await API.addEmployee({
        nameCn: nameCn,
        name: nameEn,
        code: code,
        group: group,
      });

      // Clear form
      dom.empNameCn.value = '';
      dom.empNameEn.value = '';
      dom.empCode.value = '';
      dom.empGroup.selectedIndex = 0;

      showToast('员工注册成功 / Employee registered', 'success');
      await loadEmployees();
    } catch (err) {
      showToast(`注册失败 / Registration failed: ${err.message}`, 'error');
    } finally {
      dom.addEmployeeBtn.disabled = false;
    }
  }

  async function deleteEmployee(id) {
    const emp = employees.find((e) => e.id === id);
    const name = emp ? `${emp.nameCn} / ${emp.name}` : id;

    if (!confirm(`确认删除员工？/ Delete employee?\n\n${name}`)) return;

    try {
      await API.deleteEmployee(id);
      showToast('员工已删除 / Employee deleted', 'success');
      await loadEmployees();
    } catch (err) {
      showToast(`删除失败 / Delete failed: ${err.message}`, 'error');
    }
  }

  /* ----------------------------------------------------------
     Tasks — Assignment
     ---------------------------------------------------------- */
  async function loadAllTasks() {
    const status = dom.taskFilterStatus ? dom.taskFilterStatus.value : 'all';
    try {
      const data = await API.getTasks(status);
      allTasks = data.tasks || data || [];
      renderAllTasksTable();
    } catch (err) {
      showToast(`加载任务失败 / Failed to load tasks: ${err.message}`, 'error');
    }
  }

  function renderAllTasksTable() {
    const tbody = dom.allTasksTbody;

    if (!allTasks.length) {
      tbody.innerHTML = '';
      dom.tasksEmpty.style.display = '';
      return;
    }

    dom.tasksEmpty.style.display = 'none';

    tbody.innerHTML = allTasks
      .map((task) => {
        const empName = task.employeeName || getEmployeeName(task.employeeId);
        const statusClass = STATUS_BADGE_CLASS[task.status] || 'badge-active';
        return `
      <tr>
        <td class="task-number-cell" data-action="dblclick-task" data-id="${task.id}" title="双击删除 / Double-click to delete">
          ${escapeHtml(task.taskNo || '')}
        </td>
        <td>${escapeHtml(empName)}</td>
        <td>${task.quantity ?? '—'}</td>
        <td>${task.completedQty ?? 0}</td>
        <td>${EQUIPMENT_LABELS[task.equipmentType] || task.equipmentType || '—'}</td>
        <td><span class="badge ${statusClass}">${STATUS_LABELS[task.status] || task.status || '—'}</span></td>
        <td class="text-muted">${formatDateTime(task.createdAt)}</td>
      </tr>
    `;
      })
      .join('');
  }

  async function assignTask() {
    const employeeId = dom.taskEmployee.value;
    const taskNo = dom.taskNo.value.trim();
    const qty = parseInt(dom.taskQty.value, 10);
    const equipment = dom.taskEquipment.value;

    // Validation
    if (!employeeId) {
      showToast('请选择员工 / Please select an employee', 'error');
      dom.taskEmployee.focus();
      return;
    }
    if (!taskNo) {
      showToast('请输入任务单号 / Please enter task number', 'error');
      dom.taskNo.focus();
      return;
    }
    if (!qty || qty < 1) {
      showToast('请输入有效数量 / Please enter valid quantity', 'error');
      dom.taskQty.focus();
      return;
    }

    dom.assignTaskBtn.disabled = true;

    try {
      await API.addTask({
        employeeId: employeeId,
        taskNo: taskNo,
        quantity: qty,
        equipmentType: equipment,
      });

      // Clear form
      dom.taskNo.value = '';
      dom.taskQty.value = '';
      dom.taskEmployee.selectedIndex = 0;
      dom.taskEquipment.selectedIndex = 0;

      showToast('任务分配成功 / Task assigned', 'success');
      await loadAllTasks();
    } catch (err) {
      showToast(`分配失败 / Assignment failed: ${err.message}`, 'error');
    } finally {
      dom.assignTaskBtn.disabled = false;
    }
  }

  /* ----------------------------------------------------------
     Tasks — Completion
     ---------------------------------------------------------- */
  async function loadActiveTasks() {
    try {
      const data = await API.getTasks('active');
      const active = data.tasks || data || [];
      renderActiveTasksTable(active);
    } catch (err) {
      showToast(`加载进行中任务失败 / Failed to load active tasks: ${err.message}`, 'error');
    }
  }

  function renderActiveTasksTable(tasks) {
    const tbody = dom.activeTasksTbody;

    if (!tasks.length) {
      tbody.innerHTML = '';
      dom.activeEmpty.style.display = '';
      return;
    }

    dom.activeEmpty.style.display = 'none';

    tbody.innerHTML = tasks
      .map((task) => {
        const empName = task.employeeName || getEmployeeName(task.employeeId);
        const totalQty = task.quantity ?? 0;
        const doneQty = task.completedQty ?? 0;
        const pct = totalQty > 0 ? Math.round((doneQty / totalQty) * 100) : 0;
        return `
      <tr>
        <td><strong>${escapeHtml(task.taskNo || '')}</strong></td>
        <td>${escapeHtml(empName)}</td>
        <td>${totalQty}</td>
        <td>${doneQty}</td>
        <td style="min-width:120px">
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="progress-bar" style="flex:1">
              <div class="progress-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="text-muted" style="font-size:11px;white-space:nowrap">${pct}%</span>
          </div>
        </td>
        <td>${EQUIPMENT_LABELS[task.equipmentType] || task.equipmentType || '—'}</td>
        <td>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-success btn-sm" data-action="complete-task" data-id="${task.id}">
              ✅ 完成 / Done
            </button>
            <button class="btn btn-info btn-sm" data-action="partial-task" data-id="${task.id}"
              data-task-no="${escapeHtml(task.taskNo || '')}"
              data-total="${totalQty}" data-done="${doneQty}">
              📊 部分 / Partial
            </button>
            <button class="btn btn-danger btn-sm" data-action="cancel-task" data-id="${task.id}">
              ✖
            </button>
          </div>
        </td>
      </tr>
    `;
      })
      .join('');
  }

  async function loadCompletedTasks() {
    try {
      const data = await API.getTasks('completed');
      const completed = data.tasks || data || [];
      renderCompletedTasksTable(completed);
    } catch (err) {
      console.error('Load completed tasks error:', err);
    }
  }

  function renderCompletedTasksTable(tasks) {
    const tbody = dom.completedTasksTbody;

    if (!tasks.length) {
      tbody.innerHTML = '';
      if (dom.completedEmpty) dom.completedEmpty.style.display = '';
      return;
    }

    if (dom.completedEmpty) dom.completedEmpty.style.display = 'none';

    tbody.innerHTML = tasks
      .map((task) => {
        const empName = task.employeeName || getEmployeeName(task.employeeId);
        return `
      <tr>
        <td><strong>${escapeHtml(task.taskNo || '')}</strong></td>
        <td>${escapeHtml(empName)}</td>
        <td>${task.quantity ?? '—'}</td>
        <td class="text-green">${task.completedQty ?? '—'}</td>
        <td>${EQUIPMENT_LABELS[task.equipmentType] || task.equipmentType || '—'}</td>
        <td class="text-muted">${formatDateTime(task.updatedAt)}</td>
      </tr>
    `;
      })
      .join('');
  }

  async function completeTask(id) {
    if (!confirm('确认完成此任务？ / Mark this task as complete?')) return;

    try {
      await API.updateTask(id, { action: 'complete' });
      showToast('任务已完成 / Task completed', 'success');
      await loadActiveTasks();
      await loadCompletedTasks();
    } catch (err) {
      showToast(`操作失败 / Operation failed: ${err.message}`, 'error');
    }
  }

  function showPartialModal(taskId, taskNo, total, done) {
    currentPartialTask = { id: taskId, taskNo, total, done };

    dom.partialTaskInfo.innerHTML = `
      任务 / Task: <strong>${escapeHtml(taskNo)}</strong><br>
      总数量 / Total: <strong>${total}</strong> &nbsp;|&nbsp; 已完成 / Done: <strong>${done}</strong><br>
      剩余 / Remaining: <strong>${total - done}</strong>
    `;

    dom.partialQty.value = '';
    dom.partialQty.max = total - done;
    dom.partialQty.placeholder = `最多 / Max: ${total - done}`;
    dom.modalOverlay.style.display = '';
    dom.partialQty.focus();
  }

  function hideModal() {
    dom.modalOverlay.style.display = 'none';
    currentPartialTask = null;
  }

  async function confirmPartialComplete() {
    if (!currentPartialTask) return;

    const qty = parseInt(dom.partialQty.value, 10);
    const remaining = currentPartialTask.total - currentPartialTask.done;

    if (!qty || qty < 1) {
      showToast('请输入有效数量 / Please enter valid quantity', 'error');
      dom.partialQty.focus();
      return;
    }
    if (qty > remaining) {
      showToast(`数量不能超过剩余 ${remaining} / Cannot exceed remaining ${remaining}`, 'error');
      dom.partialQty.focus();
      return;
    }

    try {
      await API.updateTask(currentPartialTask.id, {
        action: 'partial',
        completedQty: currentPartialTask.done + qty,
      });
      hideModal();
      showToast(`部分完成 +${qty} / Partial complete +${qty}`, 'success');
      await loadActiveTasks();
      await loadCompletedTasks();
    } catch (err) {
      showToast(`操作失败 / Operation failed: ${err.message}`, 'error');
    }
  }

  async function cancelTask(id) {
    if (!confirm('确认取消此任务？/ Cancel this task?')) return;

    try {
      await API.updateTask(id, { action: 'cancel' });
      showToast('任务已取消 / Task cancelled', 'info');
      await loadActiveTasks();
    } catch (err) {
      showToast(`取消失败 / Cancel failed: ${err.message}`, 'error');
    }
  }

  async function deleteTask(id) {
    const task = allTasks.find((t) => t.id === id);
    const taskNo = task ? task.taskNo : id;

    if (!confirm(`确认删除任务？/ Delete task?\n\n${taskNo}`)) return;

    try {
      await API.deleteTask(id);
      showToast('任务已删除 / Task deleted', 'success');
      await loadAllTasks();
    } catch (err) {
      showToast(`删除失败 / Delete failed: ${err.message}`, 'error');
    }
  }

  /* ----------------------------------------------------------
     Records
     ---------------------------------------------------------- */
  function initDatePicker() {
    const today = new Date().toISOString().split('T')[0];
    dom.recordDate.value = today;
  }

  async function loadRecords() {
    const date = dom.recordDate.value;
    if (!date) return;

    try {
      const data = await API.getRecords(date);
      clockinRecords = data.records || data || [];
      renderRecordsTable();
    } catch (err) {
      showToast(`加载记录失败 / Failed to load records: ${err.message}`, 'error');
    }
  }

  function renderRecordsTable() {
    const tbody = dom.recordsTbody;

    if (!clockinRecords.length) {
      tbody.innerHTML = '';
      dom.recordsEmpty.style.display = '';
      return;
    }

    dom.recordsEmpty.style.display = 'none';

    tbody.innerHTML = clockinRecords
      .map((rec) => {
        const empName = getEmployeeName(rec.employee_id || rec.employeeId) || rec.employee_name || rec.employeeName || '—';
        const recId = rec.id || rec._id || '';
        return `
      <tr data-record-id="${recId}">
        <td class="text-muted">${formatTime(rec.timestamp || rec.time || rec.created_at || rec.createdAt)}</td>
        <td><strong>${escapeHtml(empName)}</strong></td>
        <td><span class="badge ${getActionBadgeClass(rec.action_type || rec.actionType || rec.type)}">${ACTION_LABELS[rec.action_type || rec.actionType || rec.type] || rec.action_type || rec.actionType || rec.type || '—'}</span></td>
        <td class="task-number-cell" data-action="dblclick-record-task" data-id="${recId}"
            title="双击删除 / Double-click to delete">${escapeHtml(rec.task_no || rec.taskNo || '—')}</td>
        <td data-editable="true" data-field="qty" data-record-id="${recId}">${rec.qty ?? rec.quantity ?? '—'}</td>
        <td>${GROUP_LABELS[rec.group] || rec.group || '—'}</td>
      </tr>
    `;
      })
      .join('');
  }

  function getActionBadgeClass(action) {
    switch (action) {
      case 'checkin':
        return 'badge-active';
      case 'checkout':
        return 'badge-completed';
      case 'break':
      case 'lunch':
        return 'badge-break';
      case 'take-task':
      case 'return-task':
        return 'badge-partial';
      case 'transfer':
        return 'badge-cancelled';
      default:
        return '';
    }
  }

  /* ----------------------------------------------------------
     Double-Click Editing on Records
     ---------------------------------------------------------- */
  function handleRecordCellDblClick(td) {
    // Prevent double-activation
    if (td.querySelector('.cell-edit-input')) return;

    const field = td.dataset.field;
    const recordId = td.dataset.recordId;
    const originalValue = td.textContent.trim();

    // Create input
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'cell-edit-input';
    input.value = originalValue === '—' ? '' : originalValue;
    input.min = 0;

    // Replace cell content
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();

    // Save function
    const save = async () => {
      const newValue = input.value.trim();
      const numValue = newValue === '' ? null : parseInt(newValue, 10);

      // Restore cell if unchanged
      if (newValue === originalValue || (newValue === '' && originalValue === '—')) {
        td.textContent = originalValue;
        return;
      }

      try {
        await API.updateRecord(recordId, { [field]: numValue });
        td.textContent = numValue ?? '—';
        // Highlight the row briefly
        const row = td.closest('tr');
        if (row) {
          row.classList.add('row-highlight');
          setTimeout(() => row.classList.remove('row-highlight'), 1500);
        }
        showToast('记录已更新 / Record updated', 'success');
      } catch (err) {
        td.textContent = originalValue;
        showToast(`更新失败 / Update failed: ${err.message}`, 'error');
      }
    };

    // Event handlers
    input.addEventListener('blur', save, { once: true });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        input.removeEventListener('blur', save);
        td.textContent = originalValue;
      }
    });
  }

  /* ----------------------------------------------------------
     Double-Click Task Number Deletion
     ---------------------------------------------------------- */
  function handleTaskDblClick(td) {
    const id = td.dataset.id;
    if (id) deleteTask(id);
  }

  function handleRecordTaskDblClick(td) {
    const id = td.dataset.id;
    if (!id) return;

    if (confirm('确认删除此记录？ / Delete this record?')) {
      API.deleteRecord(id)
        .then(() => {
          showToast('记录已删除 / Record deleted', 'success');
          loadRecords();
        })
        .catch((err) => {
          showToast(`删除失败 / Delete failed: ${err.message}`, 'error');
        });
    }
  }

  /* ----------------------------------------------------------
     Sidebar Counts
     ---------------------------------------------------------- */
  function updateSidebarCounts() {
    dom.totalEmployeeCount.textContent = employees.length;
    // Active count would come from checkin data — estimate from records
    const activeEmpIds = new Set();
    clockinRecords.forEach((r) => {
      if ((r.action_type || r.actionType || r.type) === 'checkin') {
        activeEmpIds.add(r.employee_id || r.employeeId);
      }
    });
    // Remove those who checked out
    clockinRecords.forEach((r) => {
      if ((r.action_type || r.actionType || r.type) === 'checkout') {
        activeEmpIds.delete(r.employee_id || r.employeeId);
      }
    });
    dom.activeCount.textContent = activeEmpIds.size;
  }

  /* ----------------------------------------------------------
     Toast Notifications
     ---------------------------------------------------------- */
  function showToast(message, type = 'info') {
    const toast = dom.toast;

    // Clear previous
    if (toastTimeout) clearTimeout(toastTimeout);
    toast.className = 'toast';

    // Force reflow
    toast.offsetHeight;

    // Set content and type
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escapeHtml(message)}</span>`;
    toast.classList.add(`toast-${type}`, 'show');

    // Auto-hide
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      setTimeout(() => {
        toast.className = 'toast';
      }, 350);
    }, 3500);
  }

  /* ----------------------------------------------------------
     Helpers
     ---------------------------------------------------------- */
  function getEmployeeName(id) {
    if (!id) return '—';
    const emp = employees.find((e) => e.id === id);
    if (!emp) return id;
    return `${emp.nameCn || ''} / ${emp.name || ''}`;
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return iso;
    }
  }

  function formatTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      return iso;
    }
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return str ?? '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  /* ----------------------------------------------------------
     Event Binding
     ---------------------------------------------------------- */
  function bindEvents() {
    // Login
    dom.loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      login();
    });

    // Logout
    dom.logoutBtn.addEventListener('click', logout);

    // Sidebar toggle (mobile)
    dom.sidebarToggle.addEventListener('click', () => {
      dom.sidebar.classList.toggle('open');
      dom.sidebarBackdrop.classList.toggle('show');
    });

    dom.sidebarBackdrop.addEventListener('click', () => {
      dom.sidebar.classList.remove('open');
      dom.sidebarBackdrop.classList.remove('show');
    });

    // Tabs — event delegation
    dom.tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (tab && tab.dataset.tab) {
        switchTab(tab.dataset.tab);
      }
    });

    // Reposition indicator on resize
    window.addEventListener('resize', () => {
      positionTabIndicator();
    });

    // Add Employee
    dom.addEmployeeBtn.addEventListener('click', addEmployee);

    // Employee table delegation
    dom.employeeTbody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'delete-employee' && id) {
        deleteEmployee(id);
      }
    });

    // Assign Task
    dom.assignTaskBtn.addEventListener('click', assignTask);

    // Task filter change
    if (dom.taskFilterStatus) {
      dom.taskFilterStatus.addEventListener('change', loadAllTasks);
    }

    // Refresh tasks
    if (dom.refreshTasksBtn) {
      dom.refreshTasksBtn.addEventListener('click', loadAllTasks);
    }

    // All Tasks table — double-click on task number
    dom.allTasksTbody.addEventListener('dblclick', (e) => {
      const td = e.target.closest('[data-action="dblclick-task"]');
      if (td) handleTaskDblClick(td);
    });

    // Active Tasks table — delegation for completion buttons
    dom.activeTasksTbody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;

      switch (action) {
        case 'complete-task':
          completeTask(id);
          break;
        case 'partial-task':
          showPartialModal(
            id,
            btn.dataset.taskNo,
            parseInt(btn.dataset.total, 10),
            parseInt(btn.dataset.done, 10)
          );
          break;
        case 'cancel-task':
          cancelTask(id);
          break;
      }
    });

    // Modal
    dom.modalCancel.addEventListener('click', hideModal);
    dom.modalConfirm.addEventListener('click', confirmPartialComplete);

    // Close modal on overlay click
    dom.modalOverlay.addEventListener('click', (e) => {
      if (e.target === dom.modalOverlay) hideModal();
    });

    // Modal — Enter to confirm
    dom.partialQty.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmPartialComplete();
      }
    });

    // Record date change
    dom.recordDate.addEventListener('change', loadRecords);

    // Refresh records
    dom.refreshRecordsBtn.addEventListener('click', loadRecords);

    // Records table — double-click for inline edit & task deletion
    dom.recordsTbody.addEventListener('dblclick', (e) => {
      const editableTd = e.target.closest('td[data-editable="true"]');
      if (editableTd) {
        handleRecordCellDblClick(editableTd);
        return;
      }

      const taskTd = e.target.closest('[data-action="dblclick-record-task"]');
      if (taskTd) {
        handleRecordTaskDblClick(taskTd);
      }
    });

    // Keyboard shortcut: Escape closes modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (dom.modalOverlay.style.display !== 'none') {
          hideModal();
        }
      }
    });
  }

  /* ----------------------------------------------------------
     Boot
     ---------------------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
