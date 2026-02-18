import { Header } from '@/components/layout/header';
import { ApiKeyList } from '@/components/settings/api-key-list';
import { CreateApiKeyDialog } from '@/components/settings/create-api-key-dialog';
import { getApiKeys } from '@/lib/api-server';
import type { ApiKey } from '@autonomy/shared';

export const dynamic = 'force-dynamic';

export default async function ApiKeysPage() {
  let keys: ApiKey[] = [];
  try {
    keys = await getApiKeys();
  } catch {
    keys = [];
  }

  return (
    <>
      <Header title="API Keys" />
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">API Keys</h2>
            <p className="text-sm text-muted-foreground">
              {keys.length} key{keys.length !== 1 ? 's' : ''} configured
            </p>
          </div>
          <CreateApiKeyDialog />
        </div>
        <ApiKeyList keys={keys} />
      </div>
    </>
  );
}
