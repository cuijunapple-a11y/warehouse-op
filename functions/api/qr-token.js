/**
 * QR Token Generation API
 * GET /api/qr-token — Generate and return today's QR token
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
 * GET /api/qr-token
 * Returns: { token, date }
 */
export async function onRequestGet(context) {
  try {
    // Get the secret from KV config or env var, with a dev default
    const KV = context.env.WAREHOUSE_KV;
    let secret;

    try {
      secret = await KV.get('config:qr-secret');
    } catch {
      // KV read failed, fall through to env/default
    }

    if (!secret) {
      secret = context.env.QR_SECRET || 'warehouse-secret-2024';
    }

    const today = new Date().toISOString().split('T')[0];
    const token = await generateDailyToken(secret, today);

    return jsonResponse({ token, date: today });
  } catch (err) {
    return jsonResponse({ error: 'Failed to generate QR token', details: err.message }, 500);
  }
}
