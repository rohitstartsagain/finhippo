exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { text } = JSON.parse(event.body || '{}');
    if (!text) {
      return { statusCode: 400, body: 'Missing text' };
    }

    const system = `You are an expense extraction assistant. Given a short message about a purchase, extract a clean expense.
Return JSON with: title (short), amount (number), currency (ISO like INR), category (Food, Groceries, Transport, Fuel, Rent, Utilities, Entertainment, Shopping, Health, Education, Misc), spent_at (YYYY-MM-DD), raw (original).
If you cannot find amount, set amount to 0 and category to 'Misc'.`;

    const user = `Message: ${text}\nToday (IST): ${new Date().toISOString().slice(0,10)}`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
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
    const content = data?.choices?.[0]?.message?.content || '{}';
    return { statusCode: 200, body: content };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};

