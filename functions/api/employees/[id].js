/**
 * Employee Detail API (by ID)
 * GET    /api/employees/:id — Get single employee
 * DELETE /api/employees/:id — Delete an employee
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
 * GET /api/employees/:id
 * Returns: { employee }
 */
export async function onRequestGet(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;
    const { id } = context.params;

    const empJson = await KV.get(`employee:${id}`);
    if (!empJson) {
      return jsonResponse({ error: 'Employee not found' }, 404);
    }

    return jsonResponse({ employee: JSON.parse(empJson) });
  } catch (err) {
    return jsonResponse({ error: 'Failed to fetch employee', details: err.message }, 500);
  }
}

/**
 * DELETE /api/employees/:id
 * Returns: { success }
 */
export async function onRequestDelete(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;
    const { id } = context.params;

    // Read the employee to get their code (needed to clean up code mapping)
    const empJson = await KV.get(`employee:${id}`);
    if (!empJson) {
      return jsonResponse({ error: 'Employee not found' }, 404);
    }

    const employee = JSON.parse(empJson);

    // Delete employee record
    await KV.delete(`employee:${id}`);

    // Delete code-to-id mapping
    if (employee.code) {
      await KV.delete(`employee-code:${employee.code}`);
    }

    // Remove from employee list
    const listJson = await KV.get('employee-list');
    if (listJson) {
      const employeeIds = JSON.parse(listJson);
      const updatedIds = employeeIds.filter((eid) => eid !== id);
      await KV.put('employee-list', JSON.stringify(updatedIds));
    }

    return jsonResponse({ success: true, deletedId: id });
  } catch (err) {
    return jsonResponse({ error: 'Failed to delete employee', details: err.message }, 500);
  }
}
