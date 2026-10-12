import Link from "next/link";
import { fetchSession } from "@/lib/server-api";
import { CheckoutView, type Surface } from "./CheckoutView";

// Server component: fetches the session on the server so the checkout arrives as HTML.
// Rendered inside <Suspense>, so the page shell (and skeleton) goes out first and this
// streams into the same response as soon as the API answers.
export async function CheckoutLoader({ params, surface }: { params: Promise<{ id: string }>; surface: Surface }) {
  const { id } = await params;
  const { session, serverNow } = await fetchSession(id);

  if (!session) {
    return (
      <article className="checkout">
        <div className="state">
          <h2>Checkout not found</h2>
          <p className="muted">This link may be mistyped, or the server was restarted.</p>
          <Link className="button" href="/">
            Find tickets
          </Link>
        </div>
      </article>
    );
  }

  return <CheckoutView initial={session} initialServerNow={serverNow} surface={surface} />
}

// Same footprint as the loaded checkout, so nothing jumps when the content streams in.
export function CheckoutSkeleton() {
  return (
    <article className="checkout" aria-busy="true">
      <div className="skeleton skeleton--short" />
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--short" />
      <div className="skeleton skeleton--bar" />
    </article>
  );
}
