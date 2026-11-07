import Link from "next/link";

export default function WesleyPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Wesley</h1>
      <Link href="/" className="text-blue-600 underline">
        ← Back to home
      </Link>
    </main>
  );
}
