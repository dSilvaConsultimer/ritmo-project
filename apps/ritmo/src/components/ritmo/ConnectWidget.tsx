import { lazy, Suspense } from "react";

/**
 * Thin wrapper around the SAME `react-pluggy-connect` widget `apps/web`
 * already uses (`ConnectButton.tsx`) — no second Open Finance integration.
 * Lazy-loaded (browser-only: the widget touches `window`/DOM directly) and
 * only ever mounted client-side by the caller (`conectar-banco.tsx` guards
 * with `typeof window !== "undefined"`), so this never runs during SSR.
 */
const PluggyConnect = lazy(() =>
  import("react-pluggy-connect").then((mod) => ({ default: mod.PluggyConnect })),
);

interface PluggySuccessPayload {
  readonly item: { readonly id: string };
}

export function ConnectWidget({
  connectToken,
  includeSandbox,
  onSuccess,
  onError,
  onClose,
}: {
  readonly connectToken: string;
  /**
   * Derived by the caller from the resolved Open Finance mode (see
   * `open-finance-mode.server.ts`) — `true` for ordinary sandbox development,
   * `false` for the Founder Local Live Bank Pilot, so the widget only ever
   * offers Pluggy's real institution connectors in that scenario. Never
   * hardcoded here.
   */
  readonly includeSandbox: boolean;
  readonly onSuccess: (externalConnectionId: string) => void;
  readonly onError: (message: string) => void;
  readonly onClose: () => void;
}) {
  return (
    <Suspense fallback={null}>
      <PluggyConnect
        connectToken={connectToken}
        includeSandbox={includeSandbox}
        onSuccess={(data: PluggySuccessPayload) => onSuccess(data.item.id)}
        onError={(err: { message?: string }) => onError(err.message ?? "Connection failed")}
        onClose={onClose}
      />
    </Suspense>
  );
}
