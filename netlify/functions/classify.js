// netlify/functions/classify.js
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}
function jsonHeaders() {
  return { 'Content-Type': 'application/json', ...corsHeaders() };
}
function todayIST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: 'OK' };
  }

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: jsonHeaders(), body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const { text } = JSON.parse(event.body || '{}');
    if (!text) {
      return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: 'Missing text' }) };
    }

    const system = `You are an expense extraction assistant. Given a short message about a purchase, extract a clean expense.
Return JSON with: title (short), amount (number), currency (ISO like INR), category (Food, Groceries, Transport, Fuel, Rent, Utilities, Entertainment, Shopping, Health, Education, Misc), spent_at (YYYY-MM-DD), raw (original).
If you cannot find amount, set amount to 0 and category to 'Misc'. If date is missing, use today's date in IST.`;

    const user = `Message: ${text}\nToday (IST): ${todayIST()}`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const data = await r.json();
    let obj = {};
    try {
      obj = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
    } catch { obj = {}; }

    const allowed = ['Food','Groceries','Transport','Fuel','Rent','Utilities','Entertainment','Shopping','Health','Education','Misc'];
    const category = allowed.includes(obj.category) ? obj.category : 'Misc';
    const spent_at = (obj.spent_at && /^\d{4}-\d{2}-\d{2}$/.test(obj.spent_at)) ? obj.spent_at : todayIST();

    const payload = {
      title: (obj.title || '').toString().slice(0, 120) || 'Expense',
      amount: Number(obj.amount) || 0,
      currency: (obj.currency || 'INR').toString().toUpperCase(),
      category,
      spent_at,
      raw: text
    };

    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify(payload) };
  } catch (e) {
    return { statusCode: 500, headers: jsonHeaders(), body: JSON.stringify({ error: e.message }) };
  }
}
