import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, PackagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatCedis } from "@/lib/format";
import { useSession, useStaffProfile } from "@/hooks/useSession";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({
    meta: [
      { title: "Stock & Products | ShopDesk School Shop" },
      {
        name: "description",
        content: "Manage school shop products, prices in cedis, restocking and low-stock alerts in one place.",
      },
      { property: "og:title", content: "Stock & Products | ShopDesk School Shop" },
      { property: "og:description", content: "Track quantities and get alerted before items run out." },
    ],
  }),
  component: InventoryPage,
});

type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  cost_price: number;
  stock_quantity: number;
  low_stock_threshold: number;
};

function InventoryPage() {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const { data: profile } = useStaffProfile(user?.id);
  const isAdmin = profile?.isAdmin ?? false;

  const [form, setForm] = useState({
    name: "",
    category: "General",
    price: "",
    cost_price: "",
    stock_quantity: "",
    low_stock_threshold: "5",
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, category, price, cost_price, stock_quantity, low_stock_threshold")
        .order("name");
      if (error) throw error;
      return data as Product[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const addProduct = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("products").insert({
        name: form.name.trim(),
        category: form.category.trim() || "General",
        price: Number(form.price) || 0,
        cost_price: Number(form.cost_price) || 0,
        stock_quantity: Number(form.stock_quantity) || 0,
        low_stock_threshold: Number(form.low_stock_threshold) || 5,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product added");
      setForm({
        name: "",
        category: "General",
        price: "",
        cost_price: "",
        stock_quantity: "",
        low_stock_threshold: "5",
      });
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const restock = useMutation({
    mutationFn: async ({ id, amount }: { id: string; amount: number }) => {
      const { error } = await supabase.rpc("adjust_stock", {
        _product_id: id,
        _delta: amount,
        _movement_type: "restock",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const removeProduct = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product removed");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const lowStock = products.filter((p) => p.stock_quantity <= p.low_stock_threshold);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Stock</h1>
          <p className="text-sm text-muted-foreground">
            {products.length} products · {lowStock.length} need restocking
          </p>
        </div>
        {lowStock.length > 0 && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="size-3" /> {lowStock.length} low stock
          </Badge>
        )}
      </div>

      {isAdmin && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PackagePlus className="size-4" /> Add a product
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                addProduct.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="price">Price (GHS)</Label>
                <Input
                  id="price"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cost_price">Cost (GHS)</Label>
                <Input
                  id="cost_price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.cost_price}
                  onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qty">Stock</Label>
                <Input
                  id="qty"
                  type="number"
                  min="0"
                  required
                  value={form.stock_quantity}
                  onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="threshold">Low at</Label>
                <div className="flex gap-2">
                  <Input
                    id="threshold"
                    type="number"
                    min="0"
                    value={form.low_stock_threshold}
                    onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
                  />
                  <Button type="submit" disabled={addProduct.isPending}>
                    Add
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-card">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Restock</TableHead>
                {isAdmin && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    No products yet.
                  </TableCell>
                </TableRow>
              ) : (
                products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.category}</TableCell>
                    <TableCell className="text-right">{formatCedis(p.price)}</TableCell>
                    <TableCell className="text-right">
                      {p.cost_price > 0 ? (
                        <span className={p.price - p.cost_price < 0 ? "text-destructive" : undefined}>
                          {formatCedis(p.price - p.cost_price)}
                          <span className="ml-1 text-xs text-muted-foreground">
                            {p.price > 0
                              ? `${Math.round(((p.price - p.cost_price) / p.price) * 100)}%`
                              : "—"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Set a cost</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={p.stock_quantity <= p.low_stock_threshold ? "destructive" : "secondary"}>
                        {p.stock_quantity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {[5, 10, 50].map((amount) => (
                          <Button
                            key={amount}
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              restock.mutate({ id: p.id, amount })
                            }
                          >
                            +{amount}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${p.name}`}
                          onClick={() => removeProduct.mutate(p.id)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
