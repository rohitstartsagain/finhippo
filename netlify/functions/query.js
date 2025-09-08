// /netlify/functions/query.js  (ESM, zero npm deps)
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

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: 'OK' };
  }

  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
      return { statusCode: 500, headers: jsonHeaders(), body: JSON.stringify({ error: 'Missing server env vars' }) };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: jsonHeaders(), body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const { question, group_code } = JSON.parse(event.body || '{}');
    if (!question || !group_code) {
      return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: 'Missing question/group_code' }) };
    }

    // 1) NL -> spec (OpenAI)
    const sys = `You convert finance questions into a JSON spec.
Fields: period ('last_month'|'this_month'|'all_time'), metric ('sum'), field ('amount'),
filter_category (optional free text), answer_style ('short').`;
    const usr = `Question: ${question}`;

    const ai = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
        response_format: { type: 'json_object' }
      })
    });
    const aiJson = await ai.json();
    let spec = {};
    try { spec = JSON.parse(aiJson?.choices?.[0]?.message?.content || '{}'); } catch { spec = {}; }

    // 2) Resolve dates
    const today = new Date();
    const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const firstLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

    let from = null, to = null;
    if (spec.period === 'last_month') { from = firstLastMonth; to = endLastMonth; }
    else if (spec.period === 'this_month') { from = firstThisMonth; to = today; }

    // 3) Build REST URL to /rest/v1/expenses
    const url = new URL(`${SUPABASE_URL}/rest/v1/expenses`);
    url.searchParams.set('select', 'amount,category,title,spent_at');
    url.searchParams.set('group_code', `eq.${group_code}`);
    if (from && to) {
      url.searchParams.set('spent_at', `gte.${from.toISOString().slice(0, 10)}`);
      url.searchParams.append('spent_at', `lte.${to.toISOString().slice(0, 10)}`);
    }
    if (spec.filter_category) {
      const term = `*${spec.filter_category}*`;
      // match either category or title
      url.searchParams.set('or', `(category.ilike.${term},title.ilike.${term})`);
    }
    // max 1000 rows should be plenty for MVP; adjust if needed
    url.searchParams.set('limit', '1000');

    // 4) Fetch from Supabase REST with service role (bypasses RLS)
    const r = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'count=exact'
      }
    });
    if (!r.ok) {
      const errTxt = await r.text().catch(() => '');
      throw new Error(`Supabase error ${r.status}: ${errTxt}`);
    }
    const rows = await r.json();

    // 5) Sum
    const total = (rows || []).reduce((s, x) => s + Number(x.amount || 0), 0);

    const answer = {
      question,
      period: spec.period || 'all_time',
      category: spec.filter_category || 'all',
      total
    };

    return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify(answer) };
  } catch (e) {
    return { statusCode: 500, headers: jsonHeaders(), body: JSON.stringify({ error: e.message }) };
  }
}
