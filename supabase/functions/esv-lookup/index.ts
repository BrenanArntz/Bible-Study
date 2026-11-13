import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond({ detail: "Use POST for passage lookup." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return respond({ detail: "Sign in before looking up a passage." }, 401);
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return respond({ detail: "Your session is no longer valid. Sign in again." }, 401);
  }

  let reference: unknown;
  try {
    reference = (await request.json()).q;
  } catch {
    return respond({ detail: "Request body must contain a passage reference." }, 400);
  }
  if (typeof reference !== "string" || !reference.trim() || reference.length > 200) {
    return respond({ detail: "Enter a valid passage reference." }, 400);
  }

  const apiKey = Deno.env.get("ESV_API_KEY");
  if (!apiKey) {
    return respond({ detail: "ESV lookup is not configured in Supabase yet." }, 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const url = new URL("https://api.esv.org/v3/passage/text/");
  url.search = new URLSearchParams({
    q: reference.trim(),
    "include-passage-references": "false",
    "include-verse-numbers": "true",
    "include-first-verse-numbers": "true",
    "include-footnotes": "false",
    "include-headings": "false",
    "include-short-copyright": "true",
    "line-length": "0",
  }).toString();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Token ${apiKey}` },
      signal: controller.signal,
    });
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError"
      ? "The ESV API request timed out."
      : "The ESV API request failed.";
    return respond({ detail }, 502);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    return respond({ detail: `The ESV API returned HTTP ${response.status}.` }, 502);
  }
  let data: { passages?: unknown };
  try {
    data = await response.json();
  } catch {
    return respond({ detail: "The ESV API returned invalid JSON." }, 502);
  }
  const passage = Array.isArray(data.passages) ? data.passages[0] : null;
  if (typeof passage !== "string" || !passage.trim()) {
    return respond({ detail: "The ESV API returned no passage text." }, 404);
  }
  return respond({ reference: reference.trim(), text: passage.trim(), available: true });
});
