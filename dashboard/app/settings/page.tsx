import { Header } from '@/components/layout/header';
import { ConductorSettingsForm } from '@/components/settings/conductor-settings-form';
import { getConductorSettings } from '@/lib/api-server';

export default async function SettingsPage() {
  let settings: Awaited<ReturnType<typeof getConductorSettings>> | null = null;
  let serverError = false;

  try {
    settings = await getConductorSettings();
  } catch {
    serverError = true;
  }

  return (
    <>
      <Header title="Settings" />
      <div className="mx-auto max-w-2xl p-6">
        {serverError && (
          <div className="mb-4 rounded-md border border-neon-red/30 bg-neon-red/5 p-3 text-sm text-neon-red">
            Runtime server is not reachable. Settings may not save until the server is running.
          </div>
        )}
        <ConductorSettingsForm
          initialPersonality={settings?.personality}
          conductorName={settings?.conductorName ?? 'Conductor'}
          sessionId={settings?.sessionId}
        />
      </div>
    </>
  );
}
