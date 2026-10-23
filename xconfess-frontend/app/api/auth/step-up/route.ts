import { NextRequest } from 'next/server';
import {
  getSessionAuthorization,
  resolveBackendRoute,
} from '@/app/lib/api/proxy';

export async function POST(request: NextRequest) {
  const backend = resolveBackendRoute(request, '/auth/step-up');
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const header of ['authorization', 'cookie', 'x-correlation-id']) {
    const value = request.headers.get(header);
    if (value) headers.set(header, value);
  }
  const sessionAuthorization = getSessionAuthorization(request);
  if (sessionAuthorization) {
    headers.set('authorization', sessionAuthorization);
  }

  try {
    const response = await fetch(backend.url, {
      method: 'POST',
      headers,
      body: await request.text(),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        'Content-Type':
          response.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch {
    return Response.json(
      { message: 'Unable to verify your identity. Please try again.' },
      { status: 502 },
    );
  }
}
