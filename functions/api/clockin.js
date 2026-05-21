/**
 * Clock-in API
 * POST /api/clockin — Employee clock in or verify
 * GET  /api/clockin?date=YYYY-MM-DD — Get all clockin records for a date
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
 * Generate a daily HMAC-based token from the date string and a secret.
 * Returns the first 8 hex characters of the HMAC-SHA256 signature.
 */
async function generateDailyToken(secret, date) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(date));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 8);
}

/**
 * Get today's date string in YYYY-MM-DD format (UTC).
 */
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// Valid clock-in types
const VALID_TYPES = [
  'verify',      // Verify token + code only, no record created
  'checkin',
  'take-task',
  'return-task',
  'break',
  'lunch',
  'checkout',
  'transfer',
];

// Groups that can be transferred to
const VALID_GROUPS = ['maintenance', 'shelving', 'outbound'];

/**
 * POST /api/clockin
 * Body: { token, code, type, taskNo?, group? }
 * Returns: { success, employee: { name, nameCn }, record? }
 */
export async function onRequestPost(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;
    const body = await context.request.json();
    const { token, code, type, taskNo, group } = body;

    // --- Validate required fields ---
    if (!token || !code || !type) {
      return jsonResponse({ error: 'Token, code, and type are required' }, 400);
    }

    // Validate type
    if (!VALID_TYPES.includes(type)) {
      return jsonResponse(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` },
        400
      );
    }

    // --- Validate daily token ---
    const secret = context.env.QR_SECRET || 'warehouse-secret-2024';
    const today = getTodayDate();
    const expectedToken = await generateDailyToken(secret, today);

    if (token !== expectedToken) {
      return jsonResponse({ error: 'Invalid or expired QR token' }, 401);
    }

    // --- Look up employee by code ---
    const employeeId = await KV.get(`employee-code:${code}`);
    if (!employeeId) {
      return jsonResponse({ error: `No employee found with code ${code}` }, 404);
    }

    const empJson = await KV.get(`employee:${employeeId}`);
    if (!empJson) {
      return jsonResponse({ error: 'Employee record not found' }, 404);
    }

    const employee = JSON.parse(empJson);

    // --- Handle 'verify' type: return employee info without creating a record ---
    if (type === 'verify') {
      return jsonResponse({
        success: true,
        employee: {
          id: employee.id,
          name: employee.name,
          nameCn: employee.nameCn,
          code: employee.code,
          group: employee.group,
        },
      });
    }

    // --- Type-specific validation ---
    if (type === 'take-task' && !taskNo) {
      return jsonResponse({ error: 'taskNo is required for take-task type' }, 400);
    }

    if (type === 'transfer') {
      if (!group) {
        return jsonResponse({ error: 'group is required for transfer type' }, 400);
      }
      if (!VALID_GROUPS.includes(group)) {
        return jsonResponse(
          { error: `Invalid group. Must be one of: ${VALID_GROUPS.join(', ')}` },
          400
        );
      }
    }

    // --- Create clock-in record ---
    const recordId = crypto.randomUUID();
    const record = {
      id: recordId,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeNameCn: employee.nameCn || '',
      type,
      taskNo: taskNo || null,
      group: type === 'transfer' ? group : (employee.group || null),
      timestamp: new Date().toISOString(),
    };

    // Store the record keyed by date
    await KV.put(`clockin:${today}:${recordId}`, JSON.stringify(record));

    // Update the daily clockin list
    const listKey = `clockin-list:${today}`;
    const listJson = await KV.get(listKey);
    const recordIds = listJson ? JSON.parse(listJson) : [];
    recordIds.push(recordId);
    await KV.put(listKey, JSON.stringify(recordIds));

    // If transfer, also update employee's group
    if (type === 'transfer') {
      employee.group = group;
      await KV.put(`employee:${employee.id}`, JSON.stringify(employee));
    }

    return jsonResponse({
      success: true,
      employee: { name: employee.name, nameCn: employee.nameCn },
      record,
    });
  } catch (err) {
    return jsonResponse({ error: 'Failed to process clock-in', details: err.message }, 500);
  }
}

/**
 * GET /api/clockin?date=YYYY-MM-DD
 * Returns: { date, records: [...] }
 */
export async function onRequestGet(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;
    const url = new URL(context.request.url);
    const date = url.searchParams.get('date') || getTodayDate();

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonResponse({ error: 'Date must be in YYYY-MM-DD format' }, 400);
    }

    // Get the list of record IDs for the date
    const listKey = `clockin-list:${date}`;
    const listJson = await KV.get(listKey);
    const recordIds = listJson ? JSON.parse(listJson) : [];

    if (recordIds.length === 0) {
      return jsonResponse({ date, records: [] });
    }

    // Fetch all records
    const records = [];
    for (const rid of recordIds) {
      const recJson = await KV.get(`clockin:${date}:${rid}`);
      if (recJson) {
        records.push(JSON.parse(recJson));
      }
    }

    // Sort by timestamp descending (most recent first)
    records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return jsonResponse({ date, records });
  } catch (err) {
    return jsonResponse({ error: 'Failed to fetch clockin records', details: err.message }, 500);
  }
}
