import Stripe from "https://esm.sh/stripe@14"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
})

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY")!
const FROM_BOOKING     = "Missione Mattoncini <prenotazioni@missionemattoncini.it>"
const FROM_NEWSLETTER  = "Missione Mattoncini <info@missionemattoncini.it>"
const AUDIENCE_ID      = Deno.env.get("RESEND_AUDIENCE_ID")!

async function sendEmail(to: string, subject: string, html: string, from = FROM_BOOKING) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, reply_to: "prenotazioni@missionemattoncini.it" }),
  })
  if (!res.ok) console.error("Resend error:", await res.text())
}

async function addToAudience(email: string, firstName: string, lastName: string) {
  const res = await fetch(`https://api.resend.com/audiences/${AUDIENCE_ID}/contacts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, first_name: firstName, last_name: lastName, unsubscribed: false }),
  })
  if (!res.ok) console.error("Resend audience error:", await res.text())
}

function confirmationEmail(meta: Record<string, string>, amount: number, email: string): string {
  const workshops = meta.workshops?.split(",").join(", ") ?? "—"
  const total = (amount / 100).toFixed(2)
  return `
    <div style="font-family:'DM Sans',Arial,sans-serif;background:#0d0d2b;color:#f8f6f0;padding:32px;max-width:560px;margin:0 auto;border-radius:12px">
      <h1 style="color:#f5c842;font-size:1.4rem;margin-bottom:4px">🚀 Missione confermata!</h1>
      <p style="color:#aaa;margin-top:0">Ciao ${meta.nome_genitore ?? ""},</p>
      <p>La prenotazione per <strong>${meta.nome_bambino ?? ""}</strong> è confermata.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px 0;color:#aaa;width:40%">Workshop</td><td style="padding:8px 0"><strong>${workshops}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#aaa">Bambini</td><td style="padding:8px 0"><strong>${meta.bambini_count ?? 1}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#aaa">Totale pagato</td><td style="padding:8px 0"><strong>€${total}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#aaa">Telefono</td><td style="padding:8px 0">${meta.telefono ?? "—"}</td></tr>
      </table>
      <p style="color:#aaa;font-size:0.85rem">Ti contatteremo su WhatsApp con i dettagli logistici qualche giorno prima del workshop.</p>
      <div style="margin:28px 0">
        <a href="https://www.missionemattoncini.it/dashboard.html?email=${encodeURIComponent(email)}&signup=1" style="display:inline-block;background:#f5c842;color:#0d0d2b;font-family:'DM Sans',Arial,sans-serif;font-size:0.9rem;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:8px">Visualizza prenotazione →</a>
        <p style="color:#aaa;font-size:0.78rem;margin-top:10px">Crea il tuo account con questa email per gestire le tue prenotazioni.</p>
      </div>
      <p style="color:#aaa;font-size:0.85rem">Per domande scrivi a <a href="mailto:prenotazioni@missionemattoncini.it" style="color:#7edcca">prenotazioni@missionemattoncini.it</a></p>
      <p style="margin-top:32px">A presto! 🧱<br><strong>Team Missione Mattoncini</strong></p>
    </div>
  `
}

Deno.serve(async (req) => {
  const sig  = req.headers.get("stripe-signature") ?? ""
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, Deno.env.get("STRIPE_WEBHOOK_SECRET")!)
  } catch (err) {
    console.error("Webhook signature verification failed:", err)
    return new Response("Invalid signature", { status: 400 })
  }

  if (event.type === "payment_intent.succeeded") {
    const pi   = event.data.object as Stripe.PaymentIntent
    const meta = pi.metadata as Record<string, string>

    const workshopNums = meta.workshops?.split(",") ?? []
    const bambiniCount = parseInt(meta.bambini_count ?? "1")

    // Save booking to Supabase
    const { error } = await supabase.from("bookings").insert({
      stripe_payment_intent_id: pi.id,
      nome_bambino:    meta.nome_bambino,
      nome_genitore:   meta.nome_genitore,
      email:           pi.receipt_email,
      telefono:        meta.telefono,
      workshops:       workshopNums,
      bambini_count:   bambiniCount,
      amount_cents:    pi.amount,
      newsletter_opt_in: meta.newsletter_opt_in === "true",
      stripe_status:   "succeeded",
      status:          "confirmed",
      confirmed_at:    new Date().toISOString(),
    })
    if (error) console.error("Supabase insert error:", error)

    // Increment spots_taken for each booked workshop
    for (const num of workshopNums) {
      const { error: capErr } = await supabase.rpc("increment_spots_taken", {
        workshop_num: num,
        count: bambiniCount,
      })
      if (capErr) console.error(`Capacity update error for workshop ${num}:`, capErr)
    }

    // Send confirmation email
    if (pi.receipt_email) {
      await sendEmail(
        pi.receipt_email,
        "🚀 Prenotazione confermata — Missione Mattoncini",
        confirmationEmail(meta, pi.amount, pi.receipt_email)
      )
    }

    // Add to newsletter audience if opted in
    if (meta.newsletter_opt_in === "true" && pi.receipt_email) {
      const nameParts = (meta.nome_genitore ?? "").trim().split(" ")
      await addToAudience(pi.receipt_email, nameParts[0] ?? "", nameParts.slice(1).join(" "))
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  })
})
