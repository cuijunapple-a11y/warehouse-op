/**
 * Records Query API
 * GET /api/records?date=YYYY-MM-DD&type=clockin|tasks|all — Query combined records
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
 * Get today's date string in YYYY-MM-DD format (UTC).
 */
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

/**
 * GET /api/records?date=YYYY-MM-DD&type=clockin|tasks|all
 * Returns: { date, clockinRecords?, taskRecords?, records? }
 */
export async function onRequestGet(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;
    const url = new URL(context.request.url);
    const date = url.searchParams.get('date') || getTodayDate();
    const recordType = url.searchParams.get('type') || 'all';

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonResponse({ error: 'Date must be in YYYY-MM-DD format' }, 400);
    }

    // Validate type
    if (!['clockin', 'tasks', 'all'].includes(recordType)) {
      return jsonResponse(
        { error: 'Type must be one of: clockin, tasks, all' },
        400
      );
    }

    const result = { date };

    // Fetch clockin records
    if (recordType === 'clockin' || recordType === 'all') {
      const listKey = `clockin-list:${date}`;
      const listJson = await KV.get(listKey);
      const recordIds = listJson ? JSON.parse(listJson) : [];

      const clockinRecords = [];
      for (const rid of recordIds) {
        const recJson = await KV.get(`clockin:${date}:${rid}`);
        if (recJson) {
          clockinRecords.push(JSON.parse(recJson));
        }
      }

      // Sort by timestamp descending
      clockinRecords.sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
      );
      result.clockinRecords = clockinRecords;
    }

    // Fetch task records
    if (recordType === 'tasks' || recordType === 'all') {
      const listJson = await KV.get('task-list');
      const taskIds = listJson ? JSON.parse(listJson) : [];

      const taskRecords = [];
      for (const tid of taskIds) {
        const taskJson = await KV.get(`task:${tid}`);
        if (taskJson) {
          const task = JSON.parse(taskJson);
          // Filter tasks by date (match on createdAt date)
          const taskDate = task.createdAt.split('T')[0];
          if (taskDate === date) {
            taskRecords.push(task);
          }
        }
      }

      // Sort by createdAt descending
      taskRecords.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
      result.taskRecords = taskRecords;
    }

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: 'Failed to fetch records', details: err.message }, 500);
  }
}
