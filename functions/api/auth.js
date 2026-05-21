/**
 * Admin Authentication API
 * POST /api/auth — Login with password, returns session token
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
 * POST /api/auth
 * Body: { password }
 * Returns: { success, token }
 */
export async function onRequestPost(context) {
  try {
    const { password } = await context.request.json();

    if (!password) {
      return jsonResponse({ error: 'Password is required' }, 400);
    }

    // Check password against env var or default
    const adminPassword = context.env.ADMIN_PASSWORD || 'admin123';

    if (password !== adminPassword) {
      return jsonResponse({ error: 'Invalid password' }, 401);
    }

    // Generate a random session token
    const token = crypto.randomUUID();
    const now = Date.now();
    const ttl = 24 * 60 * 60; // 24 hours in seconds

    const sessionData = {
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl * 1000).toISOString(),
    };

    // Store session in KV with 24h TTL
    await context.env.WAREHOUSE_KV.put(
      `admin-session:${token}`,
      JSON.stringify(sessionData),
      { expirationTtl: ttl }
    );

    return jsonResponse({ success: true, token });
  } catch (err) {
    return jsonResponse({ error: 'Failed to authenticate', details: err.message }, 500);
  }
}

/**
 * GET /api/auth
 * Verify current session token validity.
 * Header: Authorization: Bearer <token>
 * Returns: { valid: true/false }
 */
export async function onRequestGet(context) {
  try {
    const authHeader = context.request.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ valid: false, error: 'No token provided' }, 401);
    }

    const token = authHeader.substring(7);
    const session = await context.env.WAREHOUSE_KV.get(`admin-session:${token}`);

    if (!session) {
      return jsonResponse({ valid: false, error: 'Invalid or expired token' }, 401);
    }

    const sessionData = JSON.parse(session);
    return jsonResponse({ valid: true, expiresAt: sessionData.expiresAt });
  } catch (err) {
    return jsonResponse({ error: 'Failed to verify session', details: err.message }, 500);
  }
}
