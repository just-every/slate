import { readSamlConfig } from './saml/storage';
import type { RuntimeConfig } from '../../platform/config/runtime';

export interface SignInIdentityProvider {
  name: string;
  start: '/auth/oidc/identity/start' | '/auth/oidc/auth/start' | '/auth/saml/start';
  method?: 'get' | 'post';
}

export interface SignInCapabilities {
  mailDelivery: boolean;
  identityProvider: boolean;
  identityProviders: SignInIdentityProvider[];
  /** Default route for consumers that offer a single provider shortcut. */
  identityProviderStart?: string;
}

export function signInCapabilities(config: RuntimeConfig): SignInCapabilities {
  const identityProviders: SignInIdentityProvider[] = config.identityProvider
    ? [{ name: new URL(config.identityProvider.issuer).hostname, start: '/auth/oidc/identity/start' }]
    : [];
  return {
    mailDelivery: Boolean((config.mailApiKey || config.mailProvider === 'development') && config.mailFrom && config.appUrl),
    identityProvider: identityProviders.length > 0,
    identityProviders,
  };
}

/** Every available provider is offered only while the native owner permits sign-in. */
export async function storedSignInCapabilities(db: D1Database, config: RuntimeConfig): Promise<SignInCapabilities> {
  const capabilities = signInCapabilities(config);
  const policy = await db.prepare('SELECT COALESCE(idp_sign_in,?) AS enabled FROM auth_identity_policy WHERE id=1').bind(Number(!!config.identityProvider)).first<{ enabled: number }>();
  const saml = await readSamlConfig(db);
  const samlProviders: SignInIdentityProvider[] = saml?.enabled ? [{ name: 'SAML', start: '/auth/saml/start', method: 'get' }] : [];
  if (!policy?.enabled) return { ...capabilities, identityProvider: samlProviders.length > 0, identityProviders: samlProviders, identityProviderStart: samlProviders[0]?.start };
  const linked = await db.prepare("SELECT 1 FROM rer_dependency_link l JOIN oa_identity_providers p ON p.provider_id='auth' AND p.issuer=l.issuer AND p.client_id=l.client_id AND p.status='linked' WHERE l.interface='oidc-provider@1' AND l.needs_relink=0").first();
  const identityProviders: SignInIdentityProvider[] = [
    ...capabilities.identityProviders,
    ...samlProviders,
    ...(linked ? [{ name: 'Auth', start: '/auth/oidc/auth/start' as const }] : []),
  ];
  return {
    ...capabilities,
    identityProvider: identityProviders.length > 0,
    identityProviders,
    identityProviderStart: linked ? '/auth/oidc/auth/start' : identityProviders[0]?.start,
  };
}
