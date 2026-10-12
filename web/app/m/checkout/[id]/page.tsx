import { Suspense } from "react";
import { CheckoutLoader, CheckoutSkeleton } from "@/components/CheckoutLoader";

// Simulated mobile app screen. Stands in for the deep link gametime://checkout/[id]:
// a real app would route that link to a screen that resumes the same session by id.
export default function MobileCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="page page--mobile">
      <p className="deeplink-chip">Opened from a link</p>
      <Suspense fallback={<CheckoutSkeleton />}>
        <CheckoutLoader params={params} surface="mobile" />
      </Suspense>
    </main>
  );
}
