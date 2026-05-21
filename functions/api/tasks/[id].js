/**
 * Task Detail API (by ID)
 * PUT    /api/tasks/:id — Update task (complete or partial)
 * DELETE /api/tasks/:id — Delete a task
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
 * GET /api/tasks/:id
 * Returns: { task }
 */
export async function onRequestGet(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;
    const { id } = context.params;

    const taskJson = await KV.get(`task:${id}`);
    if (!taskJson) {
      return jsonResponse({ error: 'Task not found' }, 404);
    }

    return jsonResponse({ task: JSON.parse(taskJson) });
  } catch (err) {
    return jsonResponse({ error: 'Failed to fetch task', details: err.message }, 500);
  }
}

/**
 * PUT /api/tasks/:id
 * Body: { action: 'complete' | 'partial', completedQty? }
 * Returns: { success, task }
 */
export async function onRequestPut(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;
    const { id } = context.params;
    const body = await context.request.json();
    const { action, completedQty } = body;

    // Validate action
    if (!action || !['complete', 'partial', 'cancel'].includes(action)) {
      return jsonResponse(
        { error: "Action must be 'complete', 'partial', or 'cancel'" },
        400
      );
    }

    // Read existing task
    const taskJson = await KV.get(`task:${id}`);
    if (!taskJson) {
      return jsonResponse({ error: 'Task not found' }, 404);
    }

    const task = JSON.parse(taskJson);
    const now = new Date().toISOString();

    if (action === 'complete') {
      // Mark as fully completed
      task.status = 'completed';
      task.completedQty = task.quantity;
      task.updatedAt = now;
    } else if (action === 'partial') {
      // Partially update completedQty
      if (completedQty === undefined || completedQty === null) {
        return jsonResponse(
          { error: 'completedQty is required for partial action' },
          400
        );
      }

      if (typeof completedQty !== 'number' || completedQty < 0) {
        return jsonResponse(
          { error: 'completedQty must be a non-negative number' },
          400
        );
      }

      task.completedQty = completedQty;
      task.updatedAt = now;

      // Auto-complete if completedQty meets or exceeds quantity
      if (task.completedQty >= task.quantity) {
        task.status = 'completed';
      }
    } else if (action === 'cancel') {
      task.status = 'cancelled';
      task.updatedAt = now;
    }

    // Save updated task
    await KV.put(`task:${id}`, JSON.stringify(task));

    return jsonResponse({ success: true, task });
  } catch (err) {
    return jsonResponse({ error: 'Failed to update task', details: err.message }, 500);
  }
}

/**
 * DELETE /api/tasks/:id
 * Returns: { success }
 */
export async function onRequestDelete(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;
    const { id } = context.params;

    // Verify task exists
    const taskJson = await KV.get(`task:${id}`);
    if (!taskJson) {
      return jsonResponse({ error: 'Task not found' }, 404);
    }

    // Delete task record
    await KV.delete(`task:${id}`);

    // Remove from task list
    const listJson = await KV.get('task-list');
    if (listJson) {
      const taskIds = JSON.parse(listJson);
      const updatedIds = taskIds.filter((tid) => tid !== id);
      await KV.put('task-list', JSON.stringify(updatedIds));
    }

    return jsonResponse({ success: true, deletedId: id });
  } catch (err) {
    return jsonResponse({ error: 'Failed to delete task', details: err.message }, 500);
  }
}
