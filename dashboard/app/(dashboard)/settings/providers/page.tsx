import { Header } from '@/components/layout/header';
import { ProviderListLoader } from '@/components/settings/provider-list-loader';

export default function ProvidersPage() {
  return (
    <>
      <Header title="AI Providers" />
      <div className="p-6">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">
            Manage AI backend providers and see their connection status
          </p>
        </div>
        <ProviderListLoader />
      </div>
    </>
  );
}
