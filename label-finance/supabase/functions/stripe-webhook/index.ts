// Supabase Edge Function — stripe-webhook
// Riceve gli eventi da Stripe (pagamento, rinnovo, disdetta) e aggiorna la
// tabella `subscriptions`. È l'UNICO punto che decide il piano dell'utente,
// quindi non è falsificabile dal cliente.
//
// Deploy (senza verifica JWT: Stripe non manda un token Supabase):
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Secret necessari:
//   supabase secrets set STRIPE_SECRET_KEY=sk_test_...
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...   (lo dà Stripe quando crei il webhook)
//   supabase secrets set STRIPE_PRICE_BIGLABEL=price_...
//   supabase secrets set STRIPE_PRICE_STUDIO=price_...
//   supabase secrets set STRIPE_PRICE_AGENCY=price_...

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Mappa inversa: Price ID di Stripe → piano interno
const PLAN_BY_PRICE: Record<string, string> = {};
for (const [plan, env] of [
  ["biglabel", "STRIPE_PRICE_BIGLABEL"],
  ["studio", "STRIPE_PRICE_STUDIO"],
  ["agency", "STRIPE_PRICE_AGENCY"],
] as const) {
  const id = Deno.env.get(env);
  if (id) PLAN_BY_PRICE[id] = plan;
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Stati Stripe che danno diritto al piano
const ACTIVE = new Set(["active", "trialing"]);

async function setPlanFromSubscription(subId: string, fallbackUser?: string) {
  const subscription = await stripe.subscriptions.retrieve(subId);
  const customerId = String(subscription.customer);
  const priceId = subscription.items.data[0]?.price?.id ?? "";
  const mappedPlan = PLAN_BY_PRICE[priceId] ?? "free";
  const active = ACTIVE.has(subscription.status);
  const plan = active ? mappedPlan : "free";

  // Trova l'utente: dal metadata, dalla tabella (per customer), o dal fallback
  let userId =
    (subscription.metadata?.supabase_user_id as string) || fallbackUser || "";
  if (!userId) {
    const { data } = await admin
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    userId = data?.user_id ?? "";
  }
  if (!userId) return;

  await admin.from("subscriptions").upsert({
    user_id: userId,
    plan,
    status: subscription.status,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const sig = req.headers.get("stripe-signature") ?? "";
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`bad_signature: ${err}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.subscription) {
          await setPlanFromSubscription(
            String(s.subscription),
            (s.metadata?.supabase_user_id as string) || s.client_reference_id || undefined,
          );
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await setPlanFromSubscription(sub.id);
        break;
      }
    }
  } catch (err) {
    return new Response(`handler_error: ${err}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
