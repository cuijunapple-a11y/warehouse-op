/**
 * Record Detail API (by ID)
 * PUT    /api/records/:id — Update a specific field in a record
 * DELETE /api/records/:id — Delete a clock-in record
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
 * Try to find a clockin record by ID across recent dates.
 * Returns { key, record, date } if found.
 */
async function findClockinRecord(KV, id, hintDate) {
  // Try the hint date first, then today
  const datesToTry = [hintDate, getTodayDate()].filter(Boolean);
  // Remove duplicates
  const uniqueDates = [...new Set(datesToTry)];

  for (const d of uniqueDates) {
    const key = `clockin:${d}:${id}`;
    const json = await KV.get(key);
    if (json) {
      return { key, record: JSON.parse(json), date: d };
    }
  }

  // If not found in hint dates, scan recent 7 days
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    if (uniqueDates.includes(dateStr)) continue;

    const key = `clockin:${dateStr}:${id}`;
    const json = await KV.get(key);
    if (json) {
      return { key, record: JSON.parse(json), date: dateStr };
    }
  }

  return null;
}

/**
 * PUT /api/records/:id
 * Body: { recordType?: 'clockin'|'task', field, value, date? }
 *   OR: { qty: number, date? }  (simplified format for inline editing)
 * Returns: { success, record }
 */
export async function onRequestPut(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;
    const { id } = context.params;
    const body = await context.request.json();

    // Support simplified format: { qty: number }
    let recordType = body.recordType || 'clockin';
    let field = body.field;
    let value = body.value;
    const date = body.date;

    // Handle simplified field updates (e.g. { qty: 5 })
    if (!field && !body.recordType) {
      const keys = Object.keys(body).filter(k => k !== 'date' && k !== 'recordType');
      if (keys.length === 1) {
        field = keys[0];
        value = body[keys[0]];
      }
    }

    if (!field || value === undefined) {
      return jsonResponse(
        { error: 'field and value are required (or use simplified {fieldName: value} format)' },
        400
      );
    }

    // Prevent updating the record ID
    if (field === 'id') {
      return jsonResponse({ error: 'Cannot update record ID' }, 400);
    }

    let record;

    if (recordType === 'clockin') {
      const found = await findClockinRecord(KV, id, date);

      if (!found) {
        return jsonResponse({ error: 'Clock-in record not found' }, 404);
      }

      record = found.record;
      record[field] = value;
      await KV.put(found.key, JSON.stringify(record));
    } else if (recordType === 'task') {
      const key = `task:${id}`;
      const taskJson = await KV.get(key);

      if (!taskJson) {
        return jsonResponse({ error: 'Task record not found' }, 404);
      }

      record = JSON.parse(taskJson);
      record[field] = value;
      record.updatedAt = new Date().toISOString();

      // Auto-complete check
      if (field === 'completedQty' && typeof value === 'number') {
        if (value >= record.quantity) {
          record.status = 'completed';
        }
      }

      await KV.put(key, JSON.stringify(record));
    }

    return jsonResponse({ success: true, record });
  } catch (err) {
    return jsonResponse({ error: 'Failed to update record', details: err.message }, 500);
  }
}

/**
 * DELETE /api/records/:id?date=YYYY-MM-DD
 * Deletes a clock-in record.
 * Returns: { success }
 */
export async function onRequestDelete(context) {
  try {
    const KV = context.env.WAREHOUSE_KV;
    const { id } = context.params;
    const url = new URL(context.request.url);
    const date = url.searchParams.get('date');

    // Find the record
    const found = await findClockinRecord(KV, id, date);

    if (!found) {
      return jsonResponse({ error: 'Record not found' }, 404);
    }

    // Delete the record
    await KV.delete(found.key);

    // Remove from daily list
    const listKey = `clockin-list:${found.date}`;
    const listJson = await KV.get(listKey);
    if (listJson) {
      const recordIds = JSON.parse(listJson);
      const updatedIds = recordIds.filter(rid => rid !== id);
      await KV.put(listKey, JSON.stringify(updatedIds));
    }

    return jsonResponse({ success: true, deletedId: id });
  } catch (err) {
    return jsonResponse({ error: 'Failed to delete record', details: err.message }, 500);
  }
}
