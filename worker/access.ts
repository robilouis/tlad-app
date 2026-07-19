import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Verify a Cloudflare Access JWT and return the authenticated email.
 *
 * Access injects `Cf-Access-Jwt-Assertion` on every request that passes its
 * login gate. We verify the signature against the team's public keys and check
 * the audience (the Access application's AUD tag) — trusting the plaintext
 * `Cf-Access-Authenticated-User-Email` header alone would be spoofable if the
 * Worker were ever reachable without Access in front.
 */

type JWKS = ReturnType<typeof createRemoteJWKSet>;
const jwksByIssuer = new Map<string, JWKS>();

export async function verifyAccessEmail(request: Request, teamDomain: string, aud: string): Promise<string | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !teamDomain || !aud) return null;

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
  } catch {
    return null;
  }
}
