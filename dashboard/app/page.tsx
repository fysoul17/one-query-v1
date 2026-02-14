import { DEFAULTS } from '@autonomy/shared';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Agent Runtime Dashboard</h1>
      <p className="mt-4 text-lg text-gray-600">Runtime at {DEFAULTS.RUNTIME_URL}</p>
    </main>
  );
}
