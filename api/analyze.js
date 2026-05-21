// ═══════════════════════════════════════════════════════════════════
// /api/analyze.js — Vercel serverless function
// Proxies Gemini API request, keeps GEMINI_API_KEY server-side
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  // CORS headers (allow same-origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY not configured. Add it in Vercel project settings → Environment Variables.'
    });
  }

  try {
    const { user, images, mediaTypes } = req.body;

    if (!images || !images.front) {
      return res.status(400).json({ error: 'At least front image is required' });
    }

    // Build prompt
    const userContext = user ? `
User context (for analysis only, not stored):
- Skin type: ${user.skin_type || 'unknown'}
- Sensitive skin: ${user.sensitive || 'unknown'}
- Age range: ${user.age || 'unknown'}
` : '';

    const prompt = `You are an image analysis tool for a wellness app. Analyze the provided face photos for acne severity using the Global Acne Grading System (GAGS) methodology.

You are NOT a medical device. Provide structured analysis only.

${userContext}

The images are three views of the same person: front, left profile (subject's left cheek visible), right profile (subject's right cheek visible). Use ALL provided images together to assess each of the 5 GAGS facial regions.

For each region, count lesions by type and identify the WORST lesion type visible.

Lesion types (increasing severity):
- comedones: blackheads or whiteheads, non-inflammatory
- papules: small red inflamed bumps (no visible pus)
- pustules: pus-filled inflammatory spots
- nodules: large, deep, painful-appearing lesions

Return ONLY valid JSON with this exact schema, no markdown fences, no preamble:

{
  "regions": {
    "forehead":    { "comedones": <int>, "papules": <int>, "pustules": <int>, "nodules": <int>, "worst": "<none|comedones|papules|pustules|nodules>" },
    "right_cheek": { "comedones": <int>, "papules": <int>, "pustules": <int>, "nodules": <int>, "worst": "<none|comedones|papules|pustules|nodules>" },
    "left_cheek":  { "comedones": <int>, "papules": <int>, "pustules": <int>, "nodules": <int>, "worst": "<none|comedones|papules|pustules|nodules>" },
    "nose":        { "comedones": <int>, "papules": <int>, "pustules": <int>, "nodules": <int>, "worst": "<none|comedones|papules|pustules|nodules>" },
    "chin":        { "comedones": <int>, "papules": <int>, "pustules": <int>, "nodules": <int>, "worst": "<none|comedones|papules|pustules|nodules>" }
  },
  "image_quality_note": "<string with any issues, or empty string if good>",
  "usable": <true|false>
}

Critical rules:
- Right/left refers to the SUBJECT'S anatomical right/left (not viewer perspective).
- "worst" is the highest-grade lesion type actually visible in the region. If none visible: "none".
- Be conservative — only count clearly visible lesions.
- If images are unusable (severely blurred, no face, etc), set usable=false with explanation.`;

    // Build Gemini request parts
    const parts = [];
    parts.push({ text: 'Image 1 — Frontal view:' });
    parts.push({ inline_data: { mime_type: mediaTypes.front || 'image/jpeg', data: images.front } });

    if (images.left) {
      parts.push({ text: 'Image 2 — Left profile:' });
      parts.push({ inline_data: { mime_type: mediaTypes.left || 'image/jpeg', data: images.left } });
    }
    if (images.right) {
      parts.push({ text: 'Image 3 — Right profile:' });
      parts.push({ inline_data: { mime_type: mediaTypes.right || 'image/jpeg', data: images.right } });
    }
    parts.push({ text: prompt });

    // Gemini 2.5 Flash — gemini-1.5-flash was retired and now returns 404.
    // Using the stable 2.5 Flash model. To always get the newest Flash release,
    // swap "gemini-2.5-flash" for "gemini-flash-latest".
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('Gemini API error:', geminiResponse.status, errText);
      return res.status(geminiResponse.status).json({
        error: `Gemini API error (${geminiResponse.status}). Check your API key and quota.`
      });
    }

    const data = await geminiResponse.json();

    // Extract text from Gemini response
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(500).json({ error: 'Empty response from Gemini', raw: data });
    }

    // Strip any leftover markdown fences just in case
    let cleaned = text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({
        error: 'Could not parse model response as JSON',
        raw: cleaned.substring(0, 500)
      });
    }

    // Validate structure & fill defaults
    const defaultRegion = { comedones: 0, papules: 0, pustules: 0, nodules: 0, worst: 'none' };
    const regions = ['forehead', 'right_cheek', 'left_cheek', 'nose', 'chin'];
    if (!parsed.regions) parsed.regions = {};
    regions.forEach(r => {
      if (!parsed.regions[r]) parsed.regions[r] = { ...defaultRegion };
      else {
        const reg = parsed.regions[r];
        reg.comedones = Number(reg.comedones) || 0;
        reg.papules = Number(reg.papules) || 0;
        reg.pustules = Number(reg.pustules) || 0;
        reg.nodules = Number(reg.nodules) || 0;
        if (!['none', 'comedones', 'papules', 'pustules', 'nodules'].includes(reg.worst)) {
          reg.worst = 'none';
        }
      }
    });
    if (typeof parsed.image_quality_note !== 'string') parsed.image_quality_note = '';
    if (typeof parsed.usable !== 'boolean') parsed.usable = true;

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
