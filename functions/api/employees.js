/**
 * Employee Management API
 * GET  /api/employees — List all employees
 * POST /api/employees — Create a new employee
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders });
}

/**
 * GET /api/employees
 * Returns: { employees: [...] }
 */
export async function onRequestGet(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;

    // Get the list of employee IDs
    const listJson = await KV.get('employee-list');
    const employeeIds = listJson ? JSON.parse(listJson) : [];

    if (employeeIds.length === 0) {
      return jsonResponse({ employees: [] });
    }

    // Batch-read all employee records
    const employees = [];
    for (const id of employeeIds) {
      const empJson = await KV.get(`employee:${id}`);
      if (empJson) {
        employees.push(JSON.parse(empJson));
      }
    }

    return jsonResponse({ employees });
  } catch (err) {
    return jsonResponse({ error: 'Failed to fetch employees', details: err.message }, 500);
  }
}

/**
 * POST /api/employees
 * Body: { name, nameCn, code, group }
 * Returns: { success, employee }
 */
export async function onRequestPost(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;
    const body = await context.request.json();
    const { name, nameCn, code, group } = body;

    // Validate required fields
    if (!name || !code) {
      return jsonResponse({ error: 'Name and code are required' }, 400);
    }

    // Validate code format: must be exactly 4 digits
    if (!/^\d{4}$/.test(code)) {
      return jsonResponse({ error: 'Employee code must be exactly 4 digits' }, 400);
    }

    // Check code uniqueness
    const existingId = await KV.get(`employee-code:${code}`);
    if (existingId) {
      return jsonResponse({ error: `Employee code ${code} is already in use` }, 409);
    }

    // Create employee record
    const id = crypto.randomUUID();
    const employee = {
      id,
      name,
      nameCn: nameCn || '',
      code,
      group: group || '',
      createdAt: new Date().toISOString(),
    };

    // Store employee data
    await KV.put(`employee:${id}`, JSON.stringify(employee));

    // Create code-to-id mapping for fast lookup
    await KV.put(`employee-code:${code}`, id);

    // Update employee list
    const listJson = await KV.get('employee-list');
    const employeeIds = listJson ? JSON.parse(listJson) : [];
    employeeIds.push(id);
    await KV.put('employee-list', JSON.stringify(employeeIds));

    return jsonResponse({ success: true, employee }, 201);
  } catch (err) {
    return jsonResponse({ error: 'Failed to create employee', details: err.message }, 500);
  }
}
