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
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  // Verify JWT
  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Non autorizzato" }), { status: 401, headers: CORS })
  }
  const jwt = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user?.email) {
    return new Response(JSON.stringify({ error: "Sessione non valida" }), { status: 401, headers: CORS })
  }

  const { bookingId, fromWorkshop, toWorkshop } = await req.json()

  if (!bookingId || !fromWorkshop || !toWorkshop) {
    return new Response(JSON.stringify({ error: "Parametri mancanti" }), { status: 400, headers: CORS })
  }
  if (fromWorkshop === toWorkshop) {
    return new Response(JSON.stringify({ error: "Workshop uguale" }), { status: 400, headers: CORS })
  }

  // Verify booking belongs to authenticated user
  const { data: booking, error: fetchErr } = await supabase
    .from("bookings")
    .select("id, workshops, bambini_count, status")
    .eq("id", bookingId)
    .eq("email", user.email.toLowerCase())
    .eq("stripe_status", "succeeded")
    .single()

  if (fetchErr || !booking) {
    return new Response(JSON.stringify({ error: "Prenotazione non trovata" }), { status: 404, headers: CORS })
  }
  if (booking.status === "cancelled") {
    return new Response(JSON.stringify({ error: "Prenotazione già cancellata" }), { status: 400, headers: CORS })
  }
  if (!booking.workshops.includes(fromWorkshop)) {
    return new Response(JSON.stringify({ error: "Workshop non trovato in questa prenotazione" }), { status: 400, headers: CORS })
  }
  if (booking.workshops.includes(toWorkshop)) {
    return new Response(JSON.stringify({ error: "Sei già iscritto a questo workshop" }), { status: 400, headers: CORS })
  }

  // Check target workshop has capacity
  const { data: wsData, error: wsErr } = await supabase
    .from("workshops")
    .select("max_spots, spots_taken")
    .eq("num", toWorkshop)
    .single()

  if (wsErr || !wsData) {
    return new Response(JSON.stringify({ error: "Workshop di destinazione non trovato" }), { status: 404, headers: CORS })
  }

  const available = wsData.max_spots - wsData.spots_taken
  if (available < booking.bambini_count) {
    return new Response(JSON.stringify({
      error: `Posti insufficienti nel workshop M${toWorkshop} (${available} rimasti, ne servono ${booking.bambini_count})`
    }), { status: 409, headers: CORS })
  }

  // Update booking
  const newWorkshops = booking.workshops.map((w: string) => w === fromWorkshop ? toWorkshop : w)
  const { error: updateErr } = await supabase
    .from("bookings")
    .update({ workshops: newWorkshops })
    .eq("id", bookingId)

  if (updateErr) {
    console.error("Update error:", updateErr)
    return new Response(JSON.stringify({ error: "Errore durante l'aggiornamento" }), { status: 500, headers: CORS })
  }

  // Adjust capacity counts
  await supabase.rpc("adjust_workshop_spots", {
    decrement_num: toWorkshop,
    increment_num: fromWorkshop,
    count: booking.bambini_count,
  })

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  })
})
