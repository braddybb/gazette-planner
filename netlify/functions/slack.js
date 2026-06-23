// Netlify Function — posts notifications to Slack via an Incoming Webhook.
//
// SETUP (one-time, on the Slack side):
//   1. Go to api.slack.com/apps -> Create New App -> From scratch
//   2. Name it (e.g. "Gazette Planner") and pick your workspace
//   3. Under "Incoming Webhooks", switch it on, then "Add New Webhook to Workspace"
//   4. Choose the channel it should post to (e.g. #newsroom)
//   5. Copy the Webhook URL it gives you (looks like https://hooks.slack.com/services/...)
//   6. In Netlify: Site settings -> Environment variables -> add SLACK_WEBHOOK_URL
//      with that URL as the value
//
// This function never exposes the webhook URL to the browser — the Planner
// calls this function, and this function (running on Netlify's servers)
// talks to Slack directly.

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    // Fail quietly — a missing Slack setup should never break the Planner
    // itself, just mean notifications don't go out.
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ skipped: true, reason: 'Slack webhook not configured' }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const text = body.text || '';
    if (!text) {
      return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Missing text' }) };
    }

    // Slack's "blocks" give a slightly nicer-looking message than plain
    // text alone, but plain text is always included as a fallback.
    const payload = {
      text: text,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: text },
        },
      ],
    };

    const slackRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!slackRes.ok) {
      const errText = await slackRes.text();
      return {
        statusCode: 502,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Slack rejected the message: ' + errText }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
