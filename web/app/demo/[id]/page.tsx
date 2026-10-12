import { Suspense } from "react";
import { DemoControls } from "@/components/DemoControls";

// Desktop and phone side by side on the same session, plus buttons that change the world
// around it (price, inventory, payment, time). Each surface polls independently.
export default function DemoPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <Demo params={params} />
    </Suspense>
  );
}

async function Demo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="demo">
      <DemoControls sessionId={id} />
      <div className="demo__surfaces">
        <figure>
          <figcaption>Desktop web · /checkout/…</figcaption>
          <iframe className="frame frame--desktop" src={`/checkout/${id}`} title="Desktop checkout" />
        </figure>
        <figure>
          <figcaption>Phone · gametime://checkout/…</figcaption>
          <iframe className="frame frame--phone" src={`/m/checkout/${id}`} title="Mobile checkout" />
        </figure>
      </div>
    </main>
  );
}
