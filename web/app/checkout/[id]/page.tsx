import { Suspense } from "react";
import { CheckoutLoader, CheckoutSkeleton } from "@/components/CheckoutLoader";

// Desktop web checkout.
export default function DesktopCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="page">
      <Suspense fallback={<CheckoutSkeleton />}>
        <CheckoutLoader params={params} surface="desktop" />
      </Suspense>
    </main>
  );
}
