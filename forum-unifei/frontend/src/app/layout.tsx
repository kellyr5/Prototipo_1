import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forum UNIFEI | Conhecimento Compartilhado",
  description: "Plataforma colaborativa de perguntas e respostas para estudantes da UNIFEI",
  keywords: ["UNIFEI", "forum", "academico", "computacao", "estudantes"],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
