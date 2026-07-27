import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const runtime = "edge"

export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { error } = await supabase.from("part_catalogue").select("id").limit(1).single()

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, pingedAt: new Date().toISOString() })
}
