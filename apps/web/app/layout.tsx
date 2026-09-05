import type { ReactNode } from "react";

export const metadata = {
  title: "Money Copilot",
  description: "Can I afford to do this without damaging the rest of my financial plan?",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: "#0b0d12",
          color: "#e6e8ec",
        }}
      >
        {children}
      </body>
    </html>
  );
}
