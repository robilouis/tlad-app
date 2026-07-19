import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

/**
 * Verify a Cloudflare Access JWT and return the authenticated email.
 *
 * Access injects `Cf-Access-Jwt-Assertion` on every request that passes its
 * login gate. We verify the signature against the team's public keys and check
 * the audience (the Access application's AUD tag) — trusting the plaintext
 * `Cf-Access-Authenticated-User-Email` header alone would be spoofable if the
 * Worker were ever reachable without Access in front.
 *
 * On failure we log the reason (visible via `wrangler tail`) without leaking the
 * token — comparing the configured issuer/aud to the token's actual claims makes
 * a misconfigured ACCESS_TEAM_DOMAIN / ACCESS_AUD obvious. Claims (iss/aud) are
 * identifiers, not secrets.
 */

type JWKS = ReturnType<typeof createRemoteJWKSet>;
const jwksByIssuer = new Map<string, JWKS>();

export async function verifyAccessEmail(request: Request, teamDomain: string, aud: string): Promise<string | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    console.warn('access: no Cf-Access-Jwt-Assertion header — is Access in front of this route?');
    return null;
  }
  if (!teamDomain || !aud) {
    console.warn('access: ACCESS_TEAM_DOMAIN/ACCESS_AUD not set', { teamDomainSet: !!teamDomain, audSet: !!aud });
    return null;
  }

  const issuer = `https://${teamDomain}`;
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByIssuer.set(issuer, jwks);
  }

  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: aud });
    const email = payload.email;
    return typeof email === 'string' ? email : typeof payload.sub === 'string' ? payload.sub : null;
  } catch (e) {
    try {
      const claims = decodeJwt(token); // decode only (no verify) to surface the mismatch
      console.warn('access: jwt verify failed', {
        error: (e as Error).message,
        expectedIssuer: issuer,
        actualIssuer: claims.iss,
        expectedAud: aud,
        actualAud: claims.aud,
      });
    } catch {
      console.warn('access: jwt verify failed and token could not be decoded', { error: (e as Error).message });
    }
    return null;
  }
}
