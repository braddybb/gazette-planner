// netlify/functions/gari-log.js
//
// Proxies GET requests to the GARI Apps Script log endpoint, so the
// browser doesn't need to call script.google.com directly (avoids CORS
// issues, and gives us one place to normalise the response shape).
//
// Usage from the browser: /.netlify/functions/gari-log?since=2026-05-04

const GARI_LOG_URL = 'https://script.google.com/macros/s/AKfycbyatEy_aejaDPwh1ZfRX1HvVMpYfKime1dkxCXU_mK7YYmq9Jt9UIEzEuBILT1aN8Fa/exec';

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const since = (event.queryStringParameters || {}).since;
  let url = GARI_LOG_URL;
  if (since) {
    url += '?since=' + encodeURIComponent(since);
  }

  try {
    const res = await fetch(url);
    const text = await res.text();

    // The Apps Script endpoint always returns JSON, but defend against
    // it ever returning something else (e.g. a Google sign-in HTML page,
    // which happens if the deployment's access setting reverts) rather
    // than crashing the whole Weekly Review.
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          status: 'error',
          message: 'GARI log endpoint did not return valid JSON — it may need redeploying or its access permission may have changed.',
        }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ status: 'error', message: 'Could not reach the GARI log: ' + err.message }),
    };
  }
};
