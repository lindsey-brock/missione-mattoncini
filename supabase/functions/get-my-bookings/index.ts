import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 })

  // Verify JWT from Authorization header
  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Non autorizzato" }), { status: 401, headers: CORS })
  }
  const jwt = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user?.email) {
    return new Response(JSON.stringify({ error: "Sessione non valida" }), { status: 401, headers: CORS })
  }

  const { data, error } = await supabase
    .from("bookings")
    .select("id, nome_bambino, nome_genitore, workshops, bambini_count, amount_cents, confirmed_at, status")
    .eq("email", user.email.toLowerCase())
    .eq("stripe_status", "succeeded")
    .order("confirmed_at", { ascending: true })

  if (error) {
    console.error("DB error:", error)
    return new Response(JSON.stringify({ error: "Errore interno" }), { status: 500, headers: CORS })
  }

  return new Response(JSON.stringify({ bookings: data ?? [] }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  })
})
