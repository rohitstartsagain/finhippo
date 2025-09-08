// /netlify/functions/query.js
import { createClient } from '@supabase/supabase-js';

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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // server-only
);

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: 'OK' };
  }

  try {
    if (!process.env.OPENAI_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, headers: jsonHeaders(), body: JSON.stringify({ error: 'Missing server env vars' }) };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: jsonHeaders(), body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const { question, group_code } = JSON.parse(event.body || '{}');
    if (!question || !group_code) {
      return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: 'Missing question/group_code' }) };
    }

    const sys = `You convert finance questions into a JSON spec.
Fields: period ('last_month'|'this_month'|'all_time'), metric ('sum'), field ('amount'),
filter_category (optional free text), answer_style ('short').`;
    const usr = `Question: ${question}`;

    const ai = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
        response_format: { type: 'json_object' }
      })
    });

    const aiJson = await ai.json();
    let spec = {};
    try { spec = JSON.parse(aiJson?.choices?.[0]?.message?.content || '{}'); } catch { spec = {}; }

    const today = new Date();
    const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const firstLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

    let from = null, to = null;
    if (spec.period === 'last_month') { from = firstLastMonth; to = endLastMonth; }
    else if (spec.period === 'this_month') { from = firstThisMonth; to = today; }

    let q = supabase
      .from('expenses')
      .select('amount, category, title, spent_at')
      .eq('group_code', group_code);

    if (from && to) {
      q = q
        .gte('spent_at', from.toISOString().slice(0, 10))
        .lte('spent_at', to.toISOString().slice(0, 10));
    }

    if (spec.filter_category) {
      const term = `%${spec.filter_category}%`;
      // ✅ correct Supabase `.or()` syntax
      q = q.or(`category.ilike.${term},title.ilike.${term}`);
    }

    const { data, error } = await q;
    if (error) throw error;

    const total = (data || []).reduce((s, r) => s + Number(r.amount || 0), 0);

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
