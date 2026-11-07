import Link from "next/link";

const team = [
  { name: "Alex", href: "/alex" },
  { name: "Jason", href: "/jason" },
  { name: "Wesley", href: "/wesley" },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-3xl font-semibold">Adaptive Course Planner</h1>
      <Link
        href="/planner"
        className="rounded-lg bg-[#213a6b] px-8 py-4 text-xl font-semibold text-white hover:bg-[#2c4a85]"
      >
        Open Course Planner
      </Link>
      <div className="flex flex-wrap justify-center gap-4">
        {team.map((person) => (
          <Link
            key={person.href}
            href={person.href}
            className="rounded-lg bg-blue-600 px-6 py-3 text-lg font-medium text-white hover:bg-blue-700"
          >
            {person.name}
          </Link>
        ))}
      </div>
    </main>
  );
}
