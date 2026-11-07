import type { Metadata } from "next";
import "./globals.css";
import ChatWidget from "./components/chat-widget";

export const metadata: Metadata = {
  title: "Adaptive Course Planner | F&M",
  description: "Explore courses and build your weekly course plan.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ChatWidget />
      </body>
    </html>
  );
}
