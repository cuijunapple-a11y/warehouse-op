/**
 * Task Management API
 * GET  /api/tasks?status=active|completed|all — List tasks
 * POST /api/tasks — Create a new task
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
 * GET /api/tasks?status=active|completed|all
 * Returns: { tasks: [...] }
 */
export async function onRequestGet(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;
    const url = new URL(context.request.url);
    const statusFilter = url.searchParams.get('status') || 'all';

    // Validate status filter
    if (!['active', 'completed', 'cancelled', 'all'].includes(statusFilter)) {
      return jsonResponse(
        { error: 'Status must be one of: active, completed, cancelled, all' },
        400
      );
    }

    // Get the list of task IDs
    const listJson = await KV.get('task-list');
    const taskIds = listJson ? JSON.parse(listJson) : [];

    if (taskIds.length === 0) {
      return jsonResponse({ tasks: [] });
    }

    // Fetch all tasks
    const tasks = [];
    for (const id of taskIds) {
      const taskJson = await KV.get(`task:${id}`);
      if (taskJson) {
        const task = JSON.parse(taskJson);

        // Apply status filter
        if (statusFilter === 'all' || task.status === statusFilter) {
          tasks.push(task);
        }
      }
    }

    // Sort by createdAt descending (most recent first)
    tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return jsonResponse({ tasks });
  } catch (err) {
    return jsonResponse({ error: 'Failed to fetch tasks', details: err.message }, 500);
  }
}

/**
 * POST /api/tasks
 * Body: { employeeId, taskNo, quantity, equipmentType }
 * Returns: { success, task }
 */
export async function onRequestPost(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;
    const body = await context.request.json();
    const { employeeId, taskNo, quantity, equipmentType } = body;
    const employeeIdVal = employeeId || body.employee_id;
    const taskNoVal = taskNo || body.task_no;
    const quantityVal = quantity ?? body.pick_qty;
    const equipmentVal = equipmentType || body.equipment || '';

    // Validate required fields
    if (!employeeId || !taskNo || quantity === undefined || quantity === null) {
      return jsonResponse(
        { error: 'employeeId, taskNo, and quantity are required' },
        400
      );
    }

    if (typeof quantity !== 'number' || quantity <= 0) {
      return jsonResponse({ error: 'Quantity must be a positive number' }, 400);
    }

    // Look up employee to get their name
    const empJson = await KV.get(`employee:${employeeId}`);
    if (!empJson) {
      return jsonResponse({ error: 'Employee not found' }, 404);
    }

    const employee = JSON.parse(empJson);

    // Create task record
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const task = {
      id,
      employeeId,
      employeeName: employee.name,
      taskNo,
      quantity,
      completedQty: 0,
      equipmentType: equipmentType || '',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    // Store task
    await KV.put(`task:${id}`, JSON.stringify(task));

    // Update task list
    const listJson = await KV.get('task-list');
    const taskIds = listJson ? JSON.parse(listJson) : [];
    taskIds.push(id);
    await KV.put('task-list', JSON.stringify(taskIds));

    return jsonResponse({ success: true, task }, 201);
  } catch (err) {
    return jsonResponse({ error: 'Failed to create task', details: err.message }, 500);
  }
}
