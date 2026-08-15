import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatCedis } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/pos")({
  head: () => ({
    meta: [
      { title: "Point of Sale | ShopDesk School Shop" },
      {
        name: "description",
        content: "Record school shop sales in seconds: pick items, take payment and update stock automatically.",
      },
      { property: "og:title", content: "Point of Sale | ShopDesk School Shop" },
      { property: "og:description", content: "Fast till for school shop sales in Ghanaian cedis." },
    ],
  }),
  component: PosPage,
});

type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  stock_quantity: number;
  low_stock_threshold: number;
};

type CartLine = { product: Product; qty: number };

function PosPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState("cash");

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, category, price, stock_quantity, low_stock_threshold")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Product[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
    );
  }, [products, search]);

  const total = cart.reduce((sum, line) => sum + line.product.price * line.qty, 0);

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        if (existing.qty >= product.stock_quantity) {
          toast.error(`Only ${product.stock_quantity} left in stock`);
          return prev;
        }
        return prev.map((l) => (l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l));
      }
      if (product.stock_quantity < 1) {
        toast.error("Out of stock");
        return prev;
      }
      return [...prev, { product, qty: 1 }];
    });
  }

  function changeQty(id: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) =>
          l.product.id === id
            ? { ...l, qty: Math.min(Math.max(l.qty + delta, 0), l.product.stock_quantity) }
            : l,
        )
        .filter((l) => l.qty > 0),
    );
  }

  const checkout = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("record_sale", {
        _payment_method: payment,
        _items: cart.map((l) => ({ product_id: l.product.id, quantity: l.qty })),
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      toast.success(`Sale recorded — ${formatCedis(total)}`);
      setCart([]);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["trends"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <section>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search items or category"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading items…</p>
        ) : filtered.length === 0 ? (
          <Card className="shadow-card">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No items yet. Add products under Stock to start selling.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((product) => (
              <button
                key={product.id}
                onClick={() => addToCart(product)}
                disabled={product.stock_quantity < 1}
                className="rounded-xl border border-border bg-card p-4 text-left shadow-card transition-transform hover:-translate-y-0.5 disabled:opacity-50"
              >
                <p className="font-medium leading-tight">{product.name}</p>
                <p className="text-xs text-muted-foreground">{product.category}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-display font-semibold text-primary">
                    {formatCedis(product.price)}
                  </span>
                  <Badge variant={product.stock_quantity <= product.low_stock_threshold ? "destructive" : "secondary"}>
                    {product.stock_quantity} left
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <Card className="h-fit shadow-raised lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle className="text-base">Current sale</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {cart.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tap an item to add it to the sale.</p>
          ) : (
            <ul className="space-y-3">
              {cart.map((line) => (
                <li key={line.product.id} className="flex items-center gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-medium leading-tight">{line.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCedis(line.product.price)} × {line.qty}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="size-7" onClick={() => changeQty(line.product.id, -1)}>
                      <Minus className="size-3" />
                    </Button>
                    <span className="w-6 text-center text-sm">{line.qty}</span>
                    <Button size="icon" variant="outline" className="size-7" onClick={() => changeQty(line.product.id, 1)}>
                      <Plus className="size-3" />
                    </Button>
                  </div>
                  <span className="w-20 text-right text-sm font-medium">
                    {formatCedis(line.product.price * line.qty)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            <Select value={payment} onValueChange={setPayment}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="momo">Mobile money</SelectItem>
                <SelectItem value="card">Card</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="font-display text-2xl font-bold text-primary">{formatCedis(total)}</span>
            </div>
            <Button
              className="w-full"
              disabled={cart.length === 0 || checkout.isPending}
              onClick={() => checkout.mutate()}
            >
              {checkout.isPending ? "Recording…" : "Complete sale"}
            </Button>
            {cart.length > 0 && (
              <Button variant="ghost" className="w-full" onClick={() => setCart([])}>
                <Trash2 className="mr-2 size-4" /> Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
