import { Header } from '@/components/layout/header';
import { MemoryBrowser } from '@/components/memory/memory-browser';

const serverUrl = process.env.NEXT_PUBLIC_RUNTIME_URL ?? 'http://localhost:7820';

export default function MemoryPage() {
  return (
    <>
      <Header title="Memory" />
      <div className="p-6">
        <MemoryBrowser serverUrl={serverUrl} />
      </div>
    </>
  );
}
