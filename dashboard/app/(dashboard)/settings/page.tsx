import { Header } from '@/components/layout/header';
import { getRuntimeConfig } from '@/lib/api-server';
import { ConfigForm } from '@/components/settings/config-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  let config = null;
  try {
    config = await getRuntimeConfig();
  } catch {
    config = null;
  }

  return (
    <>
      <Header title="Settings" />
      <div className="p-6">
        <div className="mb-6">
          <h2 className="text-lg font-bold">Runtime Configuration</h2>
          <p className="text-sm text-muted-foreground">
            Manage runtime settings for this Agent Forge instance
          </p>
        </div>
        {config ? (
          <ConfigForm config={config} />
        ) : (
          <div className="glass rounded-lg p-6 text-center text-muted-foreground">
            Unable to load configuration. Is the runtime running?
          </div>
        )}
      </div>
    </>
  );
}
