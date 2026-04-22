/**
 * GET /api/data — server-side Google Sheets CSV proxy.
 * Hides the spreadsheet URL from the client bundle.
 * Requires GOOGLE_SHEETS_URL env var.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.GOOGLE_SHEETS_URL;
  if (!url) {
    return NextResponse.json({ error: 'GOOGLE_SHEETS_URL not configured' }, { status: 503 });
  }
  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) {
      return NextResponse.json({ error: `Upstream error ${res.status}` }, { status: 502 });
    }
    const csv = await res.text();
    return new NextResponse(csv, {
      status: 200,
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 502 });
  }
}
