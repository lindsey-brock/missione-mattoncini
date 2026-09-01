import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })

  const { data, error } = await supabase
    .from("workshops")
    .select("num, max_spots, spots_taken")

  if (error) {
    console.error("DB error:", error)
    return new Response(JSON.stringify({ error: "Errore interno" }), { status: 500, headers: CORS })
  }

  const availability = (data ?? []).map(w => ({
    num: w.num,
    spotsAvailable: Math.max(0, w.max_spots - w.spots_taken),
    isFull: w.spots_taken >= w.max_spots,
  }))

  return new Response(JSON.stringify({ availability }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  })
})
