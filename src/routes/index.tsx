import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { BarChart3, Boxes, ShoppingCart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ShopDesk — School Shop Sales & Stock Manager" },
      {
        name: "description",
        content:
          "ShopDesk helps school shops record every sale, keep stock accurate and spot sales trends — priced in Ghanaian cedis.",
      },
      { property: "og:title", content: "ShopDesk — School Shop Sales & Stock Manager" },
      {
        property: "og:description",
        content: "Record sales, manage stock and monitor trends for your school shop.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  {
    icon: ShoppingCart,
    title: "Fast till",
    body: "Tap items, choose cash or mobile money, and the sale is saved with the seller's name.",
  },
  {
    icon: Boxes,
    title: "Accurate stock",
    body: "Stock drops automatically with every sale, and low items are flagged before they run out.",
  },
  {
    icon: BarChart3,
    title: "Clear trends",
    body: "Daily revenue, best sellers and average sale value for the last 30 days.",
  },
];

function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/pos", replace: true });
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <section className="bg-hero-gradient px-4 py-20 text-primary-foreground">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-accent">School shop</p>
          <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
            Every sale tracked. Every item accounted for.
          </h1>
          <p className="mt-5 text-base opacity-90">
            ShopDesk is the till and stock book for your school shop — sales in cedis, live stock
            levels and trends your team can act on.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" variant="secondary">
              <Link to="/auth">Staff sign in</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <div className="grid gap-5 md:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="rounded-xl border border-border bg-card p-6 shadow-card"
            >
              <span className="inline-flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                <Icon className="size-5" />
              </span>
              <h2 className="mt-4 text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
