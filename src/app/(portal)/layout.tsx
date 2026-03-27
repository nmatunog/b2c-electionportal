export default function PortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-100">{children}</div>;
}
