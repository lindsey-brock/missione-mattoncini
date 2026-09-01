import Stripe from "https://esm.sh/stripe@14"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
})

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
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  try {
    const { amountCents, workshops, nomeBambino, nomeGenitore, email, telefono, bambiniCount, newsletterOptIn } =
      await req.json()

    if (!amountCents || amountCents < 100) {
      return new Response(JSON.stringify({ error: "Importo non valido" }), { status: 400, headers: CORS })
    }

    // Check capacity for each requested workshop
    if (workshops?.length && bambiniCount) {
      const { data: wsRows } = await supabase
        .from("workshops")
        .select("num, max_spots, spots_taken")
        .in("num", workshops)

      for (const ws of (wsRows ?? [])) {
        const available = ws.max_spots - ws.spots_taken
        if (available < bambiniCount) {
          return new Response(JSON.stringify({
            error: `Il workshop M${ws.num} è esaurito o ha posti insufficienti (${available} rimasti).`
          }), { status: 409, headers: CORS })
        }
      }
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "eur",
      receipt_email: email,
      metadata: {
        workshops: workshops.join(","),
        nome_bambino: nomeBambino,
        nome_genitore: nomeGenitore,
        telefono,
        bambini_count: String(bambiniCount),
        newsletter_opt_in: String(!!newsletterOptIn),
      },
    })

    return new Response(JSON.stringify({ clientSecret: paymentIntent.client_secret }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: "Errore interno" }), { status: 500, headers: CORS })
  }
})
