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
    return respond({ detail: "Use POST to transcribe an image." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return respond({ detail: "Sign in before transcribing an image." }, 401);
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

  let imagePath: unknown;
  try {
    imagePath = (await request.json()).imagePath;
  } catch {
    return respond({ detail: "Request body must contain an image path." }, 400);
  }
  if (
    typeof imagePath !== "string"
    || !imagePath.startsWith(`${user.id}/`)
    || imagePath.includes("..")
    || imagePath.length > 300
  ) {
    return respond({ detail: "Invalid image path." }, 400);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return respond({ detail: "Gemini transcription is not configured in Supabase yet." }, 503);
  }

  const { data: image, error: downloadError } = await supabase.storage
    .from("study-images")
    .download(imagePath);
  if (downloadError || !image) {
    return respond({ detail: "Could not read the uploaded image from private storage." }, 400);
  }
  if (image.size > 25 * 1024 * 1024) {
    return respond({ detail: "Images must be 25 MB or smaller." }, 413);
  }

  try {
    const bytes = new Uint8Array(await image.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const mimeType = image.type === "image/png" ? "image/png" : "image/jpeg";
    let response: Response;
    try {
      response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: "Transcribe only the handwritten content. Ignore printed page labels. Preserve wording and line breaks; do not summarize or correct. Inspect the top for a handwritten title, date, and E/T number. Split only clearly distinct notes. Return JSON with a notes array; each entry has transcription, category (exegesis, topics, or church-history), identifier, title, date (YYYY-MM-DD), and reference. Use empty strings for unknown values. E-numbers are exegesis, T-numbers are topics.",
              },
              { inlineData: { mimeType, data: btoa(binary) } },
            ],
          }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                notes: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      transcription: { type: "STRING" },
                      category: { type: "STRING", enum: ["exegesis", "topics", "church-history"] },
                      identifier: { type: "STRING" },
                      title: { type: "STRING" },
                      date: { type: "STRING" },
                      reference: { type: "STRING" },
                    },
                    required: ["transcription", "category", "identifier", "title", "date", "reference"],
                  },
                },
              },
              required: ["notes"],
            },
          },
        }),
      },
      );
    } catch (error) {
      const detail = error instanceof Error
        ? `Could not reach Gemini for transcription: ${error.message}`
        : "Could not reach Gemini for transcription.";
      return respond({ detail }, 502);
    }
    if (!response.ok) {
      return respond({ detail: `Gemini returned HTTP ${response.status}; check its key, quota, and model access.` }, 502);
    }
    let payload: {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    try {
      payload = await response.json();
    } catch {
      return respond({ detail: "Gemini returned invalid JSON." }, 502);
    }
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "")
      .join("\n");
    let result: { notes?: unknown };
    try {
      result = JSON.parse(text || "{}");
    } catch {
      return respond({ detail: "Gemini returned malformed transcription data." }, 502);
    }
    if (!Array.isArray(result.notes) || result.notes.length === 0) {
      return respond({ detail: "Gemini returned no transcription." }, 502);
    }
    const categories = new Set(["exegesis", "topics", "church-history"]);
    const validNotes = result.notes.every((note) => (
      note
      && typeof note === "object"
      && typeof note.transcription === "string"
      && categories.has(note.category)
      && typeof note.identifier === "string"
      && typeof note.title === "string"
      && typeof note.date === "string"
      && typeof note.reference === "string"
    ));
    if (!validNotes) {
      return respond({ detail: "Gemini returned an incomplete note entry." }, 502);
    }
    return respond({ notes: result.notes, provider: "gemini" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Image transcription failed.";
    return respond({ detail }, 502);
  }
});
