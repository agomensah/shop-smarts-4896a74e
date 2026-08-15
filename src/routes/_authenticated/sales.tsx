import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatCedis, formatDateTime } from "@/lib/format";
import { useSession, useStaffProfile } from "@/hooks/useSession";

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({
    meta: [
      { title: "Sales History | ShopDesk School Shop" },
      {
        name: "description",
        content: "Browse every school shop transaction with items sold, payment method and the staff member who served.",
      },
      { property: "og:title", content: "Sales History | ShopDesk School Shop" },
      { property: "og:description", content: "A searchable record of all school shop sales." },
    ],
  }),
  component: SalesPage,
});

type SaleRow = {
  id: string;
  total: number;
  payment_method: string;
  created_at: string;
  cashier_id: string;
  voided_at: string | null;
  void_reason: string | null;
  sale_items: { id: string; product_name: string; quantity: number; line_total: number }[];
};

function SalesPage() {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const { data: profile } = useStaffProfile(user?.id);
  const isAdmin = profile?.isAdmin ?? false;

  const [search, setSearch] = useState("");
  const [voidReasons, setVoidReasons] = useState<Record<string, string>>({});

  const { data: sales = [], isLoading } = useQuery({
    queryKey: ["sales", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select(
          "id, total, payment_method, created_at, cashier_id, voided_at, void_reason, sale_items(id, product_name, quantity, line_total)",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as SaleRow[];
    },
  });

  const { data: staff = [] } = useQuery({
    queryKey: ["staff-names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name");
      if (error) throw error;
      return data;
    },
  });

  const nameFor = (id: string) => staff.find((s) => s.id === id)?.full_name ?? "Staff";

  const filtered = sales.filter((sale) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      nameFor(sale.cashier_id).toLowerCase().includes(q) ||
      sale.sale_items.some((i) => i.product_name.toLowerCase().includes(q))
    );
  });

  const voidSale = useMutation({
    mutationFn: async (saleId: string) => {
      const { error } = await supabase.rpc("void_sale", {
        _sale_id: saleId,
        _reason: voidReasons[saleId]?.trim() ?? "",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Sale voided — items returned to stock");
      setVoidReasons({});
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Sales history</h1>
        <p className="text-sm text-muted-foreground">Latest {sales.length} transactions</p>
      </div>

      <Input
        placeholder="Search by item or staff name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading sales…</p>
      ) : filtered.length === 0 ? (
        <Card className="shadow-card">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No sales recorded yet.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {filtered.map((sale) => {
            const isVoided = Boolean(sale.voided_at);
            return (
              <li key={sale.id}>
                <Card className={`shadow-card ${isVoided ? "opacity-60" : ""}`}>
                  <CardContent className="flex flex-wrap items-start justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {sale.sale_items.map((i) => `${i.product_name} ×${i.quantity}`).join(", ") ||
                          "No items"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(sale.created_at)} · {nameFor(sale.cashier_id)}
                      </p>
                      {isVoided && sale.void_reason && (
                        <p className="mt-1 text-xs text-muted-foreground italic">
                          Void reason: {sale.void_reason}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {isVoided ? (
                        <Badge variant="outline">Voided</Badge>
                      ) : (
                        <Badge variant="secondary" className="capitalize">
                          {sale.payment_method}
                        </Badge>
                      )}
                      <span className="font-display text-lg font-semibold text-primary line-through decoration-2">
                        {formatCedis(sale.total)}
                      </span>
                      {isAdmin && !isVoided && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              aria-label={`Void sale ${sale.id}`}
                            >
                              <Undo2 className="size-3.5" /> Void
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Void this sale?</AlertDialogTitle>
                              <AlertDialogDescription>
                                The sale stays on the record but its items go back into stock.
                                This can't be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <Input
                              placeholder="Reason (optional)"
                              value={voidReasons[sale.id] ?? ""}
                              onChange={(e) =>
                                setVoidReasons((prev) => ({ ...prev, [sale.id]: e.target.value }))
                              }
                            />
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                disabled={voidSale.isPending}
                                onClick={() => voidSale.mutate(sale.id)}
                              >
                                {voidSale.isPending ? "Voiding…" : "Void sale"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
