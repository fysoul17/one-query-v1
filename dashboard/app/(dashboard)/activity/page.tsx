import { DebugConsole } from '@/components/debug/debug-console';
import { Header } from '@/components/layout/header';

export default function DebugConsolePage() {
  return (
    <>
      <Header title="Debug Console" />
      <DebugConsole />
    </>
  );
}
