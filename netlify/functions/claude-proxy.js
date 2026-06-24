// netlify/functions/claude-proxy.js
//
// A thin server-side proxy so the browser never sees the real Anthropic
// API key. The key lives in Netlify's environment variables (set in the
// Netlify dashboard under Site settings → Environment variables —
// ANTHROPIC_API_KEY), never in this file or in the deployed HTML.
//
// The browser calls /.netlify/functions/claude-proxy with a JSON body
// shaped like { messages: [...], max_tokens: 2000 }, and this function
// forwards it to Anthropic with the real key attached.

exports.handler = async function (event) {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set on the server.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  // Basic guardrails — this proxy is only meant to serve this one feature,
  // not act as a general-purpose open relay to the Anthropic API.
  if (!payload.messages || !Array.isArray(payload.messages)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing messages array.' }) };
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: payload.model || 'claude-sonnet-4-6',
        max_tokens: payload.max_tokens || 2000,
        messages: payload.messages,
      }),
    });

    const data = await res.json();

    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Proxy request failed: ' + err.message }),
    };
  }
};
