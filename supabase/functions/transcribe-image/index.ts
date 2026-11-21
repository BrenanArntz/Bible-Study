import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) return new Response(JSON.stringify({ detail: "Gemini transcription is not configured." }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    let inlineImage: { mimeType: string; data: string } | null = null;
    if (typeof body.imageBase64 === "string" && body.imageBase64.length) {
      inlineImage = {
        mimeType: typeof body.contentType === "string" ? body.contentType : "image/jpeg",
        data: body.imageBase64,
      };
    } else if (typeof body.imagePath === "string") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const downloaded = await supabase.storage.from("study-images").download(body.imagePath);
      if (downloaded.error) throw new Error(downloaded.error.message);
      const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      inlineImage = {
        mimeType: downloaded.data.type || "image/jpeg",
        data: btoa(binary),
      };
    }
    if (!inlineImage) throw new Error("Provide imageBase64 or imagePath.");

    const prompt = `Transcribe this handwritten study page accurately.

Return only JSON using this exact schema:
{"notes":[{"transcription":"string","category":"exegesis|topics|church-history","identifier":"string","title":"string","date":"string","reference":"string"}]}

Rules:
- Look at the top corner for an identifier. E### means exegesis, T### means topics, and CH### means church-history. Return identifier exactly as E###, T###, or CH###. Return identifier "" if no tag is present.
- Extract a top-center passage or heading, for example "Acts 11", "Acts 23", or a topic/church-history heading, into title and reference. reference should be the passage/subject reference.
- Normalize dates in the page to YYYY-MM-DD. For example 3/8/26 becomes 2026-03-08.
- Transcribe mixed English and Greek/Hebrew words exactly, including words such as διασπείρω.
- Preserve verse numbers at the beginning of paragraphs exactly, such as 27-30, 19, 5, 6, or 3.
- For a non-continuation page with no explicit heading, generate a concise descriptive title of 3–6 words.
- Preserve paragraph structure and handwritten text faithfully. Do not invent missing text.`;

    const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inlineData: inlineImage },
          ] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gemini transcription failed: ${detail.slice(0, 500)}`);
    }
    const payload = await response.json();
    const text = payload.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("") || "";
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.notes)) throw new Error("Gemini returned an invalid transcription.");

    const notes = parsed.notes.map((note: Record<string, unknown>) => {
      const identifier = typeof note.identifier === "string"
        ? note.identifier.trim().toUpperCase()
        : "";
      const normalizedIdentifier = /^(?:CH|[ET])\d{3}$/.test(identifier) ? identifier : "";
      const category = normalizedIdentifier.startsWith("CH")
        ? "church-history"
        : normalizedIdentifier.startsWith("E")
          ? "exegesis"
          : normalizedIdentifier.startsWith("T")
            ? "topics"
            : ["exegesis", "topics", "church-history"].includes(String(note.category))
              ? String(note.category)
              : "topics";
      return {
        transcription: typeof note.transcription === "string" ? note.transcription : "",
        category,
        identifier: normalizedIdentifier,
        title: typeof note.title === "string" ? note.title : "",
        date: typeof note.date === "string" ? note.date : "",
        reference: typeof note.reference === "string" ? note.reference : "",
      };
    });
    return new Response(JSON.stringify({ provider: "gemini", notes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ detail: error instanceof Error ? error.message : "Unknown transcription error." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
