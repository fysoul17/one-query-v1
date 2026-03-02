import { Header } from '@/components/layout/header';
import { MemoryBrowser } from '@/components/memory/memory-browser';
import { RUNTIME_URL } from '@/lib/constants';

export default function MemoryPage() {
  return (
    <>
      <Header title="Memory" />
      <div className="p-6">
        <MemoryBrowser serverUrl={RUNTIME_URL} />
      </div>
    </>
  );
}
