/* ============================================================
   Warehouse Operations — API Client
   仓库运营管理系统 — API 接口封装
   ============================================================ */

const API = {
  baseUrl: '',
  token: null,

  /**
   * Set the auth token for subsequent requests.
   * @param {string|null} t
   */
  setToken(t) {
    this.token = t;
  },

  /**
   * Core request helper. All API calls go through this.
   * @param {'GET'|'POST'|'PUT'|'DELETE'} method
   * @param {string} path
   * @param {object|null} body
   * @returns {Promise<any>}
   */
  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const opts = { method, headers };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${path}`, opts);

    // Handle 204 No Content
    if (res.status === 204) {
      return { success: true };
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('Invalid server response');
    }

    if (!res.ok) {
      // If 401, clear token (session expired)
      if (res.status === 401) {
        this.token = null;
        localStorage.removeItem('admin_token');
      }
      throw new Error(data.error || data.message || `Request failed (${res.status})`);
    }

    return data;
  },

  /* ------ Auth ------ */

  /**
   * Authenticate as admin.
   * @param {string} password
   */
  login(password) {
    return this.request('POST', '/api/auth', { password });
  },

  /**
   * Verify the current token is still valid.
   * Backend: GET /api/auth (checks Authorization header)
   */
  verifyToken() {
    return this.request('GET', '/api/auth');
  },

  /* ------ Employees ------ */

  /**
   * List all registered employees.
   */
  getEmployees() {
    return this.request('GET', '/api/employees');
  },

  /**
   * Register a new employee.
   * Backend expects: { name, nameCn, code, group }
   * @param {{ nameCn: string, name: string, code: string, group: string }} data
   */
  addEmployee(data) {
    return this.request('POST', '/api/employees', {
      name: data.name,
      nameCn: data.nameCn,
      code: data.code,
      group: data.group,
    });
  },

  /**
   * Delete an employee.
   * @param {string} id
   */
  deleteEmployee(id) {
    return this.request('DELETE', `/api/employees/${id}`);
  },

  /* ------ Tasks ------ */

  /**
   * Get tasks, optionally filtered by status.
   * @param {'all'|'active'|'completed'|'cancelled'} status
   */
  getTasks(status = 'all') {
    return this.request('GET', `/api/tasks?status=${encodeURIComponent(status)}`);
  },

  /**
   * Assign a new task.
   * Backend expects: { employeeId, taskNo, quantity, equipmentType }
   * @param {{ employeeId: string, taskNo: string, quantity: number, equipmentType: string }} data
   */
  addTask(data) {
    return this.request('POST', '/api/tasks', {
      employeeId: data.employeeId,
      taskNo: data.taskNo,
      quantity: data.quantity,
      equipmentType: data.equipmentType,
    });
  },

  /**
   * Update a task (complete, partial complete, cancel)
   * Backend expects: { action: 'complete'|'partial'|'cancel', completedQty?: number }
   * @param {string} id
   * @param {{ action: string, completedQty?: number }} data
   */
  updateTask(id, data) {
    return this.request('PUT', `/api/tasks/${id}`, data);
  },

  /**
   * Delete a task.
   * @param {string} id
   */
  deleteTask(id) {
    return this.request('DELETE', `/api/tasks/${id}`);
  },

  /* ------ Clock-in Records ------ */

  /**
   * Get clock-in records for a specific date.
   * @param {string} date — YYYY-MM-DD format
   */
  getRecords(date) {
    return this.request('GET', `/api/clockin?date=${encodeURIComponent(date)}`);
  },

  /**
   * Update a clock-in record field (e.g. correcting quantities).
   * @param {string} id
   * @param {object} data
   */
  updateRecord(id, data) {
    return this.request('PUT', `/api/records/${id}`, data);
  },

  /**
   * Delete a clock-in record.
   * @param {string} id
   */
  deleteRecord(id) {
    return this.request('DELETE', `/api/records/${id}`);
  },

  /* ------ QR Token ------ */

  /**
   * Get the daily QR token for employee clock-in.
   */
  getQRToken() {
    return this.request('GET', '/api/qr-token');
  },
};
