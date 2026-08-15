import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { formatCedis, formatDay } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/trends")({
  head: () => ({
    meta: [
      { title: "Sales Trends | ShopDesk School Shop" },
      {
        name: "description",
        content: "See daily revenue, best-selling items and shop performance trends for the last 30 days in cedis.",
      },
      { property: "og:title", content: "Sales Trends | ShopDesk School Shop" },
      { property: "og:description", content: "Daily revenue and top sellers for the school shop." },
    ],
  }),
  component: TrendsPage,
});

function TrendsPage() {
  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const { data } = useQuery({
    queryKey: ["trends", since],
    queryFn: async () => {
      const [sales, items] = await Promise.all([
        supabase
          .from("sales")
          .select("id, total, created_at")
          .is("voided_at", null)
          .gte("created_at", since),
        supabase
          .from("sale_items")
          .select("product_name, quantity, line_total, unit_cost, created_at, sale!inner(voided_at)")
          .is("sale.voided_at", null)
          .gte("created_at", since),
      ]);
      if (sales.error) throw sales.error;
      if (items.error) throw items.error;
      return { sales: sales.data, items: items.data as (typeof items.data)[number][] };
    },
  });

  const sales = data?.sales ?? [];
  const items = data?.items ?? [];

  const todayKey = new Date().toDateString();
  const revenueToday = sales
    .filter((s) => new Date(s.created_at).toDateString() === todayKey)
    .reduce((sum, s) => sum + Number(s.total), 0);
  const revenue30 = sales.reduce((sum, s) => sum + Number(s.total), 0);
  const salesToday = sales.filter((s) => new Date(s.created_at).toDateString() === todayKey).length;
  const avgSale = sales.length ? revenue30 / sales.length : 0;
  const profit30 = items.reduce(
    (sum, i) => sum + (Number(i.line_total) - Number(i.unit_cost) * i.quantity),
    0,
  );

  const daily = useMemo(() => {
    const buckets = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      buckets.set(d.toDateString(), 0);
    }
    for (const sale of sales) {
      const key = new Date(sale.created_at).toDateString();
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + Number(sale.total));
    }
    return [...buckets.entries()].map(([key, revenue]) => ({
      day: formatDay(new Date(key).toISOString()),
      revenue: Number(revenue.toFixed(2)),
    }));
  }, [sales]);

  const topItems = useMemo(() => {
    const map = new Map<string, { name: string; quantity: number; revenue: number }>();
    for (const item of items) {
      const current = map.get(item.product_name) ?? { name: item.product_name, quantity: 0, revenue: 0 };
      current.quantity += item.quantity;
      current.revenue += Number(item.line_total);
      map.set(item.product_name, current);
    }
    return [...map.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 6);
  }, [items]);

  const stats = [
    { label: "Revenue today", value: formatCedis(revenueToday) },
    { label: "Sales today", value: String(salesToday) },
    { label: "Revenue (30 days)", value: formatCedis(revenue30) },
    { label: "Average sale", value: formatCedis(avgSale) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Trends</h1>
        <p className="text-sm text-muted-foreground">Last 30 days of school shop activity</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="shadow-card">
            <CardContent className="py-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
              <p className="mt-1 font-display text-2xl font-bold text-primary">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Daily revenue</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} interval={4} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip formatter={(value: number) => formatCedis(value)} />
              <Line type="monotone" dataKey="revenue" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Best sellers by units</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {topItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sales in this period yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topItems}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <Tooltip />
                <Bar dataKey="quantity" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
